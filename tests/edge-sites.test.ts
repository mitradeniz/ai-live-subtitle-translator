import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EdgeSites,
  edgeOrigin,
  EDGE_SITES_KEY,
} from '../src/background/edge-sites.ts';
import { TrustedStorage } from '../src/background/storage.ts';
import { createController } from '../src/background/controller.ts';
import { DEFAULT_PAGE_PREFERENCES } from '../src/page/contracts.ts';
import {
  fakeAreas,
  EXTENSION_ID,
  contentSender,
  uiSender,
  request,
} from './helpers.ts';

test('automatic edge sites require exact ordinary origins, saved opt-in and current permission', async () => {
  const areas = fakeAreas();
  let permission = false;
  let changed = 0;
  let calls = 0;
  const origin = 'https://video.example.test';
  const ports = {
    current: async () => ({ origin, tabId: 7 }),
    permitted: async () => permission,
    changed: async () => {
      changed++;
    },
    activate: async (
      _tab: number,
      _doc: string,
      valid: () => Promise<boolean>,
    ) => {
      assert.equal(await valid(), true);
      calls++;
    },
  };
  const sites = new EdgeSites(new TrustedStorage(areas), ports);
  for (const value of [
    'https://*.test',
    'https://user:secret@example.test',
    'file:///test',
    'https://example.test:8443',
  ])
    assert.equal(edgeOrigin(value), null);
  await assert.rejects(sites.configure(true));
  assert.equal((await sites.status()).enabled, false);
  permission = true;
  assert.equal(
    await sites.allowed(origin),
    false,
    'Host access alone is not opt-in',
  );
  await sites.configure(true);
  await sites.activate(7, 'doc', origin);
  await assert.rejects(sites.activate(7, 'doc', origin));
  assert.equal(calls, 1);
  assert.equal(changed, 1);
  const restarted = new EdgeSites(new TrustedStorage(areas), ports);
  assert.equal(await restarted.allowed(origin), true);
  permission = false;
  assert.equal(await restarted.allowed(origin), false);
  assert.deepEqual(await restarted.prune(), []);
  permission = true;
  assert.equal(
    await restarted.allowed(origin),
    false,
    'Revocation is not silently undone',
  );
  await restarted.configure(true);
  await restarted.clear();
  assert.equal(areas.local.data[EDGE_SITES_KEY], undefined);
});

test('automatic bootstrap uses browser sender identity and cannot configure hosts from content', async () => {
  let calls = 0;
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
    {
      current: async () => ({ origin: contentSender().origin, tabId: 7 }),
      permitted: async () => true,
      changed: async () => {},
      activate: async (tab, doc, valid) => {
        assert.equal(tab, 7);
        assert.equal(doc, contentSender().documentId);
        assert.equal(await valid(), true);
        calls++;
      },
    },
  );
  const sender = contentSender();
  assert.equal(
    (
      await controller.dispatch(
        request('page.global-configure', { enabled: true }),
        sender,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('page.global-configure', { enabled: true }),
        uiSender('popup'),
      )
    ).ok,
    false,
    'Missing broad grant fails closed',
  );
  assert.equal(
    (await controller.dispatch(request('page.auto'), sender)).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('page.site-configure', { enabled: true }),
        sender,
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('page.site-configure', {
          enabled: true,
          origin: 'https://evil.test',
        }),
        uiSender('popup'),
      )
    ).ok,
    false,
  );
  assert.equal(
    (
      await controller.dispatch(
        request('page.site-configure', { enabled: true }),
        uiSender('popup'),
      )
    ).ok,
    true,
  );
  for (const altered of [
    { ...sender, frameId: 1 },
    { ...sender, tab: { id: 7, incognito: true } },
    { ...sender, origin: 'https://evil.test' },
  ])
    assert.equal(
      (await controller.dispatch(request('page.auto'), altered)).ok,
      false,
    );
  assert.equal(
    (await controller.dispatch(request('page.auto', { tabId: 99 }), sender)).ok,
    false,
  );
  assert.equal(
    (await controller.dispatch(request('page.auto'), sender)).ok,
    true,
  );
  assert.equal(calls, 1);
});

