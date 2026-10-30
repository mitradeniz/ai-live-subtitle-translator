import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createController } from '../src/background/controller.ts';
import { CredentialStore } from '../src/background/credentials.ts';
import { SessionRegistry } from '../src/background/sessions.ts';
import { identifySender } from '../src/background/senders.ts';
import { SETTINGS_KEY, SettingsStore } from '../src/background/settings.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import {
  DEFAULT_SETTINGS,
  withinMessageBudget,
} from '../src/messaging/protocol.ts';
import {
  EXTENSION_ID,
  SENTINEL,
  uiSender,
  contentSender,
  request,
  credential,
  fakeAreas,
  FakeArea,
} from './helpers.ts';

const preferences = {
  sourceLanguage: 'auto',
  targetLanguage: 'de',
  displayMode: 'translated',
  fontSize: 32,
};
const keyName = 'credential.v1.ai';
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test('initialization restricts both areas before any data access', async () => {
  const areas = fakeAreas();
  const gate = deferred();
  areas.local.accessBarrier = gate.promise;
  const controller = createController(EXTENSION_ID, areas);
  const response = controller.dispatch(request('settings.read'), uiSender());
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(areas.local.calls, ['restrict']);
  assert.deepEqual(areas.session.calls, ['restrict']);
  gate.release();
  assert.equal((await response).ok, true);
  assert.equal(areas.local.access, 'TRUSTED_CONTEXTS');
  assert.equal(areas.session.access, 'TRUSTED_CONTEXTS');
});

for (const area of ['local', 'session'] as const) {
  test(`failed ${area} restriction fails closed without touching stored data`, async () => {
    const areas = fakeAreas();
    areas[area].failAccess = true;
    const controller = createController(EXTENSION_ID, areas);
    const write = request('credentials.set', {
      credentialId: 'ai',
      credential,
    });
    for (const message of [
      request('settings.read'),
      write,
      request('credentials.delete', { credentialId: 'ai' }),
    ]) {
      assert.deepEqual(await controller.dispatch(message, uiSender()), {
        ok: false,
        error: 'UNAVAILABLE',
      });
    }
    assert.deepEqual(areas.local.calls, ['restrict']);
    assert.deepEqual(areas.session.calls, ['restrict']);
  });
}

test('oversized, deep, cyclic, accessor, non-JSON and unknown-field requests are rejected', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const accessor = Object.defineProperty({}, 'type', {
    get() {
      throw Error('must not invoke');
    },
  });
  let deep: unknown = 'leaf';
  for (let i = 0; i < 10; i++) deep = { deep };
  const samples = [
    cyclic,
    accessor,
    deep,
    [],
    undefined,
    NaN,
    new Date(),
    request('settings.read', { key: 'x'.repeat(16_385) }),
    request('settings.read', { identity: uiSender() }),
    request('settings.read', { role: 'ui' }),
    request('settings.read', { version: 2 }),
    request('fetch', { url: 'https://evil.example.test' }),
  ];
  for (const sample of samples)
    assert.deepEqual(await controller.dispatch(sample, uiSender()), {
      ok: false,
      error: 'INVALID_MESSAGE',
    });
  assert.equal(
    withinMessageBudget({ x: ['🙂'.repeat(4096), '🙂'.repeat(4096)] }),
    false,
  );
});

test('invalid settings cannot be saved', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  for (const invalid of [
    { ...preferences, fontSize: 100 },
    { ...preferences, targetLanguage: 'auto' },
    { ...preferences, targetLanguage: '<script>' },
    { ...preferences, key: SENTINEL },
  ]) {
    assert.deepEqual(
      await controller.dispatch(
        request('settings.update', { preferences: invalid }),
        uiSender(),
      ),
      { ok: false, error: 'INVALID_MESSAGE' },
    );
  }
});

