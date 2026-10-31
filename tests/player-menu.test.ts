import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from '../src/background/controller.ts';
import { DEFAULT_AI_PROFILE } from '../src/translation/ai-profile.ts';
import { DEFAULT_SETTINGS } from '../src/messaging/protocol.ts';
import {
  fakeAreas,
  EXTENSION_ID,
  request,
  uiSender,
  contentSender,
  SENTINEL,
} from './helpers.ts';

function fixture() {
  const areas = fakeAreas();
  let permitted = true;
  const controller = createController(
    EXTENSION_ID,
    areas,
    undefined,
    { permitted: async () => permitted },
    { permitted: async () => permitted },
    { permitted: async () => permitted },
  );
  const sender = contentSender();
  let sessionId = controller.pageSessions.grant(sender);
  const send = (type: string, extra = {}, from: unknown = sender) =>
    controller.dispatch(request(type, { sessionId, ...extra }), from);
  return {
    areas,
    controller,
    sender,
    send,
    revokePermission: () => {
      permitted = false;
    },
    rotate: (id: string) => {
      sessionId = id;
    },
  };
}

test('player choices and changes require the active document and accept no privileged configuration', async () => {
  const f = fixture();
  for (const [type, fields] of [
    ['page.menu', {}],
    ['page.menu-provider', { provider: 'none' }],
    ['page.menu-language', { targetLanguage: 'en' }],
    ['page.menu-swap', {}],
  ] as const) {
    for (const sender of [
      uiSender(),
      { ...f.sender, documentId: 'forged' },
      { ...f.sender, frameId: 1 },
      { ...f.sender, tab: { id: 88 } },
    ])
      assert.equal((await f.send(type, fields, sender)).ok, false);
    for (const extra of [
      { endpoint: 'https://attacker.test' },
      { key: SENTINEL },
      { model: 'arbitrary' },
      { tabId: 88 },
    ])
      assert.equal((await f.send(type, { ...fields, ...extra })).ok, false);
  }
  for (const targetLanguage of ['auto', '<img>', 'tr'.repeat(100)])
    assert.equal(
      (await f.send('page.menu-language', { targetLanguage })).ok,
      false,
    );
  assert.equal(
    (await f.send('page.menu-provider', { provider: 'https://attacker.test' }))
      .ok,
    false,
  );
  assert.equal(
    (await f.send('credentials.status', { credentialId: 'ai' })).ok,
    false,
  );
  f.controller.pageSessions.revokeAll();
  assert.equal((await f.send('page.menu')).ok, false);
});