test('hover-menu action can only select already enabled page/video tools in a bound session', async () => {
  const controller = createController(EXTENSION_ID, fakeAreas());
  const sender = contentSender();
  await controller.dispatch(
    request('page.configure', {
      preferences: {
        ...DEFAULT_PAGE_PREFERENCES,
        youtubeSourceConfirmed: false,
      },
    }),
    uiSender('popup'),
  );
  let sessionId = controller.pageSessions.grant(sender);
  const choose = (action: string, extra = {}) =>
    controller.dispatch(
      request('page.action', { sessionId, action, ...extra }),
      sender,
    );
  for (const action of ['ai', 'writing', 'https://evil.test'])
    assert.equal((await choose(action)).ok, false);
  assert.equal(
    (await choose('captions', { youtubeSourceConfirmed: true })).ok,
    false,
  );
  const selected = await choose('captions');
  assert.ok(selected.ok && selected.data.kind === 'page-preferences');
  assert.equal(selected.data.preferences.clickAction, 'captions');
  assert.equal(selected.data.preferences.youtubeSourceConfirmed, false);
  const reloaded = await controller.dispatch(
    request('page.preferences'),
    uiSender('popup'),
  );
  assert.ok(
    reloaded.ok &&
      reloaded.data.kind === 'page-preferences' &&
      reloaded.data.preferences.clickAction === 'captions',
  );
  await controller.dispatch(
    request('page.configure', {
      preferences: { ...DEFAULT_PAGE_PREFERENCES, captions: false },
    }),
    uiSender('popup'),
  );
  sessionId = controller.pageSessions.grant(sender);
  assert.equal((await choose('captions')).ok, false);
  assert.equal((await choose('page')).ok, true);
  controller.pageSessions.revokeTab(7);
  assert.equal((await choose('page')).ok, false);
});

test('all-sites mode requires its own broad consent, survives restart, and clears on disable/revocation', async () => {
  const areas = fakeAreas();
  let broad = false;
  const ports = {
    current: async () => ({ origin: 'https://first.example.test', tabId: 7 }),
    permitted: async () => true,
    allPermitted: async () => broad,
    changed: async () => {},
    activate: async () => {},
  };
  let sites = new EdgeSites(new TrustedStorage(areas), ports);
  await assert.rejects(sites.configureAll(true));
  assert.equal((await sites.status()).allSites, false);
  await sites.configure(true);
  assert.equal(await sites.allowed('https://second.example.test'), false);
  broad = true;
  assert.equal(
    await sites.allowed('https://second.example.test'),
    false,
    'Grant alone does not opt in',
  );
  await sites.configureAll(true);
  sites = new EdgeSites(new TrustedStorage(areas), ports);
  assert.equal(await sites.allowed('https://second.example.test'), true);
  assert.equal(await sites.allowed('http://third.example.test'), true);
  assert.equal(await sites.allowed('file:///private'), false);
  assert.deepEqual(await sites.matches(), ['https://*/*', 'http://*/*']);
  broad = false;
  await sites.prune();
  broad = true;
  assert.equal(
    await sites.allowed('https://second.example.test'),
    false,
    'Lost grant cannot silently reenable',
  );
  await sites.configureAll(true);
  await sites.configureAll(false);
  assert.deepEqual(await sites.matches(), []);
  assert.equal((await sites.status()).enabled, false);
});