test('options require sender URL, extension ID, origin, lifecycle and document metadata', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const wrong = [
    undefined,
    {},
    { ...uiSender(), id: 'another-extension' },
    { ...uiSender(), origin: 'null' },
    { ...uiSender(), documentId: undefined },
    { ...uiSender(), documentLifecycle: 'prerender' },
    { ...uiSender(), frameId: 2 },
    { ...uiSender(), url: uiSender().url + '?role=options' },
    { ...uiSender(), url: uiSender().url + '/evil' },
    { ...uiSender(), tab: { id: 1, incognito: true } },
    { ...uiSender(), url: 'https://evil.example.test/options.html' },
  ];
  for (const sender of wrong)
    assert.deepEqual(
      await controller.dispatch(request('settings.read'), sender),
      { ok: false, error: 'FORBIDDEN' },
    );
});

test('toolbar popup without document metadata retains only popup privileges', async () => {
  const sender = {
    id: EXTENSION_ID,
    origin: `chrome-extension://${EXTENSION_ID}`,
    url: `chrome-extension://${EXTENSION_ID}/popup.html`,
  };
  const controller = createController(
    EXTENSION_ID,
    fakeAreas(),
    async () => 'source-required',
  );
  assert.deepEqual(
    await controller.dispatch(request('playback.enable'), sender),
    { ok: true, data: { kind: 'playback', state: 'source-required' } },
  );
  for (const message of [
    request('settings.update', { preferences }),
    request('settings.export'),
    request('credentials.status', { credentialId: 'ai' }),
    request('credentials.set', { credentialId: 'ai', credential }),
    request('credentials.delete', { credentialId: 'ai' }),
  ])
    assert.deepEqual(await controller.dispatch(message, sender), {
      ok: false,
      error: 'FORBIDDEN',
    });
  for (const patch of [
    { id: 'another-extension' },
    { origin: 'null' },
    { origin: 'https://www.youtube.com' },
    { url: sender.url + '?role=popup' },
    { url: `chrome-extension://${EXTENSION_ID}/options.html` },
    { documentLifecycle: 'cached' },
    { documentLifecycle: 'active' },
    { documentId: 'document-without-lifecycle' },
    { frameId: 0 },
    { tab: { id: 7 } },
  ])
    assert.deepEqual(
      await controller.dispatch(request('playback.enable'), {
        ...sender,
        ...patch,
      }),
      { ok: false, error: 'FORBIDDEN' },
    );
});

test('options tabs are trusted but the popup cannot mutate settings or credentials', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const options = { ...uiSender(), tab: { id: 42 }, frameId: 0 };
  assert.equal(
    (
      await controller.dispatch(
        request('settings.update', { preferences }),
        options,
      )
    ).ok,
    true,
  );
  assert.equal(
    (await controller.dispatch(request('settings.read'), uiSender('popup'))).ok,
    true,
  );
  for (const message of [
    request('settings.update', { preferences }),
    request('settings.export'),
    request('credentials.set', { credentialId: 'ai', credential }),
    request('credentials.status', { credentialId: 'ai' }),
  ]) {
    assert.deepEqual(await controller.dispatch(message, uiSender('popup')), {
      ok: false,
      error: 'FORBIDDEN',
    });
  }
});

test('browser-generated opaque document IDs work without weakening document binding', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const documentId = 'B9477EA747093BB2AF57B26EEE8B882D';
  assert.equal(
    (
      await controller.dispatch(request('settings.read'), {
        ...uiSender(),
        documentId,
      })
    ).ok,
    true,
  );
  const content = { ...contentSender(), documentId };
  const sessionId = controller.sessions.grant(content);
  assert.equal(
    (
      await controller.dispatch(
        request('content.settings', { sessionId }),
        content,
      )
    ).ok,
    true,
  );
  assert.deepEqual(
    await controller.dispatch(request('content.settings', { sessionId }), {
      ...content,
      documentId: 'B9477EA747093BB2AF57B26EEE8B882E',
    }),
    { ok: false, error: 'INVALID_SESSION' },
  );
});

test('content scripts cannot read privileged settings, mutate, export or access credentials', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const content = contentSender();
  controller.sessions.grant(content);
  for (const message of [
    request('settings.read'),
    request('settings.update', { preferences }),
    request('settings.export'),
    request('credentials.set', { credentialId: 'ai', credential }),
    request('credentials.delete', { credentialId: 'ai' }),
    request('credentials.status', { credentialId: 'ai' }),
  ]) {
    assert.deepEqual(await controller.dispatch(message, content), {
      ok: false,
      error: 'FORBIDDEN',
    });
  }
  for (const sender of [content, uiSender()]) {
    assert.deepEqual(
      await controller.dispatch(
        request('credentials.read', { credentialId: 'ai' }),
        sender,
      ),
      { ok: false, error: 'INVALID_MESSAGE' },
    );
    assert.deepEqual(
      await controller.dispatch(request('session.grant'), sender),
      { ok: false, error: 'INVALID_MESSAGE' },
    );
  }
});

