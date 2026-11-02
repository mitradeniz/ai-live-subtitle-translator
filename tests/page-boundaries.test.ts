import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from '../src/background/controller.ts';
import { DEFAULT_PAGE_PREFERENCES } from '../src/page/contracts.ts';
import { chunks } from '../src/page/dom.ts';
import {
  fakeAreas,
  EXTENSION_ID,
  request,
  uiSender,
  contentSender,
} from './helpers.ts';
const job = () => ({
  jobId: crypto.randomUUID(),
  generation: 1,
  items: [{ id: 'page-1', revision: 1, text: 'Synthetic visible text.' }],
});
test('page authorization is separate from playback; content cannot configure, activate, or fetch arbitrary URLs', async () => {
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => 'ready',
  );
  const sender = contentSender();
  const captions = controller.sessions.grant(sender);
  const page = controller.pageSessions.grant(sender);
  await controller.pageSessions.flush();
  controller.sessions.assertBound(captions, {
    tabId: 7,
    frameId: 0,
    documentId: sender.documentId,
    origin: sender.origin,
  });
  for (const type of ['page.enable', 'page.configure', 'page.preferences']) {
    const response = await controller.dispatch(
      request(
        type,
        type === 'page.configure'
          ? { preferences: DEFAULT_PAGE_PREFERENCES }
          : {},
      ),
      sender,
    );
    assert.equal(response.ok, false);
  }
  for (const type of ['page.settings', 'page.translate']) {
    const response = await controller.dispatch(
      request(type, {
        sessionId: captions,
        ...(type === 'page.translate' ? { feature: 'page', job: job() } : {}),
      }),
      sender,
    );
    assert.equal(response.ok, false);
  }
  for (const altered of [
    { ...sender, documentId: 'forged' },
    { ...sender, frameId: 1 },
    { ...sender, tab: { id: 9 } },
    uiSender(),
  ]) {
    assert.equal(
      (
        await controller.dispatch(
          request('page.settings', { sessionId: page }),
          altered,
        )
      ).ok,
      false,
    );
  }
  assert.equal(
    (
      await controller.dispatch(
        request('page.translate', {
          sessionId: page,
          feature: 'page',
          job: job(),
          url: 'https://evil.test',
        }),
        sender,
      )
    ).ok,
    false,
  );
  const settings = await controller.dispatch(
    request('page.settings', { sessionId: page }),
    sender,
  );
  assert.ok(settings.ok && settings.data.kind === 'page-settings');
  assert.equal(settings.data.preferences.writing, false);
  assert.equal('key' in settings.data, false);
  controller.pageSessions.revokeTab(7);
  assert.equal(
    (
      await controller.dispatch(
        request('page.settings', { sessionId: page }),
        sender,
      )
    ).ok,
    false,
  );
  controller.sessions.assertBound(captions, {
    tabId: 7,
    frameId: 0,
    documentId: sender.documentId,
    origin: sender.origin,
  });
});
test('disabled page features and writing without AI cause no provider calls; page results never enter persistent cache', async () => {
  const areas = fakeAreas();
  let calls = 0;
  const controller = createController(EXTENSION_ID, areas, undefined, {
    permitted: async () => true,
    fetch: async () => {
      calls++;
      return new Response(
        JSON.stringify([[['Metin.', 'Synthetic visible text.']]]),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  });
  await controller.dispatch(request('google.enable'), uiSender());
  await controller.work.cache.configure(true);
  // The selection marker is on by default; turn it off to check the gate.
  await controller.dispatch(
    request('page.configure', {
      preferences: { ...DEFAULT_PAGE_PREFERENCES, selection: false },
    }),
    uiSender('popup'),
  );
  const sender = contentSender();
  let sessionId = controller.pageSessions.grant(sender);
  for (const feature of ['selection', 'hover', 'input', 'writing']) {
    const result = await controller.dispatch(
      request('page.translate', { sessionId, feature, job: job() }),
      sender,
    );
    assert.ok(
      result.ok && result.data.kind === 'translation' && !result.data.result.ok,
    );
  }
  assert.equal(calls, 0);
  await controller.dispatch(
    request('page.configure', {
      preferences: { ...DEFAULT_PAGE_PREFERENCES, writing: true },
    }),
    uiSender('popup'),
  );
  sessionId = controller.pageSessions.grant(sender);
  const writing = await controller.dispatch(
    request('page.translate', {
      sessionId,
      feature: 'writing',
      style: 'polish',
      job: job(),
    }),
    sender,
  );
  assert.ok(
    writing.ok &&
      writing.data.kind === 'translation' &&
      !writing.data.result.ok &&
      writing.data.result.error === 'AI_PROFILE',
  );
  assert.equal(calls, 0);
  const output = await controller.dispatch(
    request('page.translate', { sessionId, feature: 'page', job: job() }),
    sender,
  );
  assert.ok(
    output.ok && output.data.kind === 'translation' && output.data.result.ok,
  );
  assert.equal(calls, 1);
  assert.equal(areas.local.data['translation-cache.v1'], undefined);
  assert.equal(areas.session.data['translation-cache.v1'], undefined);
  assert.ok(!JSON.stringify(areas).includes('Synthetic visible text.'));
});
test('page sessions recover only from trusted session storage and do not overwrite playback sessions', async () => {
  const areas = fakeAreas();
  const first = createController(EXTENSION_ID, areas);
  const sender = contentSender();
  const page = first.pageSessions.grant(sender),
    caption = first.sessions.grant(sender);
  await first.pageSessions.flush();
  await first.sessions.flush();
  const next = createController(EXTENSION_ID, areas);
  const info = await next.dispatch(
    request('page.settings', { sessionId: page }),
    sender,
  );
  assert.ok(info.ok && info.data.kind === 'page-settings');
  assert.ok(
    (
      await next.dispatch(
        request('content.settings', { sessionId: caption }),
        sender,
      )
    ).ok,
  );
  assert.equal(
    (
      await next.dispatch(
        request('content.settings', { sessionId: page }),
        sender,
      )
    ).ok,
    false,
  );
});
test('long page text is chunked within provider limits without corrupting Unicode or original whitespace', () => {
  const text = 'Test 🧿 cümlesi. '.repeat(160);
  const parts = chunks(text);
  assert.equal(parts.join(''), text);
  assert.ok(
    parts.every(
      (part) => part.length <= 1000 && !/[\uD800-\uDBFF]$/.test(part),
    ),
  );
});

test('video edge action requires a selected capability and browser-bound identity', async () => {
  let calls = 0;
  let check: (() => Promise<boolean>) | undefined;
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    undefined,
    { permitted: async () => true },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (tabId, documentId, confirmed, authorized) => {
      calls++;
      assert.equal(tabId, 7);
      assert.equal(documentId, contentSender().documentId);
      assert.equal(confirmed, true);
      assert.equal(await authorized(), true);
      check = authorized;
      return 'enabled';
    },
  );
  const sender = contentSender();
  let sessionId = controller.pageSessions.grant(sender);
  const call = (extra = {}, from = sender) =>
    controller.dispatch(
      request('page.captions', { sessionId, ...extra }),
      from,
    );
  assert.equal((await call()).ok, false);
  await controller.dispatch(
    request('page.configure', {
      preferences: {
        ...DEFAULT_PAGE_PREFERENCES,
        clickAction: 'captions',
        youtubeSourceConfirmed: true,
      },
    }),
    uiSender('popup'),
  );
  sessionId = controller.pageSessions.grant(sender);
  assert.equal((await call({ tabId: 99 })).ok, false);
  assert.equal((await call({ youtubeSourceConfirmed: true })).ok, false);
  assert.equal((await call({}, { ...sender, documentId: 'forged' })).ok, false);
  const unselected = await call();
  assert.ok(
    unselected.ok &&
      unselected.data.kind === 'playback' &&
      unselected.data.state === 'needs-restart',
    JSON.stringify(unselected),
  );
  assert.equal(calls, 0);
  await controller.dispatch(request('google.enable'), uiSender());
  sessionId = controller.pageSessions.grant(sender);
  const preferences = {
    sourceLanguage: 'auto',
    targetLanguage: 'tr',
    displayMode: 'original',
    fontSize: 24,
    contrast: 'glass',
    position: 'bottom',
    uiLanguage: 'en',
  };
  await controller.dispatch(
    request('settings.update', { preferences }),
    uiSender(),
  );
  const originalOnly = await call();
  assert.ok(
    originalOnly.ok &&
      originalOnly.data.kind === 'playback' &&
      originalOnly.data.state === 'needs-restart',
  );
  assert.equal(
    calls,
    0,
    'A page action cannot resume original-only translation',
  );
  await controller.dispatch(
    request('settings.update', {
      preferences: { ...preferences, displayMode: 'bilingual' },
    }),
    uiSender(),
  );
  const accepted = await call();
  assert.ok(
    accepted.ok &&
      accepted.data.kind === 'playback' &&
      accepted.data.state === 'enabled',
  );
  assert.equal(calls, 1);
  assert.equal((await call()).ok, false, 'Repeated activation is rate bounded');
  controller.pageSessions.revokeTab(7);
  await assert.rejects(check!);
  assert.equal((await call()).ok, false);
  assert.equal(calls, 1);
});

test('compact caption switch and status bind to the sender document without changing the edge action', async () => {
  const calls: string[] = [];
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    undefined,
    { permitted: async () => true },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async (tabId, documentId, confirmed, authorized, operation = 'enable') => {
      assert.equal(tabId, 7);
      assert.equal(documentId, contentSender().documentId);
      assert.equal(await authorized(), true);
      // Only starting uses the saved track confirmation, which is on by default.
      assert.equal(confirmed, operation === 'enable');
      calls.push(operation);
      return operation === 'enable' ? 'enabled' : 'disabled';
    },
  );
  await controller.dispatch(request('google.enable'), uiSender());
  const sender = contentSender();
  const sessionId = controller.pageSessions.grant(sender);
  const send = (type: string, extra = {}, from: unknown = sender) =>
    controller.dispatch(request(type, { sessionId, ...extra }), from);
  for (const type of ['page.caption-status', 'page.caption-toggle']) {
    const extra = type === 'page.caption-toggle' ? { enabled: true } : {};
    assert.equal((await send(type, extra, uiSender('popup'))).ok, false);
    assert.equal(
      (await send(type, extra, { ...sender, documentId: 'forged' })).ok,
      false,
    );
    assert.equal((await send(type, { ...extra, tabId: 88 })).ok, false);
    assert.equal(
      (await send(type, { ...extra, endpoint: 'https://attacker.test' })).ok,
      false,
    );
  }
  assert.deepEqual(calls, []);
  assert.equal((await send('page.caption-status')).ok, true);
  assert.equal((await send('page.caption-toggle', { enabled: true })).ok, true);
  assert.equal(
    (await send('page.caption-toggle', { enabled: true })).ok,
    false,
    'Repeated activation stays rate limited',
  );
  assert.equal(
    (await send('page.caption-toggle', { enabled: false })).ok,
    true,
    'Stopping must remain possible immediately after starting',
  );
  assert.deepEqual(calls, ['status', 'enable', 'disable']);
  await controller.selection.set('ai');
  const missing = await send('page.caption-toggle', { enabled: true });
  assert.ok(
    missing.ok &&
      missing.data.kind === 'playback' &&
      missing.data.state === 'key-required',
  );
  assert.deepEqual(
    calls,
    ['status', 'enable', 'disable'],
    'The switch cannot bypass paid credential checks',
  );
  const prefs = await controller.dispatch(
    request('page.preferences'),
    uiSender(),
  );
  assert.ok(prefs.ok && prefs.data.kind === 'page-preferences');
  assert.equal(prefs.data.preferences.clickAction, 'page');
  controller.pageSessions.revokeAll();
  assert.equal((await send('page.caption-status')).ok, false);
  assert.equal(
    (await send('page.caption-toggle', { enabled: false })).ok,
    false,
  );
});

