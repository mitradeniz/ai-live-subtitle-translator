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