test('session token is bound to browser tab, frame, document and origin', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const content = contentSender();
  const sessionId = controller.sessions.grant(content);
  const message = request('content.settings', { sessionId });
  assert.deepEqual(await controller.dispatch(message, content), {
    ok: true,
    data: {
      kind: 'settings',
      settings: DEFAULT_SETTINGS,
      googleEnabled: false,
      aiEnabled: false,
      cloudEnabled: false,
      providerLabel: '',
    },
  });
  for (const sender of [
    { ...content, tab: { id: 8, incognito: false } },
    { ...content, frameId: 1 },
    { ...content, documentId: '00000000-0000-4000-8000-000000000002' },
    {
      ...content,
      origin: 'https://other.example.test',
      url: 'https://other.example.test/',
    },
  ])
    assert.deepEqual(await controller.dispatch(message, sender), {
      ok: false,
      error: 'INVALID_SESSION',
    });
  assert.deepEqual(
    await controller.dispatch({ ...message, tabId: content.tab.id }, content),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.deepEqual(await controller.dispatch(message, uiSender()), {
    ok: false,
    error: 'FORBIDDEN',
  });
  controller.sessions.revokeTab(content.tab.id);
  assert.deepEqual(await controller.dispatch(message, content), {
    ok: false,
    error: 'INVALID_SESSION',
  });
});

test('content sender requires a nonopaque matching origin and complete browser identity', async () => {
  for (const patch of [
    { origin: 'null' },
    { frameId: undefined },
    { tab: undefined },
    { documentId: undefined },
    { documentLifecycle: undefined },
    { documentId: undefined, documentLifecycle: undefined },
    { url: 'about:blank' },
    { documentLifecycle: 'cached' },
  ]) {
    assert.throws(
      () => identifySender({ ...contentSender(), ...patch }, EXTENSION_ID),
      /FORBIDDEN/,
    );
  }
});

test('new document grant and expiration invalidate sessions; a checkpoint survives worker restart', async () => {
  let now = 0;
  const registry = new SessionRegistry(EXTENSION_ID, () => now);
  const content = contentSender();
  const sender = identifySender(content, EXTENSION_ID);
  assert.equal(sender.kind, 'content');
  if (sender.kind !== 'content') throw Error('wrong fixture');
  const first = registry.grant(content);
  const second = registry.grant(content);
  assert.throws(
    () => registry.assertBound(first, sender.identity),
    /INVALID_SESSION/,
  );
  registry.assertBound(second, sender.identity);
  now = 30 * 60_000;
  assert.throws(
    () => registry.assertBound(second, sender.identity),
    /INVALID_SESSION/,
  );
  const areas = fakeAreas();
  const before = createController(EXTENSION_ID, areas);
  const sessionId = before.sessions.grant(content);
  await before.sessions.flush();
  const after = createController(EXTENSION_ID, areas);
  assert.equal(
    (await after.dispatch(request('content.settings', { sessionId }), content))
      .ok,
    true,
  );
  assert.deepEqual(
    await after.dispatch(request('content.settings', { sessionId }), {
      ...content,
      documentId: 'new-document',
    }),
    { ok: false, error: 'INVALID_SESSION' },
  );
});

test('session registry caps growth', () => {
  const registry = new SessionRegistry(EXTENSION_ID);
  for (let id = 0; id < 128; id++)
    registry.grant({ ...contentSender(), tab: { id } });
  assert.throws(
    () => registry.grant({ ...contentSender(), tab: { id: 129 } }),
    /BUSY/,
  );
});

