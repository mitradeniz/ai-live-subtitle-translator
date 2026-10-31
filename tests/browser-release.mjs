import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { archive, version, checksum } from '../scripts/check-release.mjs';

// Install the verified ZIP unchanged, with no test host grants or stored keys.
// Capture real implemented settings; never fabricate translated caption output.
const temp = await mkdtemp(join(tmpdir(), 'subtitle-release-'));
const extension = join(temp, 'extension');
const screenshots = resolve('.output/store-assets', version);
let context;
const errors = [];
const requests = [];
try {
  await mkdir(extension);
  await mkdir(screenshots, { recursive: true });
  execFileSync('unzip', ['-q', archive, '-d', extension]);
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  context.setDefaultTimeout(12000);
  await context.setOffline(true);
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('chrome-extension:')) return route.continue();
    requests.push(url);
    return route.abort();
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel('Target language', { exact: true }).waitFor();
  // Use Chrome's ordinary page zoom, not a fabricated/re-styled screenshot.
  await options.evaluate(async () => {
    const tab = await chrome.tabs.getCurrent();
    await chrome.tabs.setZoom(tab.id, 0.9);
  });
  assert.equal(
    await options.getByLabel('Engine', { exact: true }).inputValue(),
    'none',
  );
  assert.equal(
    await options.locator('.build-badge').textContent(),
    'Limited preview',
  );
  assert.match(
    await options.locator('footer').textContent(),
    new RegExp(version.replaceAll('.', '\\.')),
  );
  assert.deepEqual(
    (await worker.evaluate(() => chrome.permissions.getAll())).origins ?? [],
    [],
  );
  await options.screenshot({ path: join(screenshots, '01-settings-en.png') });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByRole('button', { name: 'Open settings' }).waitFor();
  assert.ok(!(await popup.locator('body').textContent()).includes('MOCK'));
  assert.match(
    await popup.locator('.popup-footer').textContent(),
    new RegExp(version.replaceAll('.', '\\.')),
  );
  const send = (type, extra = {}) =>
    options.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'release-install',
      type,
      ...extra,
    });
  for (const credentialId of ['ai', 'google-cloud']) {
    const result = await send('credentials.status', { credentialId });
    assert.equal(result.ok, true);
    assert.equal(result.data.status.configured, false);
  }
  await options
    .getByLabel('Interface language', { exact: true })
    .selectOption('tr');
  await options
    .getByRole('button', { name: 'Save preferences', exact: true })
    .click();
  await options.getByText('Tercihler kaydedildi.', { exact: true }).waitFor();
  await options.evaluate(() => window.scrollTo(0, 0));
  await options.screenshot({ path: join(screenshots, '02-settings-tr.png') });
  assert.equal((await send('data.clear')).ok, true);
  await options.reload();
  assert.equal(
    await options.getByLabel('Target language', { exact: true }).inputValue(),
    'tr',
  );
  assert.equal(
    await options
      .getByLabel('Interface language', { exact: true })
      .inputValue(),
    'en',
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(
    requests,
    [],
    'A fresh install must not call providers or development servers',
  );
  const result = {
    version,
    checksum,
    browser: context.browser().version(),
    platform: `${process.platform}-${process.arch}`,
    installedUnmodifiedArchive: true,
    providerRequests: 0,
    checks:
      'fresh install, no default engine/host grants/keys, options/popup, locale, data clear; no live caption/provider claim',
  };
  await writeFile(
    join(screenshots, 'capture.json'),
    JSON.stringify(result, null, 2) + '\n',
  );
  for (const name of ['01-settings-en.png', '02-settings-tr.png']) {
    const png = await readFile(join(screenshots, name));
    assert.equal(png.readUInt32BE(16), 1280);
    assert.equal(png.readUInt32BE(20), 800);
  }
  console.log(JSON.stringify(result));
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