test('menu reveals only availability, preserves origin-bound keys, and rotates jobs after a narrow change', async () => {
  const f = fixture();
  f.areas.session.data['credential.v1.ai'] = {
    schemaVersion: 1,
    origin: 'https://api.openai.com',
    key: SENTINEL,
  };
  const info = await f.send('page.menu');
  assert.ok(info.ok && info.data.kind === 'player-menu');
  assert.equal(JSON.stringify(info).includes(SENTINEL), false);
  assert.equal(
    info.data.choices.find((choice) => choice.id === 'OpenAI')?.keySaved,
    true,
  );
  assert.equal(
    info.data.choices.find((choice) => choice.id === 'DeepSeek')?.state,
    'key-required',
  );
  for (const provider of ['DeepSeek', 'Gemini', 'google-cloud', 'google'])
    assert.equal((await f.send('page.menu-provider', { provider })).ok, false);
  const captionId = f.controller.sessions.grant(f.sender);
  const other = { ...f.sender, tab: { id: 8, incognito: false } };
  const otherId = f.controller.pageSessions.grant(other);
  const selected = await f.send('page.menu-provider', { provider: 'OpenAI' });
  assert.ok(selected.ok && selected.data.kind === 'player-menu-saved');
  assert.equal(
    (await f.send('page.menu')).ok,
    false,
    'Old page capability revoked',
  );
  assert.equal(
    (
      await f.controller.dispatch(
        request('content.settings', { sessionId: captionId }),
        f.sender,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await f.controller.dispatch(
        request('page.menu', { sessionId: otherId }),
        other,
      )
    ).ok,
    false,
  );
  f.rotate(selected.data.sessionId);
  assert.equal(await f.controller.selection.read(), 'ai');
  assert.deepEqual(await f.controller.ai.profile(), DEFAULT_AI_PROFILE);
  assert.equal(
    JSON.stringify(f.areas.session.data).includes(SENTINEL),
    true,
    'Switching never deletes or rebinds a key',
  );
  f.revokePermission();
  const revoked = await f.send('page.menu');
  assert.ok(revoked.ok && revoked.data.kind === 'player-menu');
  assert.equal(
    revoked.data.choices.find((choice) => choice.id === 'OpenAI')?.state,
    'permission-required',
  );
  assert.equal(
    (await f.send('page.menu-provider', { provider: 'OpenAI' })).ok,
    false,
  );
  const language = await f.send('page.menu-language', { targetLanguage: 'ar' });
  assert.ok(language.ok && language.data.kind === 'player-menu-saved');
  f.rotate(language.data.sessionId);
  const updated = await f.controller.dispatch(
    request('settings.read'),
    uiSender(),
  );
  assert.ok(updated.ok && updated.data.kind === 'settings');
  assert.deepEqual(updated.data.settings, {
    ...DEFAULT_SETTINGS,
    targetLanguage: 'ar',
  });
});

test('changing target language cancels an in-flight response and rejects the old page session', async () => {
  let release!: () => void;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const controller = createController(EXTENSION_ID, fakeAreas(), undefined, {
    permitted: async () => true,
    fetch: async () => {
      started();
      await pending;
      return new Response(
        JSON.stringify([[['Eski sonuç.', 'Synthetic text.']]]),
      );
    },
  });
  await controller.dispatch(request('google.enable'), uiSender());
  const sender = contentSender();
  const sessionId = controller.pageSessions.grant(sender);
  const work = controller.dispatch(
    request('page.translate', {
      sessionId,
      feature: 'page',
      job: {
        jobId: crypto.randomUUID(),
        generation: 1,
        items: [{ id: 'test', revision: 0, text: 'Synthetic text.' }],
      },
    }),
    sender,
  );
  await began;
  const saved = await controller.dispatch(
    request('page.menu-language', { sessionId, targetLanguage: 'de' }),
    sender,
  );
  assert.ok(saved.ok && saved.data.kind === 'player-menu-saved');
  release();
  const result = await work;
  assert.ok(
    !result.ok ||
      (result.data.kind === 'translation' && !result.data.result.ok),
  );
  assert.equal(JSON.stringify(result).includes('Eski sonuç.'), false);
  assert.equal(
    (await controller.dispatch(request('page.menu', { sessionId }), sender)).ok,
    false,
  );
});

test('swapping languages uses saved settings, refuses auto-detect and rotates the page session', async () => {
  const f = fixture();
  const read = async () => {
    const result = await f.controller.dispatch(
      request('settings.read'),
      uiSender(),
    );
    assert.ok(result.ok && result.data.kind === 'settings');
    return result.data.settings;
  };
  // The default source is auto-detect: nothing to swap and nothing rotated.
  assert.equal((await read()).sourceLanguage, 'auto');
  assert.equal((await f.send('page.menu-swap')).ok, false);
  assert.equal((await f.send('page.menu')).ok, true, 'Session kept');
  // A page can only ask for a swap; it cannot name a language.
  for (const extra of [
    { sourceLanguage: 'de' },
    { targetLanguage: 'de' },
    { languages: ['de', 'en'] },
  ])
    assert.equal((await f.send('page.menu-swap', extra)).ok, false);
  f.areas.local.data['settings.v1'] = {
    ...DEFAULT_SETTINGS,
    sourceLanguage: 'en',
    targetLanguage: 'tr',
  };
  const menu = await f.send('page.menu');
  assert.ok(menu.ok && menu.data.kind === 'player-menu');
  assert.equal(menu.data.sourceLanguage, 'en');
  assert.equal(menu.data.targetLanguage, 'tr');
  const swapped = await f.send('page.menu-swap');
  assert.ok(swapped.ok && swapped.data.kind === 'player-menu-saved');
  assert.equal((await f.send('page.menu')).ok, false, 'Old session revoked');
  f.rotate(swapped.data.sessionId);
  assert.deepEqual(await read(), {
    ...DEFAULT_SETTINGS,
    sourceLanguage: 'tr',
    targetLanguage: 'en',
  });
  const back = await f.send('page.menu-swap');
  assert.ok(back.ok && back.data.kind === 'player-menu-saved');
  f.rotate(back.data.sessionId);
  assert.deepEqual(await read(), {
    ...DEFAULT_SETTINGS,
    sourceLanguage: 'en',
    targetLanguage: 'tr',
  });
});