test('the logo hidden on one site overrides all-sites mode until the popup shows it again', async () => {
  const areas = fakeAreas();
  let changed = 0;
  const ports = {
    current: async () => ({ origin: 'https://first.example.test', tabId: 7 }),
    permitted: async () => true,
    allPermitted: async () => true,
    changed: async () => {
      changed++;
    },
    activate: async () => {},
  };
  const sites = new EdgeSites(new TrustedStorage(areas), ports);
  await sites.configureAll(true);
  await assert.rejects(sites.hide('https://example.test:8443'));
  await sites.hide('https://first.example.test');
  assert.equal(await sites.allowed('https://first.example.test'), false);
  assert.equal(await sites.allowed('https://second.example.test'), true);
  assert.equal((await sites.status()).enabled, false);
  // The popup's per-site switch shows it again without touching other sites.
  await sites.configure(true);
  assert.equal(await sites.allowed('https://first.example.test'), true);
  await sites.configure(false);
  assert.equal(await sites.allowed('https://first.example.test'), false);
  assert.deepEqual(await sites.origins(), [], 'All-sites mode adds no entry');
  // Turning all sites on again starts from a clean slate.
  await sites.configureAll(false);
  await sites.configureAll(true);
  assert.equal(await sites.allowed('https://first.example.test'), true);
  assert.ok(changed >= 5);
  // In per-site mode, hiding removes the saved opt-in too.
  await sites.configureAll(false);
  await sites.configure(true);
  await sites.hide('https://first.example.test');
  assert.deepEqual(await sites.origins(), []);
  assert.equal(await sites.allowed('https://first.example.test'), false);
  await sites.clear();
  assert.deepEqual(await sites.hidden(), []);
});

test('the edge button menu can change only its size and the selection marker, and can only hide the logo', async () => {
  let broad = true;
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
    {
      allPermitted: async () => broad,
      current: async () => ({ origin: contentSender().origin, tabId: 7 }),
      permitted: async () => true,
      changed: async () => {},
      activate: async () => {},
    },
  );
  const sender = contentSender();
  const sessionId = controller.pageSessions.grant(sender);
  const send = (type: string, extra = {}, from: unknown = sender) =>
    controller.dispatch(request(type, { sessionId, ...extra }), from);
  // Other preferences, other senders and other documents are refused.
  for (const extra of [{ page: false }, { writing: true }, { captions: true }])
    assert.equal(
      (await send('page.edge-preferences', extra)).ok,
      false,
      JSON.stringify(extra),
    );
  assert.equal(
    (await send('page.edge-preferences', { compactEdge: true }, uiSender())).ok,
    false,
  );
  assert.equal(
    (
      await send(
        'page.edge-preferences',
        { compactEdge: true },
        { ...sender, documentId: 'forged' },
      )
    ).ok,
    false,
  );
  const saved = await send('page.edge-preferences', {
    compactEdge: true,
    selection: false,
  });
  assert.ok(saved.ok && saved.data.kind === 'page-preferences');
  assert.equal(saved.data.preferences.compactEdge, true);
  assert.equal(saved.data.preferences.selection, false);
  assert.equal(saved.data.preferences.autoSelection, false);
  assert.equal(saved.data.preferences.page, true, 'Other choices are kept');
  // Hiding can only remove access, for the sender's own site.
  assert.equal(
    (
      await controller.dispatch(
        request('page.global-configure', { enabled: true }),
        uiSender('popup'),
      )
    ).ok,
    true,
  );
  for (const extra of [
    { scope: 'show' },
    { scope: 'site', origin: 'https://other.example.test' },
  ])
    assert.equal((await send('page.edge-hide', extra)).ok, false);
  assert.equal(
    (
      await send(
        'page.edge-hide',
        { scope: 'site' },
        { ...sender, documentId: 'forged' },
      )
    ).ok,
    false,
  );
  assert.equal((await send('page.edge-hide', { scope: 'site' })).ok, true);
  assert.equal(await controller.edgeSites.allowed(sender.origin), false);
  assert.equal(
    await controller.edgeSites.allowed('https://other.example.test'),
    true,
  );
  assert.equal((await send('page.edge-hide', { scope: 'all' })).ok, true);
  assert.equal((await controller.edgeSites.status()).allSites, false);
  broad = false;
});
