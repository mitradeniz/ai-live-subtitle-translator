import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BoundaryError } from '../src/background/errors.ts';
import { createController } from '../src/background/controller.ts';
import { SettingsStore } from '../src/background/settings.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { SitePreferences } from '../src/background/sites.ts';
import { DEFAULT_SETTINGS, SettingsSchema } from '../src/messaging/protocol.ts';
import { TRANSLATION_MESSAGES } from '../src/translation/contracts.ts';
import { translate } from '../src/ui/strings.ts';
import {
  EXTENSION_ID,
  contentSender,
  fakeAreas,
  request,
  uiSender,
} from './helpers.ts';

const { schemaVersion, ...preferences } = DEFAULT_SETTINGS;
void schemaVersion;
const appearance = {
  displayMode: 'translated',
  fontSize: 32,
  contrast: 'solid',
  position: 'top',
};
const youtube = () => ({
  ...contentSender(),
  url: 'https://www.youtube.com/watch?v=synthetic',
  origin: 'https://www.youtube.com',
});

test('older settings acquire presentation defaults; malformed appearance recovers and future versions remain protected', async () => {
  const areas = fakeAreas();
  const {
    contrast: _,
    position: __,
    uiLanguage: ___,
    ...legacy
  } = DEFAULT_SETTINGS;
  void _;
  void __;
  void ___;
  areas.local.data['settings.v1'] = { ...legacy, fontSize: 28 };
  const store = new SettingsStore(new TrustedStorage(areas));
  assert.deepEqual(await store.read(), { ...DEFAULT_SETTINGS, fontSize: 28 });
  assert.equal(
    SettingsSchema.safeParse({ ...DEFAULT_SETTINGS, position: 'url(...)' })
      .success,
    false,
  );
  areas.local.data['settings.v1'] = { ...legacy, contrast: '<script>' };
  assert.deepEqual(await store.read(), DEFAULT_SETTINGS);
  areas.local.data['settings.v1'] = { schemaVersion: 2 };
  await assert.rejects(store.update(preferences));
  assert.deepEqual(areas.local.data['settings.v1'], { schemaVersion: 2 });
});

test('bound overlay can change only appearance; popup controls cannot expose keys or accept page operations', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  await controller.sessions.ready;
  const sessionId = controller.sessions.grant(contentSender());
  for (const type of [
    'controls.read',
    'controls.update',
    'controls.select',
    'site.configure',
  ]) {
    const extra =
      type === 'controls.update'
        ? { preferences }
        : type === 'controls.select'
          ? { provider: 'none' }
          : type === 'site.configure'
            ? { enabled: false, originalConfirmed: false }
            : {};
    assert.deepEqual(
      await controller.dispatch(request(type, extra), contentSender()),
      { ok: false, error: 'FORBIDDEN' },
    );
  }
  assert.equal(
    (
      await controller.dispatch(
        request('content.appearance', { sessionId, appearance }),
        contentSender(),
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('content.settings', { sessionId }),
        contentSender(),
      )
    ).ok,
    true,
    'Appearance preserves the current session',
  );
  for (const extra of [
    { sourceLanguage: 'de' },
    { endpoint: 'https://evil.test' },
    { fontSize: 999 },
    { position: 'left' },
  ])
    assert.deepEqual(
      await controller.dispatch(
        request('content.appearance', {
          sessionId,
          appearance: { ...appearance, ...extra },
        }),
        contentSender(),
      ),
      { ok: false, error: 'INVALID_MESSAGE' },
    );
  assert.equal(
    (
      await controller.dispatch(
        request('content.appearance', { sessionId, appearance }),
        {
          ...contentSender(),
          documentId: '00000000-0000-4000-8000-000000000002',
        },
      )
    ).ok,
    false,
  );
  const ui = await controller.dispatch(
    request('controls.read'),
    uiSender('popup'),
  );
  assert.equal(ui.ok, true);
  assert.ok(!JSON.stringify(ui).includes('key'));
  assert.equal(
    (
      await controller.dispatch(
        request('controls.update', {
          preferences: { ...preferences, uiLanguage: 'tr' },
        }),
        uiSender('popup'),
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('content.settings', { sessionId }),
        contentSender(),
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('controls.update', {
          preferences: { ...preferences, targetLanguage: 'de' },
        }),
        uiSender('popup'),
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('content.settings', { sessionId }),
        contentSender(),
      )
    ).ok,
    false,
    'Language changes invalidate pending sessions',
  );
});

