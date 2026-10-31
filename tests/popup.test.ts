import { CredentialStore } from '../src/background/credentials.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from '../src/background/controller.ts';
import { DEEPSEEK_ENDPOINT } from '../src/translation/ai-profile.ts';
import {
  fakeAreas,
  EXTENSION_ID,
  request,
  uiSender,
  contentSender,
  SENTINEL,
} from './helpers.ts';

const profile = {
  schemaVersion: 1,
  endpoint: DEEPSEEK_ENDPOINT,
  model: 'deepseek-flash',
};
function harness() {
  const areas = fakeAreas();
  let tabId = 7;
  let permitted = true;
  const ports = {
    permitted: async () => permitted,
    fetch: async () =>
      new Response(JSON.stringify({ error: { message: SENTINEL } }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      }),
  };
  const controller = createController(
    EXTENSION_ID,
    areas,
    undefined,
    undefined,
    ports,
    ports,
    undefined,
    async () => ({ tabId, youtube: true }),
  );
  return {
    controller,
    keys: new CredentialStore(new TrustedStorage(areas)),
    areas,
    tab: (id: number) => {
      tabId = id;
    },
    revoke: () => {
      permitted = false;
    },
  };
}
async function summary(controller: ReturnType<typeof createController>) {
  const result = await controller.dispatch(
    request('popup.read'),
    uiSender('popup'),
  );
  assert.ok(result.ok && result.data.kind === 'popup-status');
  assert.ok(!JSON.stringify(result).includes(SENTINEL));
  return result.data;
}

test('popup metadata is trusted-UI-only, origin-bound and never returns credentials or tests a key', async () => {
  const h = harness();
  for (const sender of [
    contentSender(),
    uiSender(),
    { ...uiSender('popup'), id: 'forged' },
  ])
    assert.deepEqual(
      await h.controller.dispatch(request('popup.read'), sender),
      { ok: false, error: 'FORBIDDEN' },
    );
  assert.deepEqual(
    await h.controller.dispatch(
      request('popup.read', { tabId: 99 }),
      uiSender('popup'),
    ),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  await h.controller.ai.configure(profile);
  await h.keys.set('ai', {
    schemaVersion: 1,
    origin: 'https://api.openai.com',
    key: SENTINEL,
  });
  assert.equal((await summary(h.controller)).ai.configured, false);
  await h.keys.set('ai', {
    schemaVersion: 1,
    origin: 'https://api.deepseek.com',
    key: SENTINEL,
  });
  const data = await summary(h.controller);
  assert.deepEqual(data.ai, {
    configured: true,
    retention: 'session',
    permitted: true,
  });
  assert.equal(
    data.selected,
    'none',
    'Saving a key does not activate a paid provider',
  );
  assert.equal(
    data.recent,
    null,
    'No synthetic test success or playback success is inferred',
  );
  assert.equal(data.cloud.configured, false);
  h.revoke();
  assert.equal((await summary(h.controller)).ai.permitted, false);
  await h.keys.delete('ai');
  assert.equal((await summary(h.controller)).ai.configured, false);
  h.areas.session.failAccess = true;
  const restarted = createController(EXTENSION_ID, h.areas);
  assert.deepEqual(
    await restarted.dispatch(request('popup.read'), uiSender('popup')),
    { ok: false, error: 'UNAVAILABLE' },
  );
});

test('popup reports redacted current-tab playback failures and drops them on session invalidation/restart', async () => {
  const h = harness();
  await h.controller.ai.configure(profile);
  await h.keys.set('ai', {
    schemaVersion: 1,
    origin: 'https://api.deepseek.com',
    key: SENTINEL,
  });
  await h.controller.selection.set('ai');
  await h.controller.sessions.ready;
  const sessionId = h.controller.sessions.grant(contentSender());
  const result = await h.controller.dispatch(
    request('content.translate', {
      sessionId,
      job: {
        jobId: crypto.randomUUID(),
        generation: 1,
        items: [{ id: 'cue', revision: 1, text: 'Private caption text' }],
      },
    }),
    contentSender(),
  );
  assert.ok(
    result.ok && result.data.kind === 'translation' && !result.data.result.ok,
  );
  assert.equal((await summary(h.controller)).recent?.error, 'PROVIDER_REQUEST');
  assert.ok(
    !JSON.stringify(await summary(h.controller)).includes(
      'Private caption text',
    ),
  );
  h.tab(8);
  assert.equal((await summary(h.controller)).recent, null);
  h.tab(7);
  h.controller.sessions.revokeTab(7);
  assert.equal((await summary(h.controller)).recent, null);
  const restarted = createController(EXTENSION_ID, h.areas);
  assert.equal((await summary(restarted)).recent, null);
});
