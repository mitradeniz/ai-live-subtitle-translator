import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';
const temp = await mkdtemp(join(tmpdir(), 'subtitle-work-'));
const server = await startFixture(0);
let context;
let release;
let mode = 'success';
const calls = [];
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  manifest.host_permissions = [
    'http://127.0.0.1/*',
    'https://translation.googleapis.com/*',
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
  context.setDefaultTimeout(15_000);
  await context.setOffline(true);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'http://127.0.0.1:4173') {
      url.port = String(server.address().port);
      return route.fulfill({ response: await route.fetch({ url: url.href }) });
    }
    if (url.origin !== 'https://translation.googleapis.com')
      return route.abort();
    const body = route.request().postDataJSON();
    assert.equal(
      route.request().headers()['x-goog-api-key'],
      'SENTINEL_WORK_NOT_A_KEY',
    );
    assert.ok(body.q.length <= 4 && body.q.join('').length <= 2000);
    calls.push({ at: performance.now(), size: body.q.length, text: body.q[0] });
    if (mode === 'offline') return route.abort();
    if (mode === 'throttle') {
      mode = 'success';
      return route.fulfill({
        status: 429,
        headers: { 'retry-after': '1', 'content-type': 'application/json' },
        body: '{"error":{"code":429}}',
      });
    }
    if (mode === 'hold')
      await new Promise((resolve) => {
        release = resolve;
      });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await route
      .fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            translations: body.q.map((text) => ({
              translatedText: `TR ${text}`,
            })),
          },
        }),
      })
      .catch(() => {});
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
  const send = (type, extra = {}) =>
    options.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'work-test',
      type,
      ...extra,
    });
  const activate = async () => {
    await page.bringToFront();
    const response = await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        version: 1,
        requestId: 'activate',
        type: 'playback.enable',
      }),
    );
    assert.equal(response.data.state, 'enabled');
  };
  const seek = async (time) => {
    await page.evaluate((time) => {
      const v = document.querySelector('video');
      v.pause();
      v.currentTime = time;
    }, time);
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  };
  const caption = async (text) => {
    try {
      await page.waitForFunction(
        (text) =>
          document
            .querySelector('subtitle-translator-overlay')
            ?.shadowRoot.querySelector('.caption')
            .textContent.includes(text),
        text,
      );
    } catch (error) {
      const state = await page.evaluate(() => {
        const video = document.querySelector('video');
        const root = document.querySelector(
          'subtitle-translator-overlay',
        )?.shadowRoot;
        return {
          time: video.currentTime,
          seeking: video.seeking,
          caption: root?.querySelector('.caption').textContent,
          status: root?.querySelector('.provider-status').textContent,
        };
      });
      throw new Error(
        `Synthetic caption wait failed: ${JSON.stringify({ state, calls })}`,
        { cause: error },
      );
    }
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
  const tag = (text) =>
    page.evaluate((text) => {
      const track = document.querySelector('video').textTracks[0];
      track.cues[0].text = `${text}.`;
    }, text);
  const stopWorker = async () => {
    // Browser-level stop, detached immediately; do not attach a worker inspector.
    const cdp = await context.newCDPSession(options);
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    await cdp.detach();
  };
  assert.equal(
    (
      await send('credentials.set', {
        credentialId: 'google-cloud',
        credential: {
          schemaVersion: 1,
          origin: 'https://translation.googleapis.com',
          key: 'SENTINEL_WORK_NOT_A_KEY',
        },
      })
    ).ok,
    true,
  );
  await send('cloud.enable');
  await seek(1);
  const coldStart = performance.now();
  await activate();
  await caption('TR Hello from the timing lab.');
  const coldMs = Math.round(performance.now() - coldStart);
  assert.equal(calls.length, 1);
  const warmStart = performance.now();
  await seek(2);
  await caption('TR Hello from the timing lab.');
  const warmMs = Math.round(performance.now() - warmStart);
  assert.equal(calls.length, 1);
  // Repeated seeks within a completed cue must not flood the background queue.
  for (let i = 0; i < 8; i++) {
    for (const time of [3, 1, 2, 1]) await seek(time);
    await caption('TR Hello from the timing lab.');
  }
  assert.equal(calls.length, 1);
  await stopWorker();
  await seek(2);
  await caption('TR Hello from the timing lab.');
  assert.equal(calls.length, 1);
  // 2x playback exercises future cues. Pause before fault injection.
  await page.evaluate(async () => {
    const v = document.querySelector('video');
    v.playbackRate = 2;
    await v.play();
  });
  await page.waitForTimeout(2500);
  await seek(1);
  const afterPrefetch = calls.length;
  assert.ok(
    afterPrefetch <= 4,
    `Unexpected prefetch requests: ${afterPrefetch}`,
  );
  await page.waitForTimeout(1200);
  mode = 'offline';
  await tag('Offline cue');
  await status('could not be reached');
  const afterOffline = calls.length;
  await page.waitForTimeout(1700);
  assert.equal(calls.length, afterOffline);
  mode = 'success';
  await tag('Reconnected cue');
  await caption('TR Reconnected cue');
  await page.waitForTimeout(1200);
  mode = 'throttle';
  await tag('Throttle cue');
  await caption('TR Throttle cue');
  const last = calls.slice(-2);
  assert.ok(last[1].at - last[0].at >= 1000);
  await page.waitForTimeout(1200);
  mode = 'hold';
  await tag('Interrupted paid cue');
  const deadline = Date.now() + 10_000;
  while (!release) {
    if (Date.now() > deadline) throw new Error('No checkpointed request');
    await page.waitForTimeout(25);
  }
  const beforeStop = calls.length;
  const journal = await options.evaluate(
    async () =>
      (await chrome.storage.session.get('translation-jobs.v1'))[
        'translation-jobs.v1'
      ],
  );
  assert.ok(journal.some((record) => record.paid && record.tabId >= 0));
  await stopWorker();
  release();
  release = undefined;
  await status('may have been accepted');
  assert.equal(calls.length, beforeStop);
  mode = 'success';
  await page.waitForTimeout(1200);
  await tag('After worker restart');
  await caption('TR After worker restart');
  await send('cache.configure', { persistent: true });
  await activate();
  await caption('TR After worker restart');
  await send('cache.clear');
  assert.equal(
    await options.evaluate(
      async () =>
        (await chrome.storage.local.get('translation-cache.v1'))[
          'translation-cache.v1'
        ],
    ),
    undefined,
  );
  await page.close();
  await page.waitForTimeout(0).catch(() => {});
  const remaining = await options.evaluate(
    async () =>
      (await chrome.storage.session.get('playback-sessions.v1'))[
        'playback-sessions.v1'
      ],
  );
  assert.equal(remaining.length, 0);
  console.log(
    JSON.stringify({
      result: 'passed',
      browser: context.browser().version(),
      mode: 'offline-sentinel-only',
      coldCaptionMs: coldMs,
      cachedSeekMs: warmMs,
      requestsBeforeFaults: afterPrefetch,
      totalRequests: calls.length,
      maxBatchCues: Math.max(...calls.map((c) => c.size)),
      retryAfterGapMs: Math.round(last[1].at - last[0].at),
    }),
  );
} finally {
  release?.();
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