test('automatic activation needs explicit consent and a current host grant, including after worker reconstruction', async () => {
  const areas = fakeAreas();
  let permitted = false;
  let calls = 0;
  const ports = {
    permitted: async () => permitted,
    changed: async () => {},
    activate: async () => {
      calls++;
    },
  };
  let sites = new SitePreferences(new TrustedStorage(areas), ports);
  assert.equal(await sites.enabled(), false);
  await assert.rejects(sites.configure(true, true));
  permitted = true;
  await assert.rejects(sites.configure(true, false));
  await sites.configure(true, true);
  await sites.activate(7, 'document');
  await assert.rejects(sites.activate(7, 'document'));
  assert.equal(calls, 1, 'Repeated page mutations are bounded');
  await sites.pause(8);
  sites = new SitePreferences(new TrustedStorage(areas), ports);
  await sites.activate(8, 'document');
  assert.equal(calls, 1, 'Manual disable survives worker reconstruction');
  await sites.pause(8, false);
  await sites.activate(8, 'document');
  assert.equal(calls, 2);
  permitted = false;
  assert.equal(await sites.enabled(), false);
  await assert.rejects(sites.activate(9, 'document'));
  sites = new SitePreferences(new TrustedStorage(areas), ports);
  assert.equal(await sites.enabled(), false);
  await sites.configure(false, false);
  permitted = true;
  assert.equal(
    await sites.enabled(),
    false,
    'Restoring permission alone is not a new opt-in',
  );
});

test('site activation uses browser metadata, rejects forged tabs, subframes and other origins; stopping is session bound', async () => {
  const activations: unknown[] = [];
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    undefined,
    undefined,
    undefined,
    undefined,
    {
      permitted: async () => true,
      changed: async () => {},
      activate: async (...args) => {
        activations.push(args);
      },
    },
  );
  assert.equal(
    (
      await controller.dispatch(
        request('site.configure', { enabled: true, originalConfirmed: true }),
        uiSender(),
      )
    ).ok,
    true,
  );
  for (const sender of [
    contentSender(),
    uiSender(),
    { ...youtube(), frameId: 1 },
    { ...youtube(), url: 'https://www.youtube.com/' },
  ])
    assert.equal(
      (await controller.dispatch(request('site.activate'), sender)).ok,
      false,
    );
  assert.deepEqual(
    await controller.dispatch(
      request('site.activate', { tabId: 999 }),
      youtube(),
    ),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.equal(
    (await controller.dispatch(request('site.activate'), youtube())).ok,
    true,
  );
  assert.deepEqual(activations, [[7, youtube().documentId]]);
  const sessionId = controller.sessions.grant(youtube());
  assert.equal(
    (
      await controller.dispatch(request('content.stop', { sessionId }), {
        ...youtube(),
        tab: { id: 8, incognito: false },
      })
    ).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('content.stop', { sessionId }),
        youtube(),
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('content.settings', { sessionId }),
        youtube(),
      )
    ).ok,
    false,
  );
});

test('every provider failure has Turkish guidance while caption-like unknown strings remain unchanged', () => {
  for (const message of Object.values(TRANSLATION_MESSAGES)) {
    assert.notEqual(translate(message, 'tr'), message);
    assert.equal(translate(message, 'en'), message);
  }
  assert.equal(
    translate('<img onerror=alert(1)> مرحبا', 'tr'),
    '<img onerror=alert(1)> مرحبا',
  );
  assert.equal(
    translate('Visible captions · no cue timestamps · en · manual', 'tr'),
    'Görünür altyazılar · zaman bilgisi yok · en · manuel',
  );
});

test('appearance merging cannot overwrite a newer UI language or bypass revocation while waiting for storage', async () => {
  const store = new SettingsStore(new TrustedStorage(fakeAreas()));
  await store.read();
  const languageWrite = store.update({ ...preferences, targetLanguage: 'ar' });
  const visualWrite = store.updateAppearance(appearance, () => {});
  await languageWrite;
  assert.equal((await visualWrite).targetLanguage, 'ar');
  await assert.rejects(
    store.updateAppearance({ ...appearance, fontSize: 40 }, () => {
      throw new BoundaryError('FORBIDDEN');
    }),
  );
  assert.equal((await store.read()).fontSize, 32);
});

test('content cannot resume provider traffic from original-only, including a queued UI change', async () => {
  const store = new SettingsStore(new TrustedStorage(fakeAreas()));
  await store.read();
  const stopping = store.update({ ...preferences, displayMode: 'original' });
  const forged = store.updateAppearance(appearance, () => {});
  await stopping;
  await assert.rejects(
    forged,
    (error: unknown) =>
      error instanceof BoundaryError && error.code === 'FORBIDDEN',
  );
  assert.equal((await store.read()).displayMode, 'original');
  await store.updateAppearance(
    { ...appearance, displayMode: 'original' },
    () => {},
  );
  await store.update({ ...preferences, displayMode: 'translated' });
  assert.equal(
    (await store.updateAppearance(appearance, () => {})).displayMode,
    'translated',
  );
});