test('automatic selection requires its own opt-in and never authorizes another feature', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const sender = contentSender();
  let sessionId = controller.pageSessions.grant(sender);
  const preferences = await controller.dispatch(
    request('page.preferences'),
    uiSender(),
  );
  assert.ok(preferences.ok && preferences.data.kind === 'page-preferences');
  assert.equal(preferences.data.preferences.autoSelection, false);
  await controller.dispatch(
    request('page.configure', {
      preferences: { ...DEFAULT_PAGE_PREFERENCES, selection: true },
    }),
    uiSender(),
  );
  sessionId = controller.pageSessions.grant(sender);
  const translate = (feature: string) =>
    controller.dispatch(
      request('page.translate', {
        sessionId,
        feature,
        automaticSelection: true,
        job: job(),
      }),
      sender,
    );
  const denied = await translate('selection');
  assert.ok(
    denied.ok &&
      denied.data.kind === 'translation' &&
      !denied.data.result.ok &&
      denied.data.result.error === 'OFF',
  );
  assert.equal(
    (
      await controller.dispatch(
        request('page.configure', {
          preferences: { ...DEFAULT_PAGE_PREFERENCES, autoSelection: true },
        }),
        sender,
      )
    ).ok,
    false,
  );
  await controller.dispatch(
    request('page.configure', {
      preferences: {
        ...DEFAULT_PAGE_PREFERENCES,
        selection: true,
        autoSelection: true,
      },
    }),
    uiSender(),
  );
  sessionId = controller.pageSessions.grant(sender);
  const wrongFeature = await translate('page');
  assert.ok(
    wrongFeature.ok &&
      wrongFeature.data.kind === 'translation' &&
      !wrongFeature.data.result.ok &&
      wrongFeature.data.result.error === 'OFF',
  );
});

