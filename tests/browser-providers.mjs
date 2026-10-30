import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';

// Always offline: no live credential, environment key or quota-exhaustion path.
const keys = {
  cloud: 'SENTINEL_NOT_A_REAL_CLOUD_KEY',
  deepseek: 'SENTINEL_NOT_A_REAL_DEEPSEEK_KEY',
  gemini: 'SENTINEL_NOT_A_REAL_GEMINI_KEY',
};
const hosts = [
  'https://translate.googleapis.com/*',
  'https://api.openai.com/*',
  'https://translation.googleapis.com/*',
  'https://api.deepseek.com/*',
  'https://generativelanguage.googleapis.com/*',
];
const temp = await mkdtemp(join(tmpdir(), 'subtitle-providers-'));
const server = await startFixture(0);
let context;
let release;
let cloudMode = 'success';
const counts = { cloud: 0, deepseek: 0, gemini: 0, google: 0 };
const errors = [];
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, hosts);
  // Required grants only in this throwaway copy; real permission prompts remain owner checks.
  manifest.host_permissions = ['http://127.0.0.1/*', ...hosts];
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
  await context.setOffline(true);
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(error.message)),
  );
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'http://127.0.0.1:4173') {
      url.port = String(server.address().port);
      return route.fulfill({ response: await route.fetch({ url: url.href }) });
    }
    const headers = route.request().headers();
    assert.equal(headers.cookie, undefined);
    if (url.hostname === 'translate.googleapis.com') {
      counts.google++;
      assert.equal(headers.authorization, undefined);
      assert.equal(headers['x-goog-api-key'], undefined);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([
          [['Google deneme', url.searchParams.get('q')]],
          null,
          'en',
        ]),
      });
    }
    const body = route.request().postDataJSON();
    assert.ok(!JSON.stringify(body).includes('SENTINEL'));
    assert.ok(!url.href.includes('SENTINEL'));
    assert.equal(url.search, '');
    if (url.hostname === 'translation.googleapis.com') {
      counts.cloud++;
      assert.equal(url.pathname, '/language/translate/v2');
      assert.equal(headers['x-goog-api-key'], keys.cloud);
      assert.equal(headers.authorization, undefined);
      assert.equal(body.format, 'text');
      assert.equal(body.target, 'tr');
      assert.ok(body.q.length <= 4);
      if (cloudMode === 'hold')
        await new Promise((resolve) => {
          release = resolve;
        });
      if (cloudMode === 'quota' || cloudMode === 'auth')
        return route.fulfill({
          status: cloudMode === 'quota' ? 429 : 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              details: [
                {
                  reason:
                    cloudMode === 'quota'
                      ? 'RESOURCE_EXHAUSTED'
                      : 'API_KEY_INVALID',
                },
              ],
              message: keys.cloud,
            },
          }),
        });
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            translations: body.q.map(() => ({
              translatedText: 'Cloud çığ 😊 <b>dünya</b>',
            })),
          },
        }),
      });
    }
    const provider =
      url.hostname === 'api.deepseek.com'
        ? 'deepseek'
        : url.hostname === 'generativelanguage.googleapis.com'
          ? 'gemini'
          : null;
    assert.ok(provider, 'Unexpected remote destination');
    counts[provider]++;
    assert.equal(headers.authorization, `Bearer ${keys[provider]}`);
    assert.equal(headers['x-goog-api-key'], undefined);
    assert.equal(body.max_tokens, 2048);
    assert.equal(body.store, undefined);
    assert.equal(
      body.model,
      provider === 'deepseek' ? 'deepseek-flash' : 'gemini-3.8-flash',
    );
    if (provider === 'deepseek') {
      assert.equal(body.response_format.type, 'json_object');
      assert.equal(body.thinking.type, 'disabled');
    } else {
      assert.equal(body.response_format.type, 'json_schema');
      assert.equal(body.reasoning_effort, 'low');
    }
    const items = JSON.parse(body.messages[1].content).items.map((item) => ({
      id: item.id,
      revision: item.revision,
      text: `${provider} çığ 😊`,
    }));
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: JSON.stringify({ items }) },
          },
        ],
      }),
    });
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
  const cloud = options.locator('[aria-labelledby="cloud-title"]');
  const ai = options.locator('[aria-labelledby="ai-title"]');
  const engine = options.locator('[aria-labelledby="engine-title"]');
  const feedback = async (panel, text) => {
    try {
      await panel.getByRole('status').filter({ hasText: text }).waitFor();
    } catch {
      throw new Error(
        `Expected ${text}; received ${await panel.getByRole('status').textContent()}`,
      );
    }
  };
  async function select(value) {
    await engine.getByLabel('Engine', { exact: true }).selectOption(value);
    await engine.getByRole('button', { name: 'Apply engine' }).click();
    await feedback(engine, 'Engine selected');
  }
  const activate = async () => {
    await page.bringToFront();
    const result = await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        version: 1,
        requestId: 'providers-browser',
        type: 'playback.enable',
      }),
    );
    assert.equal(result.ok, true);
  };
  const seek = async (time) => {
    await page.evaluate((time) => {
      const video = document.querySelector('video');
      video.pause();
      video.currentTime = time;
    }, time);
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  };
  const caption = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.caption').textContent === text,
      text,
    );
  const overlayStatus = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.provider-status')
          .textContent.includes(text),
      text,
    );
  assert.equal(
    await engine.getByLabel('Engine', { exact: true }).inputValue(),
    'none',
  );
  await cloud
    .getByLabel('Google Cloud API key', { exact: true })
    .fill(keys.cloud);
  await cloud.getByRole('button', { name: 'Save Cloud key' }).click();
  await feedback(cloud, 'saved without contacting');
  assert.deepEqual(counts, { cloud: 0, deepseek: 0, gemini: 0, google: 0 });
  await select('google-cloud');
  await cloud
    .getByRole('button', { name: 'Run small Cloud paid test' })
    .click();
  await feedback(cloud, 'Small Cloud test passed');
  assert.equal(counts.cloud, 1);
  await page.waitForTimeout(1100);
  await seek(1);
  await activate();
  await caption('Hello from the timing lab.\nCloud çığ 😊 <b>dünya</b>');
  assert.equal(
    await page
      .locator('subtitle-translator-overlay')
      .evaluate((host) => host.shadowRoot.querySelector('.caption b')),
    null,
  );
  await page.waitForTimeout(1100);
  cloudMode = 'hold';
  await seek(3);
  const deadline = Date.now() + 5000;
  while (!release) {
    if (Date.now() > deadline) throw new Error('No delayed Cloud request');
    await page.waitForTimeout(20);
  }
  await select('none');
  release();
  release = undefined;
  await overlayStatus('Translation stopped');
  assert.equal(
    await page
      .locator('subtitle-translator-overlay')
      .evaluate((host) => host.shadowRoot.querySelector('.label').textContent),
    'Original captions',
  );
  await caption('Hello from the timing lab.');
  assert.equal(counts.deepseek + counts.gemini + counts.google, 0);
  for (const [name, value] of [
    ['DeepSeek', 'deepseek'],
    ['Gemini', 'gemini'],
  ]) {
    await ai
      .getByLabel('AI provider', { exact: true })
      .selectOption({ label: name });
    assert.equal(
      await ai.getByLabel('API key', { exact: true }).inputValue(),
      '',
    );
    await ai.getByRole('button', { name: 'Save AI profile and key' }).click();
    await feedback(ai, 'Saved without contacting');
    await ai.getByText(/Saved key: none/).waitFor();
    await ai.getByLabel('API key', { exact: true }).fill(keys[value]);
    await ai.getByRole('button', { name: 'Save AI profile and key' }).click();
    await feedback(ai, 'Saved without contacting');
    await select('ai');
    await page.waitForTimeout(1100);
    await ai.getByRole('button', { name: 'Run small paid test' }).click();
    await feedback(ai, 'Small test passed');
    await page.waitForTimeout(1100);
    await seek(1);
    await activate();
    await caption(`Hello from the timing lab.\n${value} çığ 😊`);
    assert.equal(counts[value], 2);
  }
  await mkdir('test-results', { recursive: true });
  await options.setViewportSize({ width: 1440, height: 1000 });
  await options.screenshot({
    path: 'test-results/options-providers-desktop.png',
    fullPage: true,
  });
  await options.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await options.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await options.screenshot({
    path: 'test-results/options-providers-mobile.png',
    fullPage: true,
  });
  cloudMode = 'quota';
  await select('google-cloud');
  await cloud
    .getByRole('button', { name: 'Run small Cloud paid test' })
    .click();
  await feedback(cloud, 'quota or balance');
  const stopped = counts.cloud;
  await page.waitForTimeout(1100);
  await cloud
    .getByRole('button', { name: 'Run small Cloud paid test' })
    .click();
  await feedback(cloud, 'quota or balance');
  assert.equal(counts.cloud, stopped);
  assert.equal(counts.google, 0);
  await activate();
  await overlayStatus('quota or balance');
  await caption('Hello from the timing lab.');
  await select('google');
  await activate();
  await caption('Hello from the timing lab.\nGoogle deneme');
  assert.equal(counts.google, 1);
  cloudMode = 'auth';
  await cloud
    .getByLabel('Google Cloud API key', { exact: true })
    .fill(keys.cloud);
  await cloud.getByRole('button', { name: 'Save Cloud key' }).click();
  await feedback(cloud, 'saved without contacting');
  await cloud
    .getByRole('button', { name: 'Run small Cloud paid test' })
    .click();
  await feedback(cloud, 'Provider rejected');
  assert.ok(!(await cloud.innerText()).includes(keys.cloud));
  await cloud.getByRole('button', { name: 'Delete Cloud key' }).click();
  await feedback(cloud, 'Cloud key deleted');
  await select('google-cloud');
  await activate();
  await overlayStatus('key is missing');
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      browser: context.browser().version(),
      mode: 'offline-sentinel-only',
      counts,
      result: 'passed',
    }),
  );
} finally {
  release?.();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
