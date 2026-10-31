import { firefoxStorage } from '../src/background/firefox-storage.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { FakeArea } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { identifySender } from '../src/background/senders.ts';
import { SessionRegistry } from '../src/background/sessions.ts';
import { createController } from '../src/background/controller.ts';
import { fakeAreas, request, contentSender, EXTENSION_ID } from './helpers.ts';
const policy = {
  extensionOrigin: 'moz-extension://b3758a6d-b3c8-4724-ad3a-0ffdd31e0a73',
  firefox: true,
};
const sender = () => ({ ...contentSender(), documentLifecycle: undefined });

test('Firefox accepts browser document IDs without Chromium lifecycle and retains tab/document binding', () => {
  const registry = new SessionRegistry(
    EXTENSION_ID,
    Date.now,
    undefined,
    undefined,
    'firefox-test',
    policy,
  );
  const identity = identifySender(sender(), EXTENSION_ID, policy);
  assert.equal(identity.kind, 'content');
  if (identity.kind !== 'content') return;
  const id = registry.grant(sender());
  registry.assertBound(id, identity.identity);
  for (const patch of [
    { documentId: 'different' },
    { tabId: 8 },
    { frameId: 1 },
    { origin: 'https://other.test' },
  ])
    assert.throws(() =>
      registry.assertBound(id, { ...identity.identity, ...patch }),
    );
  assert.throws(() => identifySender(sender(), EXTENSION_ID));
  for (const patch of [
    { id: 'other-extension' },
    { documentId: undefined },
    { documentLifecycle: 'cached' },
    { origin: 'https://forged.test' },
    { tab: { id: 7, incognito: true } },
  ])
    assert.throws(() =>
      identifySender({ ...sender(), ...patch }, EXTENSION_ID, policy),
    );
});

test('Firefox UI uses runtime extension URL rather than the public add-on ID', async () => {
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
    undefined,
    undefined,
    undefined,
    undefined,
    policy,
  );
  const ui = {
    id: EXTENSION_ID,
    origin: policy.extensionOrigin,
    url: `${policy.extensionOrigin}/options.html`,
    documentId: 'browser-document',
    frameId: 0,
  };
  assert.equal(
    (await controller.dispatch(request('settings.read'), ui)).ok,
    true,
  );
  for (const patch of [
    { url: `${policy.extensionOrigin}/unknown.html` },
    { origin: 'moz-extension://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    { frameId: 1 },
    { documentId: undefined },
  ])
    assert.equal(
      (await controller.dispatch(request('settings.read'), { ...ui, ...patch }))
        .ok,
      false,
    );
  assert.equal(
    (
      await controller.dispatch(
        request('credentials.status', { credentialId: 'ai' }),
        sender(),
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('settings.read', { identity: ui }),
        sender(),
      )
    ).ok,
    false,
  );
});

test('Firefox database initialization failure prevents session credential reads and writes', async () => {
  const session = new FakeArea();
  const factory = {
    open() {
      throw new Error('SENTINEL_NOT_A_REAL_STORAGE_FAILURE');
    },
  } as unknown as IDBFactory;
  const storage = new TrustedStorage(
    firefoxStorage(session, async () => {}, factory),
  );
  await assert.rejects(
    storage.run(async ({ session: area }) => area.get('credential.v1.ai')),
  );
  await assert.rejects(
    storage.run(async ({ session: area }) =>
      area.set({ secret: 'SENTINEL_NOT_A_REAL' }),
    ),
  );
  assert.deepEqual(session.calls, []);
});
