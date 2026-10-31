import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { openToolbarPopup } from './browser-toolbar.mjs';

const temp = await mkdtemp(join(tmpdir(), 'subtitle-boundaries-'));
const production = resolve('.output/chrome-mv3');
const sentinel = 'SENTINEL_NOT_A_REAL_BROWSER_KEY';
const credential = {
  schemaVersion: 1,
  origin: 'https://provider.example.test',
  key: sentinel,
};
const errors = [];
let context;
let server;
let browserVersion;

async function launch(extension, profile) {
  const opened = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
    ],
  });
  opened.setDefaultTimeout(10_000);
  opened.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
  });
  return opened;
}

async function optionsPage(opened) {
  const worker =
    opened.serviceWorkers()[0] ?? (await opened.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const page = await opened.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.locator('details.api-settings > summary').click();
  try {
    await page.getByLabel('Target language').waitFor();
  } catch {
    const state = await page
      .getByRole('alert')
      .textContent()
      .catch(() => null);
    throw new Error(
      `Options initialization failed: ${state ?? 'no rendered error'}; browser errors: ${JSON.stringify(errors)}`,
    );
  }
  return { page, worker, id };
}

async function send(page, type, extra = {}) {
  return page.evaluate((message) => chrome.runtime.sendMessage(message), {
    version: 1,
    requestId: 'browser-test',
    type,
    ...extra,
  });
}

try {
  const manifest = JSON.parse(
    await readFile(join(production, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.host_permissions, undefined);
  const profile = join(temp, 'production-profile');
  context = await launch(production, profile);
  browserVersion = context.browser().version();
  const { page, worker, id } = await optionsPage(context);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole('button', { name: 'Open settings' }).waitFor();
  await popup
    .getByRole('group', { name: 'Translation provider', exact: true })
    .waitFor();
  assert.ok(
    await popup.evaluate(
      () => document.body.getBoundingClientRect().height < 600,
    ),
    'Popup must size to content instead of the browser viewport',
  );
  const toolbar = await openToolbarPopup(context, worker);
  for (const type of ['credentials.status', 'settings.export']) {
    const result = await toolbar.evaluate(
      (message) => chrome.runtime.sendMessage(message),
      {
        version: 1,
        requestId: 'toolbar-boundary',
        type,
        ...(type === 'credentials.status' ? { credentialId: 'ai' } : {}),
      },
    );
    assert.deepEqual(result, { ok: false, error: 'FORBIDDEN' });
  }
  assert.equal(
    (
      await toolbar.evaluate(() =>
        chrome.runtime.sendMessage({
          version: 1,
          requestId: 'toolbar-boundary',
          type: 'settings.read',
        }),
      )
    ).ok,
    true,
  );
  await toolbar.close();
  await popup.getByRole('button', { name: 'Open settings' }).click();
  await page.bringToFront();
  await page.getByLabel('Target language').fill('de');
  await page.getByLabel('Font size').fill('');
  await page.getByLabel('Font size').fill('28');
  await page
    .getByRole('button', { name: 'Save preferences', exact: true })
    .click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Preferences saved.' })
    .waitFor();
  await page.reload();
  await page.getByLabel('Target language').waitFor();
  assert.equal(await page.getByLabel('Target language').inputValue(), 'de');
  assert.equal(await page.getByLabel('Font size').inputValue(), '28');

  for (const [credentialId, rememberOnDevice] of [
    ['ai', false],
    ['google-cloud', true],
  ]) {
    assert.deepEqual(
      await send(page, 'credentials.set', {
        credentialId,
        credential,
        rememberOnDevice,
      }),
      { ok: true, data: { kind: 'saved' } },
    );
  }
  const exported = await send(page, 'settings.export');
  assert.equal(exported.ok, true);
  assert.equal(exported.data.exported.settings.targetLanguage, 'de');
  assert.ok(!JSON.stringify(exported).includes(sentinel));
  const downloadReady = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export saved preferences' }).click();
  const download = await downloadReady;
  const file = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.deepEqual(file, exported.data.exported);
  assert.deepEqual(
    await send(page, 'credentials.read', { credentialId: 'ai' }),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.deepEqual(
    await send(popup, 'credentials.status', { credentialId: 'ai' }),
    { ok: false, error: 'FORBIDDEN' },
  );

  // Force a worker stop and prove the next request runs in a new global context.
  await worker.evaluate(() => {
    globalThis.__boundaryTestMarker = true;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  const afterStop = await send(page, 'credentials.status', {
    credentialId: 'ai',
  });
  assert.deepEqual(afterStop, {
    ok: true,
    data: {
      kind: 'credential-status',
      status: { configured: true, retention: 'session' },
    },
  });
  assert.equal(
    await worker.evaluate(() => globalThis.__boundaryTestMarker),
    undefined,
  );
  assert.equal(
    (await send(page, 'settings.read')).data.settings.targetLanguage,
    'de',
  );

  await context.close();
  context = undefined;
  context = await launch(production, profile);
  const restarted = await optionsPage(context);
  assert.deepEqual(
    (await send(restarted.page, 'credentials.status', { credentialId: 'ai' }))
      .data.status,
    { configured: false, retention: null },
  );
  assert.deepEqual(
    (
      await send(restarted.page, 'credentials.status', {
        credentialId: 'google-cloud',
      })
    ).data.status,
    { configured: true, retention: 'device' },
  );
  assert.equal(
    (await send(restarted.page, 'settings.read')).data.settings.targetLanguage,
    'de',
  );
  await send(restarted.page, 'credentials.delete', {
    credentialId: 'google-cloud',
  });
  assert.equal(
    (
      await send(restarted.page, 'credentials.status', {
        credentialId: 'google-cloud',
      })
    ).data.status.configured,
    false,
  );
  await context.close();
  context = undefined;

  // Add a loopback-only probe to a temporary copy so production gets no site access.
  const instrumented = join(temp, 'instrumented');
  await cp(production, instrumented, { recursive: true });
  await cp(
    'tests/fixtures/boundary-probe.js',
    join(instrumented, 'boundary-probe.js'),
  );
  await writeFile(
    join(instrumented, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      content_scripts: [
        {
          matches: ['http://127.0.0.1/*'],
          js: ['boundary-probe.js'],
          run_at: 'document_idle',
        },
      ],
    }),
  );
  server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(
      '<!doctype html><html><head><title>Boundary fixture</title></head><body>Local test</body></html>',
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  context = await launch(instrumented, join(temp, 'content-profile'));
  const probeOptions = await optionsPage(context);
  await send(probeOptions.page, 'credentials.set', {
    credentialId: 'ai',
    credential,
    rememberOnDevice: true,
  });
  await send(probeOptions.page, 'credentials.set', {
    credentialId: 'google-cloud',
    credential,
  });
  const content = await context.newPage();
  await content.goto(`http://127.0.0.1:${server.address().port}`);
  await content.locator('html[data-boundary-results]').waitFor();
  const result = JSON.parse(
    await content.locator('html').getAttribute('data-boundary-results'),
  );
  assert.equal(result.local, 'denied');
  assert.equal(result.session, 'denied');
  for (const key of ['settings', 'export', 'status', 'delete', 'mutate'])
    assert.deepEqual(result[key], { ok: false, error: 'FORBIDDEN' });
  for (const key of ['read', 'forged', 'fetch', 'oversized'])
    assert.deepEqual(result[key], { ok: false, error: 'INVALID_MESSAGE' });
  assert.deepEqual(result.sessionRequest, {
    ok: false,
    error: 'INVALID_SESSION',
  });
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.equal(
    (
      await send(probeOptions.page, 'credentials.status', {
        credentialId: 'ai',
      })
    ).data.status.configured,
    true,
  );
  assert.deepEqual(errors, []);
  console.log(`Browser boundary checks passed in Chromium ${browserVersion}.`);
  console.log(
    'Verified production preferences/export, forced worker restart, browser restart, credential deletion, and content isolation in a temporary test-only copy.',
  );
} finally {
  await context?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
