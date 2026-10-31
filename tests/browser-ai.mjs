import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';

// Always offline and routed. This suite never reads an environment key or calls a live provider.
const SENTINEL = 'SENTINEL_NOT_A_REAL_KEY';
const temp = await mkdtemp(join(tmpdir(), 'subtitle-ai-'));
const server = await startFixture(0);
let context;
let options;
let popup;
let page;
let count = 0;
let mode = 'success';
let release;
let id;
const errors = [];
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, [
    'https://translate.googleapis.com/*',
    'https://api.openai.com/*',
    'https://translation.googleapis.com/*',
    'https://api.deepseek.com/*',
    'https://generativelanguage.googleapis.com/*',
    'https://www.youtube.com/*',
    'https://*/*',
    'http://*/*',
  ]);
  // This test copy supplies grants; real Chrome grant/removal remains an owner check.
  manifest.host_permissions = [
    'http://127.0.0.1/*',
    'https://api.openai.com/*',
  ];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  async function launch() {
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
    await context.setOffline(true);
    context.on('page', (page) =>
      page.on('pageerror', (error) => errors.push(error.message)),
    );
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (url.origin === 'http://127.0.0.1:4173') {
        url.port = String(server.address().port);
        return route.fulfill({
          response: await route.fetch({ url: url.href }),
        });
      }
      assert.equal(
        url.origin,
        'https://api.openai.com',
        'Unexpected remote destination',
      );
      assert.equal(url.pathname, '/v1/chat/completions');
      count++;
      assert.equal(
        route.request().headers().authorization,
        `Bearer ${SENTINEL}`,
      );
      assert.equal(route.request().headers().cookie, undefined);
      const body = route.request().postDataJSON();
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.ok(!JSON.stringify(body).includes(SENTINEL));
      const data = JSON.parse(body.messages[1].content);
      if (mode === 'hold')
        await new Promise((resolve) => {
          release = resolve;
        });
      await route.fulfill(
        mode === 'auth'
          ? { status: 401, body: '' }
          : mode === 'malformed'
            ? { contentType: 'application/json', body: '{}' }
            : {
                contentType: 'application/json',
                body: JSON.stringify({
                  choices: [
                    {
                      finish_reason: 'stop',
                      message: {
                        role: 'assistant',
                        refusal: null,
                        content: JSON.stringify({
                          items: data.items.map((item) => ({
                            id: item.id,
                            revision: item.revision,
                            text: 'Merhaba çığ 😊 <b>dünya</b>',
                          })),
                        }),
                      },
                    },
                  ],
                }),
              },
      );
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    id = new URL(worker.url()).hostname;
    options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.locator('details.api-settings > summary').click();
    // A restored worker may predate Playwright routing; recreate it after routes are installed.
    const startup = await context.newCDPSession(options);
    await startup.send('ServiceWorker.enable');
    await startup.send('ServiceWorker.stopAllWorkers');
    await startup.detach();
    await options.reload();
    await options.locator('details.api-settings > summary').click();
    await options
      .getByRole('button', { name: 'Save AI profile and key' })
      .waitFor();
    await options.waitForFunction(
      () =>
        !document.querySelector('[aria-labelledby="ai-title"] fieldset')
          .disabled,
    );
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    page = await context.newPage();
    await page.goto('http://127.0.0.1:4173');
    await page.waitForFunction(
      () => document.querySelector('video').readyState >= 2,
    );
  }
  await launch();
  const aiPanel = () => options.locator('[aria-labelledby="ai-title"]');
  const feedback = async (text) => {
    try {
      await aiPanel().getByRole('status').filter({ hasText: text }).waitFor();
    } catch {
      throw new Error(
        `Expected ${text}; received ${await aiPanel().getByRole('status').textContent()}; request count ${count}`,
      );
    }
  };
  const saveKey = async (remember = false) => {
    await options.getByLabel('API key', { exact: true }).fill(SENTINEL);
    await options
      .getByLabel('Remember this new key on this device')
      .setChecked(remember);
    await options
      .getByRole('button', { name: 'Save AI profile and key' })
      .click();
    await feedback('Saved without contacting');
    assert.equal(
      await options.getByLabel('API key', { exact: true }).inputValue(),
      '',
    );
  };
  const send = async (type) => {
    await page.bringToFront();
    const reply = await popup.evaluate(
      (type) =>
        chrome.runtime.sendMessage({
          version: 1,
          requestId: 'ai-browser',
          type,
        }),
      type,
    );
    assert.equal(reply.ok, true);
    return reply;
  };
  const seek = async (time) => {
    await page.evaluate((time) => {
      const video = document.querySelector('video');
      video.pause();
      video.currentTime = time;
    }, time);
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  };
  const status = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.provider-status')
          .textContent.includes(text),
      text,
    );
  const caption = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.caption').textContent === text,
      text,
    );
  await saveKey();
  assert.equal(count, 0);
  await options
    .getByRole('button', { name: 'Use OpenAI for captions' })
    .click();
  await feedback('OpenAI selected');
  assert.equal(count, 0);
  await options.getByRole('button', { name: 'Run small paid test' }).click();
  await feedback('Small test passed');
  assert.equal(count, 1);
  await page.waitForTimeout(1100);
  await seek(1);
  await send('playback.enable');
  await caption('Hello from the timing lab.\nMerhaba çığ 😊 <b>dünya</b>');
  assert.equal(count, 2);
  assert.equal(
    await page
      .locator('subtitle-translator-overlay')
      .evaluate((host) => host.shadowRoot.querySelector('.caption b')),
    null,
  );
  assert.match(
    await page
      .locator('subtitle-translator-overlay')
      .evaluate((host) => host.shadowRoot.querySelector('.label').textContent),
    /OpenAI.*api.openai.com/,
  );
  await mkdir('test-results', { recursive: true });
  await options.setViewportSize({ width: 1440, height: 1000 });
  await options.screenshot({
    path: 'test-results/options-ai-desktop.png',
    fullPage: true,
  });
  await options.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await options.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await options.screenshot({
    path: 'test-results/options-ai-mobile.png',
    fullPage: true,
  });
  await options.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(1100);
  mode = 'malformed';
  await options.evaluate(() =>
    chrome.runtime.sendMessage({
      version: 1,
      requestId: 'clear-fault-cache',
      type: 'cache.clear',
    }),
  );
  await seek(3);
  await send('playback.enable');
  await status('unsupported response');
  await caption('Hello from the timing lab.');
  await page.waitForTimeout(1100);
  mode = 'hold';
  await seek(1);
  const deadline = Date.now() + 5000;
  while (!release) {
    if (Date.now() > deadline) throw new Error('No pending AI request');
    await page.waitForTimeout(20);
  }
  await options.getByRole('button', { name: 'Delete AI key' }).click();
  await feedback('Key deleted');
  release();
  release = undefined;
  await status('Translation stopped');
  await caption('Hello from the timing lab.');
  const afterDelete = count;
  await page.waitForTimeout(1100);
  assert.equal((await send('playback.enable')).data.state, 'key-required');
  await popup
    .getByText('Translation blocked · Key missing', { exact: true })
    .waitFor();
  assert.equal(count, afterDelete);
  mode = 'auth';
  await saveKey();
  await options.getByRole('button', { name: 'Run small paid test' }).click();
  await feedback('Provider rejected');
  const afterAuth = count;
  await page.waitForTimeout(1100);
  await options.getByRole('button', { name: 'Run small paid test' }).click();
  await feedback('Provider rejected');
  assert.equal(count, afterAuth);
  const cdp = await context.newCDPSession(options);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  await options.reload();
  await options.locator('details.api-settings > summary').click();
  await aiPanel()
    .getByText(/Saved key: this session only/)
    .waitFor();
  await options.getByRole('button', { name: 'Run small paid test' }).click();
  await feedback('Provider rejected');
  assert.equal(count, afterAuth);
  await context.close();
  await launch();
  await aiPanel()
    .getByText(/Saved key: none/)
    .waitFor();
  assert.equal(count, afterAuth);
  mode = 'success';
  await saveKey(true);
  await context.close();
  await launch();
  await aiPanel()
    .getByText(/Saved key: remembered on this device/)
    .waitFor();
  assert.equal(count, afterAuth);
  await options.getByRole('button', { name: 'Run small paid test' }).click();
  await feedback('Small test passed');
  await options.getByRole('button', { name: 'Delete AI key' }).click();
  await feedback('Key deleted');
  await context.close();
  await launch();
  await aiPanel()
    .getByText(/Saved key: none/)
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: context.browser().version(),
      mode: 'offline-routed-sentinel-only',
      requests: count,
      result: 'passed',
    }),
  );
} finally {
  release?.();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
