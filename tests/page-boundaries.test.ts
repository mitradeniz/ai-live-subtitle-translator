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