test('revocation during settings read prevents the response from reaching content', async () => {
  const areas = fakeAreas();
  const gate = deferred();
  areas.local.accessBarrier = gate.promise;
  const controller = createController(EXTENSION_ID, areas);
  const sender = contentSender();
  const sessionId = controller.sessions.grant(sender);
  const result = controller.dispatch(
    request('content.settings', { sessionId }),
    sender,
  );
  controller.sessions.revokeTab(sender.tab.id);
  gate.release();
  assert.deepEqual(await result, { ok: false, error: 'INVALID_SESSION' });
});

test('default keys are session-only; status and replies never return key material', async () => {
  const areas = fakeAreas();
  const controller = createController(EXTENSION_ID, areas);
  const response = await controller.dispatch(
    request('credentials.set', { credentialId: 'ai', credential }),
    uiSender(),
  );
  assert.deepEqual(response, { ok: true, data: { kind: 'saved' } });
  assert.equal(areas.local.data[keyName], undefined);
  assert.deepEqual(areas.session.data[keyName], credential);
  const status = await controller.dispatch(
    request('credentials.status', { credentialId: 'ai' }),
    uiSender(),
  );
  assert.deepEqual(status, {
    ok: true,
    data: {
      kind: 'credential-status',
      status: { configured: true, retention: 'session' },
    },
  });
  assert.ok(!JSON.stringify(status).includes(SENTINEL));
});

test('explicit device retention and switching back remove obsolete copies', async () => {
  const areas = fakeAreas();
  const store = new CredentialStore(new TrustedStorage(areas));
  await store.set('ai', credential, true);
  assert.equal(areas.session.data[keyName], undefined);
  assert.deepEqual(areas.local.data[keyName], credential);
  await store.set('ai', { ...credential, key: 'ANOTHER_SENTINEL' });
  assert.equal(areas.local.data[keyName], undefined);
  assert.equal(
    await store.readForOrigin('ai', credential.origin),
    'ANOTHER_SENTINEL',
  );
  await store.delete('ai');
  assert.deepEqual(await store.status('ai'), {
    configured: false,
    retention: null,
  });
});

test('credential deletion covers both areas and is idempotent', async () => {
  const areas = fakeAreas();
  areas.local.data[keyName] = credential;
  areas.session.data[keyName] = credential;
  const controller = createController(EXTENSION_ID, areas);
  for (let i = 0; i < 2; i++)
    assert.deepEqual(
      await controller.dispatch(
        request('credentials.delete', { credentialId: 'ai' }),
        uiSender(),
      ),
      { ok: true, data: { kind: 'deleted' } },
    );
  assert.equal(areas.local.data[keyName], undefined);
  assert.equal(areas.session.data[keyName], undefined);
});

test('keys are origin-bound and changing the origin invalidates the stored key', async () => {
  const areas = fakeAreas();
  const store = new CredentialStore(new TrustedStorage(areas));
  await store.set('ai', credential);
  assert.equal(
    await store.readForOrigin('ai', 'https://different.example.test'),
    null,
  );
  assert.equal(await store.readForOrigin('ai', credential.origin), null);
  for (const origin of [
    'http://example.test',
    'https://user:password@example.test',
    credential.origin + '/path',
    'not-a-url',
  ]) {
    assert.throws(
      () => store.set('ai', { ...credential, origin }),
      /INVALID_MESSAGE/,
    );
  }
});

test('settings and credentials persist across worker reconstruction; session keys vanish on browser reset', async () => {
  const areas = fakeAreas();
  const before = createController(EXTENSION_ID, areas);
  await before.dispatch(
    request('settings.update', { preferences }),
    uiSender(),
  );
  await before.dispatch(
    request('credentials.set', { credentialId: 'ai', credential }),
    uiSender(),
  );
  const after = createController(EXTENSION_ID, areas);
  assert.deepEqual(await after.dispatch(request('settings.read'), uiSender()), {
    ok: true,
    data: { kind: 'settings', settings: { schemaVersion: 1, ...preferences } },
  });
  assert.equal(
    (await new CredentialStore(new TrustedStorage(areas)).status('ai'))
      .configured,
    true,
  );
  const restarted = { local: areas.local, session: new FakeArea() };
  assert.equal(
    (await new CredentialStore(new TrustedStorage(restarted)).status('ai'))
      .configured,
    false,
  );
  await new CredentialStore(new TrustedStorage(restarted)).set(
    'ai',
    credential,
    true,
  );
  assert.equal(
    (
      await new CredentialStore(
        new TrustedStorage({ local: areas.local, session: new FakeArea() }),
      ).status('ai')
    ).retention,
    'device',
  );
});

