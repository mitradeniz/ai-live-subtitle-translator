import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';
const live = process.argv.includes('--live');
const temp = await mkdtemp(join(tmpdir(), 'subtitle-google-'));
const server = await startFixture(0);
let context;
let count = 0;
let mode = 'success';
let release;
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.deepEqual(manifest.optional_host_permissions, [
    'https://translate.googleapis.com/*',
    'https://api.openai.com/*',
    'https://translation.googleapis.com/*',
    'https://api.deepseek.com/*',
    'https://generativelanguage.googleapis.com/*',
  ]);
  assert.equal(manifest.host_permissions, undefined);
  // Temporary grants only: no activeTab gesture or optional-permission dialog automation is claimed.
  manifest.host_permissions = [
    'http://127.0.0.1/*',
    'https://translate.googleapis.com/*',
  ];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  context.setDefaultTimeout(12000);
  if (!live) await context.setOffline(true);
  const errors = [];
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
    if (url.origin !== 'https://translate.googleapis.com') return route.abort();
    count++;
    assert.equal(url.pathname, '/translate_a/single');
    assert.equal(route.request().headers().cookie, undefined);
    assert.equal(route.request().headers().authorization, undefined);
    if (live) {
      if (count > 1) return route.abort();
      return route.continue();
    }
    if (mode === 'hold')
      await new Promise((resolve) => {
        release = resolve;
      });
    await route.fulfill(
      mode === 'throttle'
        ? { status: 429, body: '' }
        : mode === 'malformed'
          ? { contentType: 'application/json', body: '{}' }
          : {
              contentType: 'application/json',
              body: JSON.stringify([
                [
                  [
                    'Zamanlama laboratuvarından merhaba.',
                    'Hello from the timing lab.',
                  ],
                ],
                null,
                'en',
              ]),
            },
    );
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  const send = async (type, extra = {}) => {
    await page.bringToFront();
    return popup.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'google-browser',
      type,
      ...extra,
    });
  };
  const caption = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.caption').textContent === text,
      text,
    );
  const status = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.provider-status')
          .textContent.includes(text),
      text,
    );
  const seek = async (time) => {
    await page.evaluate((time) => {
      const v = document.querySelector('video');
      v.pause();
      v.currentTime = time;
    }, time);
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  };
  await send('playback.enable');
  await seek(1);
  await caption('Hello from the timing lab.');
  assert.equal(count, 0);
  await options
    .getByRole('button', { name: 'Enable experimental Google' })
    .click();
  await options
    .getByRole('status')
    .filter({ hasText: 'Google enabled.' })
    .waitFor();
  const start = performance.now();
  await send('playback.enable');
  await caption(
    'Hello from the timing lab.\nZamanlama laboratuvarından merhaba.',
  );
  const elapsed = Math.round(performance.now() - start);
  assert.equal(count, 1);
  assert.equal(
    await page
      .locator('subtitle-translator-overlay')
      .evaluate((host) => host.shadowRoot.querySelector('.label').textContent),
    'Google · Experimental · Captions sent to Google',
  );
  // Verify disable also reaches content contexts after the worker loses its registry.
  const cdp = await context.newCDPSession(options);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  // This copy has a required test host grant, so test logical disable separately.
  await options.evaluate(() =>
    chrome.runtime.sendMessage({
      version: 1,
      requestId: 'google-browser',
      type: 'google.disable',
    }),
  );
  await caption('Hello from the timing lab.');
  await status('Translation stopped');
  await seek(3);
  assert.equal(count, 1);
  if (!live) {
    await options
      .getByRole('button', { name: 'Disable Google and remove access' })
      .click();
    // Required test grants cannot be removed. Reload UI to read logical provider state.
    await options.reload();
    await options
      .getByRole('button', { name: 'Enable experimental Google' })
      .click();
    await options
      .getByRole('status')
      .filter({ hasText: 'Google enabled.' })
      .waitFor();
    await page.waitForTimeout(1100);
    mode = 'malformed';
    await send('playback.enable');
    await status('unsupported response');
    await caption('Hello from the timing lab.');
    await page.waitForTimeout(1100);
    mode = 'hold';
    await seek(1);
    await page.waitForFunction(
      () => document.querySelector('video').currentTime < 2,
    );
    const deadline = Date.now() + 5000;
    while (!release) {
      if (Date.now() > deadline) throw new Error('No in-flight request');
      await page.waitForTimeout(20);
    }
    await seek(10);
    release();
    release = undefined;
    await page.waitForTimeout(400);
    assert.ok(
      !(
        await page
          .locator('subtitle-translator-overlay')
          .evaluate(
            (host) => host.shadowRoot.querySelector('.caption').textContent,
          )
      ).includes('Zamanlama'),
    );
    await page.waitForTimeout(1100);
    mode = 'throttle';
    await seek(1);
    await status('denied or throttled');
    const blockedCount = count;
    await page.waitForTimeout(1100);
    await seek(3);
    await status('denied or throttled');
    assert.equal(count, blockedCount);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: context.browser().version(),
      mode: live ? 'live-one-request' : 'offline-routed',
      requests: count,
      captionReadyMs: elapsed,
      result: 'passed',
    }),
  );
} finally {
  release?.();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
