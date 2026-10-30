import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';

const temp = await mkdtemp(join(tmpdir(), 'subtitle-controls-'));
const server = await startFixture(0);
let context;
const errors = [];
let requests = 0;
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  // Scoped grants only in this temporary copy. Real optional permission dialogs
  // remain owner checks; all site/provider responses below are local fixtures.
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      host_permissions: [
        'http://127.0.0.1/*',
        'https://www.youtube.com/*',
        'https://translate.googleapis.com/*',
      ],
    }),
  );
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    viewport: { width: 1280, height: 1000 },
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  context.setDefaultTimeout(12000);
  await context.setOffline(true);
  context.on('page', (page) =>
    page.on('pageerror', (e) => errors.push(e.message)),
  );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'http://127.0.0.1:4173') {
      url.port = String(server.address().port);
      return route.fulfill({ response: await route.fetch({ url: url.href }) });
    }
    if (url.origin === 'https://translate.googleapis.com') {
      requests++;
      const source = url.searchParams.get('q');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([[[`Çeviri: ${source}`, source]], null, 'en']),
      });
    }
    if (url.origin === 'https://www.youtube.com') {
      const files = {
        '/watch': ['tests/fixtures/youtube/index.html', 'text/html'],
        '/fixture.js': ['tests/fixtures/youtube/fixture.js', 'text/javascript'],
        '/pattern.webm': ['tests/fixtures/native/pattern.webm', 'video/webm'],
      };
      const file = files[url.pathname];
      if (file)
        return route.fulfill({
          body: await readFile(file[0]),
          contentType: file[1],
        });
    }
    return route.abort();
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel('Target language', { exact: true }).waitFor();
  // Keyboard-only navigation and save: start at first field, traverse to Save.
  await options.keyboard.press('Tab');
  assert.equal(
    await options.evaluate(() =>
      document.activeElement.getAttribute('aria-label'),
    ),
    'Source language',
  );
  await options.keyboard.press('ControlOrMeta+A');
  await options.keyboard.type('en');
  for (let i = 0; i < 7; i++) await options.keyboard.press('Tab');
  assert.equal(
    await options.evaluate(() => document.activeElement.textContent),
    'Save preferences',
  );
  await options.keyboard.press('Enter');
  await options.getByText('Preferences saved.', { exact: true }).waitFor();
  await options.getByLabel('Engine', { exact: true }).selectOption('google');
  await options.getByRole('button', { name: 'Apply engine' }).click();
  await options.getByText('Engine selected.', { exact: false }).waitFor();
  assert.equal(requests, 0, 'Saving/selecting must not send a provider test');
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup
    .getByRole('button', { name: 'Enable captions', exact: true })
    .waitFor();
  assert.equal(
    await popup.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((r) => /\/client-[\w-]+\.js/.test(r.name)),
    ),
    false,
  );
  await popup.locator('summary').focus();
  await popup.keyboard.press('Enter');
  await popup.getByLabel('Target language', { exact: true }).waitFor();
  await popup.keyboard.press('Tab');
  assert.equal(
    await popup.evaluate(() =>
      document.activeElement.getAttribute('aria-label'),
    ),
    'Source language',
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(
    () => document.querySelector('video').textTracks[0].cues?.length === 6,
  );
  const send = (type, extra = {}) =>
    options.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'controls-browser',
      type,
      ...extra,
    });
  async function enable() {
    await page.bringToFront();
    const result = await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        version: 1,
        requestId: 'controls-playback',
        type: 'playback.enable',
        youtubeSourceConfirmed: true,
      }),
    );
    assert.equal(result.data?.state, 'enabled');
  }
  await page.evaluate(() => {
    const v = document.querySelector('video');
    v.pause();
    v.currentTime = 1;
  });
  await enable();
  const overlay = page.locator('subtitle-translator-overlay');
  const caption = overlay.locator('.caption');
  await page.waitForFunction(
    () =>
      document
        .querySelector('subtitle-translator-overlay')
        ?.shadowRoot.querySelector('.caption').textContent ===
      'Hello from the timing lab.\nÇeviri: Hello from the timing lab.',
  );
  await overlay
    .getByLabel('Display mode', { exact: true })
    .selectOption('translated');
  await page.waitForFunction(
    () =>
      document
        .querySelector('subtitle-translator-overlay')
        ?.shadowRoot.querySelector('.caption').textContent ===
      'Çeviri: Hello from the timing lab.',
  );
  const larger = overlay.getByRole('button', { name: 'Larger text' });
  await larger.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () =>
      document
        .querySelector('subtitle-translator-overlay')
        .style.getPropertyValue('--size') === '26px',
  );
  assert.equal(
    await larger.evaluate((el) => el.getRootNode().activeElement === el),
    true,
    'Live preferences retain keyboard focus',
  );
  await overlay.getByRole('button', { name: 'Toggle contrast' }).click();
  await overlay.getByRole('button', { name: 'Move captions' }).click();
  assert.equal(
    await overlay.evaluate((el) => el.style.getPropertyValue('--caption-bg')),
    '#000',
  );
  await overlay.locator('.wrap.top').waitFor();
  await overlay
    .getByLabel('Display mode', { exact: true })
    .selectOption('original');
  await page.waitForFunction(
    () =>
      document
        .querySelector('subtitle-translator-overlay')
        ?.shadowRoot.querySelector('.caption').textContent ===
      'Hello from the timing lab.',
  );
  const beforeRTL = requests;
  await page.evaluate(() => {
    const track = document.querySelector('video').textTracks[0];
    track.cues[0].text = 'مرحبا بالعالم <img src=x onerror=alert(1)>';
  });
  await page.waitForFunction(() =>
    document
      .querySelector('subtitle-translator-overlay')
      ?.shadowRoot.querySelector('.caption')
      .textContent.startsWith('مرحبا'),
  );
  assert.equal(await caption.getAttribute('dir'), 'auto');
  assert.equal(
    await caption.evaluate((el) => getComputedStyle(el).direction),
    'rtl',
  );
  assert.equal(await caption.locator('img').count(), 0);
  assert.equal(requests, beforeRTL, 'Original-only mode sends no translation');
  await options
    .getByLabel('Interface language', { exact: true })
    .selectOption('tr');
  await options
    .getByRole('button', { name: 'Save preferences', exact: true })
    .click();
  await options.getByText('Tercihler kaydedildi.', { exact: true }).waitFor();
  await overlay.getByRole('button', { name: 'Altyazıyı kapat' }).waitFor();
  assert.equal(await options.locator('html').getAttribute('lang'), 'tr');
  await popup.getByRole('button', { name: 'Ayarları aç' }).waitFor();
  await mkdir('test-results', { recursive: true });
  await options.screenshot({
    path: 'test-results/controls-options-tr.png',
    fullPage: true,
  });
  await options.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await options.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await options.screenshot({
    path: 'test-results/controls-options-mobile.png',
    fullPage: true,
  });
  await options.setViewportSize({ width: 1280, height: 1000 });
  await popup.locator('summary').click();
  await popup.setViewportSize({ width: 360, height: 600 });
  await popup.screenshot({ path: 'test-results/controls-popup-tr.png' });
  await overlay.getByRole('button', { name: 'Altyazıyı kapat' }).click();
  await overlay.waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'showing',
  );
  // Switch back to English without provider use. Test the optional site's scoped
  // registration, SPA/replacement, refresh and manual-disable suppression.
  await options.getByLabel('Arayüz dili', { exact: true }).selectOption('en');
  await options
    .getByRole('button', { name: 'Tercihleri kaydet', exact: true })
    .click();
  await options.getByText('Preferences saved.', { exact: true }).waitFor();
  await options.getByLabel('Engine', { exact: true }).selectOption('none');
  await options.getByRole('button', { name: 'Apply engine' }).click();
  await options.getByText('Engine selected.', { exact: false }).waitFor();
  await page.goto('https://www.youtube.com/watch?v=synthetic');
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  assert.equal(await overlay.count(), 0);
  await options
    .getByLabel('Use original YouTube captions; never Auto-translate.')
    .check();
  // Exercise the denial UI without an OS permission dialog. Production code is
  // unchanged; the real dialog is still a manual checkpoint.
  await options.evaluate(() => {
    window.restorePermissionRequest = chrome.permissions.request;
    chrome.permissions.request = async () => false;
  });
  await options
    .getByRole('button', { name: 'Allow YouTube and turn on' })
    .click();
  await options
    .getByText('YouTube access was not granted. You can try again.', {
      exact: true,
    })
    .waitFor();
  assert.equal(await overlay.count(), 0);
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.scripting.getRegisteredContentScripts()).length,
    ),
    0,
  );
  await options.evaluate(() => {
    chrome.permissions.request = window.restorePermissionRequest;
    delete window.restorePermissionRequest;
  });
  await options
    .getByRole('button', { name: 'Allow YouTube and turn on' })
    .click();
  await options
    .getByText('Automatic captions are on.', { exact: true })
    .waitFor();
  await overlay.waitFor();
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.scripting.getRegisteredContentScripts()).length,
    ),
    1,
  );
  await page.reload();
  await overlay.waitFor();
  await page.evaluate(() => window.fixture.next());
  await overlay.waitFor({ state: 'detached' });
  await overlay.waitFor();
  await page.evaluate(() => window.fixture.replace());
  await overlay.waitFor({ state: 'detached' });
  await overlay.waitFor();
  await overlay
    .getByRole('button', { name: 'Disable captions', exact: true })
    .click();
  await overlay.waitFor({ state: 'detached' });
  await page.evaluate(() => window.fixture.replace());
  await page.waitForTimeout(3200);
  assert.equal(
    await overlay.count(),
    0,
    'Manual stop must suppress automatic reactivation until refresh',
  );
  await page.reload();
  await overlay.waitFor();
  // Logical opt-out uses real unregister + stop; removal of install-time test grants
  // is impossible, so Chrome's optional revoke dialog is deliberately not claimed.
  assert.equal(
    (await send('site.configure', { enabled: false, originalConfirmed: false }))
      .ok,
    true,
  );
  await overlay.waitFor({ state: 'detached' });
  assert.equal(
    await worker.evaluate(
      async () => (await chrome.scripting.getRegisteredContentScripts()).length,
    ),
    0,
  );
  await page.reload();
  await page.waitForTimeout(1500);
  assert.equal(await overlay.count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        browser: context.browser().version(),
        checks:
          'keyboard, locale, live appearance/focus, RTL/plain text, no-request original mode, scoped auto registration, SPA/replacement, refresh, manual stop, opt-out',
        providerRequests: requests,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
