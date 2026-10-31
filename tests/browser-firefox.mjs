import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { firefoxSession } from './firefox-session.mjs';
import { startFixture } from '../scripts/fixture-server.mjs';

const sentinel = 'SENTINEL_NOT_A_REAL_FIREFOX_KEY';
const addonId = 'ai-video-subtitle-translator@mitradeniz';
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const productionArchive = resolve(
  `.output/${pkg.name}-${pkg.version}-firefox.zip`,
);
const temporary = await mkdtemp(join(tmpdir(), 'subtitle-firefox-contract-'));
const fixture = await startFixture(0);
let f;
const wait = async (read, predicate = Boolean) => {
  for (let i = 0; i < 100; i++) {
    const result = await read();
    if (predicate(result)) return result;
    await delay(100);
  }
  throw new Error('Firefox condition timed out');
};
try {
  f = await firefoxSession();
  await f.command('webExtension.install', {
    extensionData: { type: 'archivePath', path: productionArchive },
  });
  const options = await f.open(f.extensionOrigin + 'options.html');
  const send = (type, extra = {}, context = options) =>
    f.evaluate(
      context,
      `browser.runtime.sendMessage(${JSON.stringify({ version: 1, requestId: 'firefox-contract', type, ...extra })})`,
    );
  const initial = await send('settings.read');
  assert.equal(initial.ok, true);
  assert.equal(initial.data.settings.targetLanguage, 'tr');
  assert.deepEqual(
    (await f.evaluate(options, 'browser.permissions.getAll()')).origins ?? [],
    [],
  );
  const popup = await f.open(f.extensionOrigin + 'popup.html');
  const popupState = await send('popup.read', {}, popup);
  assert.equal(popupState.ok, true, JSON.stringify(popupState));
  await f
    .command('browsingContext.setViewport', {
      context: options,
      viewport: { width: 1280, height: 800 },
      devicePixelRatio: 1,
    })
    .catch(() => {});
  await wait(() => f.evaluate(options, "!!document.querySelector('select')"));
  const directory = resolve('.output/store-assets/0.2.2');
  await mkdir(directory, { recursive: true });
  const screenshot = await f
    .command('browsingContext.captureScreenshot', { context: options })
    .catch(() => null);
  if (screenshot)
    await writeFile(
      join(directory, 'firefox-settings-en.png'),
      Buffer.from(screenshot.data, 'base64'),
    );
  await delay(300);
  const idleNotification = await f.evaluate(
    options,
    "browser.storage.local.get('trusted-state-change')",
  );
  await send('settings.read');
  await send('popup.read', {}, popup);
  await delay(300);
  assert.deepEqual(
    await f.evaluate(
      options,
      "browser.storage.local.get('trusted-state-change')",
    ),
    idleNotification,
    'Unchanged status reads must not create a notification loop',
  );
  const key = {
    schemaVersion: 1,
    origin: 'https://api.openai.com',
    key: sentinel,
  };
  assert.equal(
    (await send('credentials.set', { credentialId: 'ai', credential: key })).ok,
    true,
  );
  assert.equal(
    (await send('credentials.status', { credentialId: 'ai' })).data.status
      .retention,
    'session',
  );
  assert.ok(
    !JSON.stringify(
      await f.evaluate(options, 'browser.storage.local.get(null)'),
    ).includes(sentinel),
  );
  assert.equal(
    (
      await send('credentials.set', {
        credentialId: 'ai',
        credential: key,
        rememberOnDevice: true,
      })
    ).ok,
    true,
  );
  assert.equal(
    (await send('credentials.status', { credentialId: 'ai' })).data.status
      .retention,
    'device',
  );
  assert.ok(
    !JSON.stringify(
      await f.evaluate(options, 'browser.storage.local.get(null)'),
    ).includes(sentinel),
  );
  assert.ok(!JSON.stringify(await send('settings.export')).includes(sentinel));
  // An actual extension reload preserves the extension-origin database and clears
  // the browser session area. No production preferences or signatures changed.
  await f.evaluate(options, '(browser.runtime.reload(), true)').catch(() => {});
  await delay(1000);
  const after = await f.open(f.extensionOrigin + 'options.html');
  assert.equal(
    (await send('credentials.status', { credentialId: 'ai' }, after)).data
      .status.retention,
    'device',
  );
  assert.equal(
    (
      await send(
        'credentials.set',
        { credentialId: 'ai', credential: key },
        after,
      )
    ).ok,
    true,
  );
  await f.evaluate(after, '(browser.runtime.reload(), true)').catch(() => {});
  await delay(1000);
  const afterSession = await f.open(f.extensionOrigin + 'options.html');
  assert.equal(
    (await send('credentials.status', { credentialId: 'ai' }, afterSession))
      .data.status.configured,
    false,
  );
  await f.close();
  f = undefined;

  // Independent fixture-only copy simulates the user's host permission grants.
  // The local mock cannot contact any provider; it is never in release output.
  const extension = join(temporary, 'extension');
  await cp(resolve('.output/firefox-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  manifest.host_permissions = [
    'http://127.0.0.1/*',
    'https://translate.googleapis.com/*',
  ];
  manifest.background.scripts.unshift('fixture-provider.js');
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(
    join(extension, 'fixture-provider.js'),
    `globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.origin !== 'https://translate.googleapis.com' || url.pathname !== '/translate_a/single' || init.credentials !== 'omit') throw new Error('Unexpected fixture destination');
    const original = url.searchParams.get('q');
    return new Response(JSON.stringify([[[ '[FIREFOX TEST] ' + original, original ]]]), { headers: { 'content-type': 'application/json' } });
  };`,
  );
  f = await firefoxSession();
  await f.command('webExtension.install', {
    extensionData: { type: 'path', path: extension },
  });
  const ui = await f.open(f.extensionOrigin + 'options.html');
  assert.equal(
    (
      await send(
        'credentials.set',
        { credentialId: 'ai', credential: key, rememberOnDevice: true },
        ui,
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await send(
        'credentials.set',
        {
          credentialId: 'google-cloud',
          credential: { ...key, origin: 'https://translation.googleapis.com' },
        },
        ui,
      )
    ).ok,
    true,
  );
  const toolbar = await f.open(f.extensionOrigin + 'popup.html');
  const url = `http://127.0.0.1:${fixture.address().port}/`;
  const video = await f.open(url);
  await wait(() =>
    f.evaluate(video, 'document.querySelector("video").readyState >= 2'),
  );
  // The toolbar path uses the browser's actual active tab. Focus fixture before commands.
  await f.command('browsingContext.activate', { context: video });
  assert.equal((await send('google.enable', {}, ui)).ok, true);
  const preference = {
    ...initial.data.settings,
    sourceLanguage: 'en',
    displayMode: 'translated',
  };
  delete preference.schemaVersion;
  assert.equal(
    (await send('controls.update', { preferences: preference }, toolbar)).ok,
    true,
  );
  assert.equal(
    (await send('playback.enable', {}, toolbar)).data.state,
    'enabled',
  );
  const caption = () =>
    f.evaluate(
      video,
      'document.querySelector("subtitle-translator-overlay")?.shadowRoot?.textContent',
    );
  await wait(caption, (text) => text?.includes('[FIREFOX TEST]'));
  await f.evaluate(
    video,
    '(document.querySelector("video").currentTime = 6.5, true)',
  );
  await wait(caption, (text) => text?.includes('overlap'));
  // Inspect the real isolated-world principal and browser-generated sender.
  const content = await f.evaluate(
    ui,
    `browser.tabs.query({active:true,currentWindow:true}).then(async ([tab]) => (await browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},func:async () => {
    const reply = await browser.runtime.sendMessage({version:1,requestId:'forged',type:'credentials.status',credentialId:'ai'});
    const mutation = await browser.runtime.sendMessage({version:1,requestId:'forged',type:'settings.read'});
    const publicData = await browser.storage.local.get(null);
    let sessionReadable = false;
    try { await browser.storage.session.get(null); sessionReadable = true; } catch {}
    const db = await new Promise((resolve,reject) => { const r=indexedDB.open('subtitle-trusted-state',1); r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error); });
    const privateStoreVisible = db.objectStoreNames.contains('records'); db.close();
    await browser.storage.local.set({'settings.v1':{schemaVersion:1,targetLanguage:'de'}});
    return {reply,mutation,publicData,sessionReadable,privateStoreVisible};
  }}))[0].result)`,
  );
  assert.equal(content.reply.ok, false);
  assert.equal(content.mutation.ok, false);
  assert.equal(content.sessionReadable, false);
  assert.equal(content.privateStoreVisible, false);
  assert.ok(!JSON.stringify(content.publicData).includes(sentinel));
  assert.equal(
    (await send('settings.read', {}, ui)).data.settings.targetLanguage,
    'tr',
  );
  assert.equal(
    (await send('playback.disable', {}, toolbar)).data.state,
    'disabled',
  );
  assert.equal(
    await f.evaluate(
      video,
      '!!document.querySelector("subtitle-translator-overlay")',
    ),
    false,
  );
  assert.equal((await send('data.clear', {}, ui)).ok, true);
  console.log(
    JSON.stringify({
      browser: f.session.capabilities.browserVersion,
      unmodifiedInstall: true,
      sessionAndDeviceRetention: 'passed',
      contentStorageAndMessageBoundary: 'passed',
      timedCaptionsWithMock: 'passed',
      clearData: 'passed',
      liveProvider: false,
      addonId,
    }),
  );
} finally {
  await f?.close();
  await new Promise((resolve) => fixture.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