test('selection language overrides are scoped, validated, and never saved as global preferences', async () => {
  const calls: URL[] = [];
  const controller = createController(EXTENSION_ID, fakeAreas(), undefined, {
    permitted: async () => true,
    fetch: async (url) => {
      calls.push(new URL(String(url)));
      return new Response(
        JSON.stringify([[['Result.', 'Synthetic visible text.']]]),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  });
  await controller.dispatch(request('google.enable'), uiSender());
  await controller.dispatch(
    request('page.configure', {
      preferences: {
        ...DEFAULT_PAGE_PREFERENCES,
        selection: true,
        autoSelection: true,
      },
    }),
    uiSender(),
  );
  const sender = contentSender();
  const sessionId = controller.pageSessions.grant(sender);
  const languages = { sourceLanguage: 'tr', targetLanguage: 'en' };
  const send = (extra = {}) =>
    controller.dispatch(
      request('page.translate', {
        sessionId,
        feature: 'selection',
        automaticSelection: true,
        selectionLanguages: languages,
        job: job(),
        ...extra,
      }),
      sender,
    );
  for (const selectionLanguages of [
    { ...languages, endpoint: 'https://attacker.test' },
    { ...languages, targetLanguage: 'auto' },
    { ...languages, sourceLanguage: '<img>' },
  ])
    assert.equal((await send({ selectionLanguages })).ok, false);
  const denied = await send({ feature: 'page' });
  assert.ok(
    !denied.ok ||
      (denied.data.kind === 'translation' && !denied.data.result.ok),
  );
  assert.equal(calls.length, 0);
  const result = await send();
  assert.ok(
    result.ok && result.data.kind === 'translation' && result.data.result.ok,
    JSON.stringify(result),
  );
  assert.equal(calls[0]?.searchParams.get('sl'), 'tr');
  assert.equal(calls[0]?.searchParams.get('tl'), 'en');
  // A click on the selection icon is a manual request: it may carry the
  // card's languages without the automatic opt-in.
  await controller.dispatch(
    request('page.configure', {
      preferences: { ...DEFAULT_PAGE_PREFERENCES, selection: true },
    }),
    uiSender(),
  );
  const manualSession = controller.pageSessions.grant(sender);
  const manual = await controller.dispatch(
    request('page.translate', {
      sessionId: manualSession,
      feature: 'selection',
      selectionLanguages: { sourceLanguage: 'de', targetLanguage: 'ja' },
      job: job(),
    }),
    sender,
  );
  assert.ok(
    manual.ok && manual.data.kind === 'translation' && manual.data.result.ok,
    JSON.stringify(manual),
  );
  assert.equal(calls[1]?.searchParams.get('sl'), 'de');
  assert.equal(calls[1]?.searchParams.get('tl'), 'ja');
  const settings = await controller.dispatch(
    request('settings.read'),
    uiSender(),
  );
  assert.ok(settings.ok && settings.data.kind === 'settings');
  assert.equal(settings.data.settings.sourceLanguage, 'auto');
  assert.equal(settings.data.settings.targetLanguage, 'tr');
});

test('pages start translation-only with a confirmed YouTube track and the selection marker, and earlier preferences move to these defaults once', async () => {
  assert.equal(DEFAULT_PAGE_PREFERENCES.display, 'translated');
  assert.equal(DEFAULT_PAGE_PREFERENCES.youtubeSourceConfirmed, true);
  assert.equal(DEFAULT_PAGE_PREFERENCES.selection, true);
  assert.equal(DEFAULT_PAGE_PREFERENCES.autoSelection, false);
  for (const key of ['page-preferences.v1', 'page-preferences.v2']) {
    const areas = fakeAreas();
    areas.local.data[key] = {
      ...DEFAULT_PAGE_PREFERENCES,
      hover: true,
      selection: false,
      autoSelection: false,
      display: 'bilingual',
      youtubeSourceConfirmed: false,
    };
    const controller = createController(EXTENSION_ID, areas);
    const read = async () => {
      const result = await controller.dispatch(
        request('page.preferences'),
        uiSender(),
      );
      assert.ok(result.ok && result.data.kind === 'page-preferences');
      return result.data.preferences;
    };
    const migrated = await read();
    assert.equal(migrated.display, 'translated');
    assert.equal(migrated.youtubeSourceConfirmed, true);
    assert.equal(migrated.selection, true);
    assert.equal(migrated.autoSelection, false);
    assert.equal(migrated.hover, true, 'Other choices are kept');
    await controller.dispatch(
      request('page.configure', {
        preferences: { ...migrated, display: 'bilingual', selection: false },
      }),
      uiSender(),
    );
    assert.equal(key in areas.local.data, false);
    const later = await read();
    assert.equal(later.display, 'bilingual', 'A later choice is kept');
    assert.equal(later.selection, false, 'A later choice is kept');
  }
});