test('malformed and duplicate credential records are removed without fallback', async () => {
  for (const raw of [
    { schemaVersion: 9, key: SENTINEL },
    { ...credential, unexpected: SENTINEL },
    null,
  ]) {
    const areas = fakeAreas();
    areas.session.data[keyName] = raw;
    const store = new CredentialStore(new TrustedStorage(areas));
    assert.equal(await store.readForOrigin('ai', credential.origin), null);
    assert.equal(areas.session.data[keyName], undefined);
  }
  const areas = fakeAreas();
  areas.local.data[keyName] = credential;
  areas.session.data[keyName] = credential;
  assert.equal(
    await new CredentialStore(new TrustedStorage(areas)).readForOrigin(
      'ai',
      credential.origin,
    ),
    null,
  );
  assert.equal(areas.local.data[keyName], undefined);
  assert.equal(areas.session.data[keyName], undefined);
});

test('malformed settings recover to defaults without exporting unknown fields or keys', async () => {
  const areas = fakeAreas();
  areas.local.data[SETTINGS_KEY] = { ...DEFAULT_SETTINGS, apiKey: SENTINEL };
  areas.local.data[keyName] = credential;
  const store = new SettingsStore(new TrustedStorage(areas));
  const exported = await store.export();
  assert.deepEqual(exported.settings, DEFAULT_SETTINGS);
  assert.ok(!JSON.stringify(exported).includes(SENTINEL));
  assert.deepEqual(Object.keys(exported).sort(), [
    'format',
    'schemaVersion',
    'settings',
  ]);
  assert.deepEqual(areas.local.data[SETTINGS_KEY], DEFAULT_SETTINGS);
  assert.deepEqual(areas.local.data[keyName], credential);
});

test('future settings versions are preserved and never silently downgraded', async () => {
  const areas = fakeAreas();
  const future = { ...DEFAULT_SETTINGS, schemaVersion: 2 };
  areas.local.data[SETTINGS_KEY] = future;
  const controller = createController(EXTENSION_ID, areas);
  for (const message of [
    request('settings.read'),
    request('settings.export'),
    request('settings.update', { preferences }),
  ]) {
    assert.deepEqual(await controller.dispatch(message, uiSender()), {
      ok: false,
      error: 'UNSUPPORTED_SETTINGS_VERSION',
    });
  }
  assert.deepEqual(areas.local.data[SETTINGS_KEY], future);
});

test('storage failures are redacted and latch closed', async () => {
  const areas = fakeAreas();
  areas.session.failWrite = true;
  const controller = createController(EXTENSION_ID, areas);
  const result = await controller.dispatch(
    request('credentials.set', { credentialId: 'ai', credential }),
    uiSender(),
  );
  assert.deepEqual(result, { ok: false, error: 'UNAVAILABLE' });
  assert.ok(!JSON.stringify(result).includes(SENTINEL));
  areas.session.failWrite = false;
  assert.deepEqual(
    await controller.dispatch(request('settings.read'), uiSender()),
    { ok: false, error: 'UNAVAILABLE' },
  );
});

test('concurrent retention changes serialize without leaving two key copies', async () => {
  const areas = fakeAreas();
  const store = new CredentialStore(new TrustedStorage(areas));
  await Promise.all([
    store.set('ai', credential, true),
    store.set('ai', { ...credential, key: 'SECOND_SENTINEL' }),
    store.delete('ai'),
  ]);
  assert.deepEqual(await store.status('ai'), {
    configured: false,
    retention: null,
  });
});

test('in-flight request limit bounds the queue', async () => {
  const areas = fakeAreas();
  const gate = deferred();
  areas.local.accessBarrier = gate.promise;
  const controller = createController(EXTENSION_ID, areas);
  const pending = Array.from({ length: 32 }, () =>
    controller.dispatch(request('settings.read'), uiSender()),
  );
  assert.deepEqual(
    await controller.dispatch(request('settings.read'), uiSender()),
    { ok: false, error: 'BUSY' },
  );
  gate.release();
  await Promise.all(pending);
});
