import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { openToolbarPopup } from './browser-toolbar.mjs';
const temp = await mkdtemp(join(tmpdir(), 'subtitle-youtube-'));
let context;
let timedBody = { events: [] };
let timedRedirect = false;
let holdTimed = false;
let heldTimed;
const timedRequests = [];
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3-mock'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      host_permissions: ['https://www.youtube.com/*'],
    }),
  );
  context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  context.setDefaultTimeout(8000);
  const errors = [];
  context.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', async (d) => {
      errors.push('Unexpected dialog');
      await d.dismiss();
    });
  });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin !== 'https://www.youtube.com') return route.abort();
    if (url.pathname === '/api/timedtext') {
      timedRequests.push({ url, headers: route.request().headers() });
      if (holdTimed)
        await new Promise((resolve) => {
          heldTimed = resolve;
        });
      if (timedRedirect)
        return route.fulfill({
          status: 302,
          headers: { location: 'https://blocked.example.test/captions' },
        });
      return route.fulfill({ json: timedBody });
    }
    const files = {
      '/watch': ['tests/fixtures/youtube/index.html', 'text/html'],
      '/fixture.js': ['tests/fixtures/youtube/fixture.js', 'text/javascript'],
      '/pattern.webm': ['tests/fixtures/native/pattern.webm', 'video/webm'],
    };
    const item = files[url.pathname];
    if (!item) return route.abort();
    const body = await readFile(item[0]);
    const range = route.request().headers()['range'];
    if (range && item[1] === 'video/webm') {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      assert.ok(match);
      const start = Number(match[1]);
      const end = match[2]
        ? Math.min(Number(match[2]), body.length - 1)
        : body.length - 1;
      await route.fulfill({
        status: 206,
        body: body.subarray(start, end + 1),
        contentType: item[1],
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
        },
      });
    } else
      await route.fulfill({
        body,
        contentType: item[1],
        headers: { 'Accept-Ranges': 'bytes' },
      });
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  await page.goto('https://www.youtube.com/watch?v=synthetic');
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  const send = async (type, extra = {}) => {
    await page.bringToFront();
    return popup.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'youtube-test',
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
  const label = (text) =>
    page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.label')
          .textContent.includes(text),
      text,
    );
  assert.deepEqual(await send('playback.enable'), {
    ok: true,
    data: { kind: 'playback', state: 'source-required' },
  });
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  const toolbar = await openToolbarPopup(context, worker);
  const sourceStatus = await toolbar.evaluate(async () => {
    document.querySelector('.popup-controls button').click();
    const deadline = Date.now() + 5000;
    while (
      !document
        .querySelector('[role="status"]')
        .textContent.includes('Select a source caption track in YouTube')
    ) {
      const error = document.querySelector('[role="alert"]');
      if (error) throw new Error(error.textContent);
      if (Date.now() > deadline) throw new Error('No confirmation guidance');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return document.querySelector('[role="status"]').textContent;
  });
  assert.match(sourceStatus, /Select a source caption track in YouTube/);
  await toolbar.evaluate(async () => {
    const button = document.querySelector('.popup-controls button');
    const deadline = Date.now() + 5000;
    while (button.disabled) {
      if (Date.now() > deadline) throw new Error('Enable action stayed busy');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    document.querySelector('input[type="checkbox"]').click();
    // A synthetic click does not wait for React to commit the new handler.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    button.click();
    while (button.getAttribute('aria-pressed') !== 'true') {
      if (Date.now() > deadline) {
        throw new Error(document.querySelector('[role="status"]').textContent);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  await caption('Synthetic manual caption.\n[MOCK] Synthetic manual caption.');
  await toolbar.close();
  await send('playback.disable');
  await popup.getByRole('checkbox').check();
  await page.bringToFront();
  // Execute the actual click handler without moving the active tab away from the video.
  await popup
    .getByRole('button', { name: 'Enable mock captions' })
    .evaluate((button) => button.click());
  await caption('Synthetic manual caption.\n[MOCK] Synthetic manual caption.');
  await label('Visible captions · no cue timestamps · en · manual');
  await page.evaluate(() => window.fixture.text('Synthetic manual caption.'));
  await caption('Synthetic manual caption.\n[MOCK] Synthetic manual caption.');
  await page.evaluate(() =>
    window.fixture.text('<img src=x onerror=alert(1)> literal.'),
  );
  await caption(
    '<img src=x onerror=alert(1)> literal.\n[MOCK] <img src=x onerror=alert(1)> literal.',
  );
  assert.equal(
    await page.locator('subtitle-translator-overlay img').count(),
    0,
  );
  await page.evaluate(() =>
    window.fixture.source({ languageCode: 'en', kind: 'asr', vss_id: 'a.en' }),
  );
  await label('auto-generated');
  await caption('');
  await page.evaluate(() => window.fixture.text('Rolling'));
  await page.evaluate(() => window.fixture.text('Rolling words'));
  await caption('Rolling words');
  await page.evaluate(() => window.fixture.text('Rolling words finish.'));
  await caption('Rolling words finish.\n[MOCK] Rolling words finish.');
  await page.evaluate(() =>
    window.fixture.source({ languageCode: 'tr', kind: '', vss_id: '.tr' }),
  );
  await label('tr · manual');
  await caption('');
  await page.evaluate(() => window.fixture.text('Yeni kaynak.'));
  await caption('Yeni kaynak.\n[MOCK] Yeni kaynak.');
  await page.evaluate(() =>
    window.fixture.source({
      languageCode: 'tr',
      kind: '',
      vss_id: '.tr',
      translationLanguage: { languageCode: 'en' },
    }),
  );
  await label('Auto-translate');
  await caption('');
  await page.evaluate(() =>
    window.fixture.source({
      languageCode: 'en',
      kind: '',
      vss_id: '.en',
      unexpected: 'unrecognized player contract',
    }),
  );
  await label('source unavailable');
  await caption('');
  await page.evaluate(() =>
    window.fixture.source({ languageCode: 'en', kind: '', vss_id: '.en' }),
  );
  await label('en · manual');
  await page.evaluate(() => window.fixture.text('Before seek.'));
  await caption('Before seek.\n[MOCK] Before seek.');
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 12;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await caption('');
  await page.evaluate(() => window.fixture.text('After seek.'));
  await caption('After seek.\n[MOCK] After seek.');
  await page.evaluate(() => window.fixture.cc(false));
  await label('Turn on YouTube CC');
  await caption('');
  await page.evaluate(() => {
    window.fixture.cc(true);
    window.fixture.text('');
  });
  await caption('');
  await page.evaluate(() => window.fixture.text('Recovered.'));
  await caption('Recovered.\n[MOCK] Recovered.');
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('subtitle-translator:youtube-source-response', {
        detail: 'x'.repeat(3000),
      }),
    ),
  );
  await caption('Recovered.\n[MOCK] Recovered.');
  await page.evaluate(() => window.fixture.next());
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('.ytp-caption-segment').textContent(),
    'Recovered.',
  );
  assert.deepEqual(
    await send('playback.enable', { youtubeSourceConfirmed: true }),
    { ok: true, data: { kind: 'playback', state: 'enabled' } },
  );
  await caption('Recovered.\n[MOCK] Recovered.');
  await page.evaluate(() => window.fixture.replace());
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await page.evaluate(() => window.fixture.text('Late response.'));
  await send('playback.disable');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  assert.equal(
    await page.locator('.ytp-subtitles-button').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => typeof window.__subtitleSourceCleanup),
    'function',
  );
  await page.evaluate(() => {
    const v = document.querySelector('video');
    const track = v.addTextTrack('captions', 'Native', 'en');
    track.addCue(new VTTCue(1, 3, 'Synthetic timed cue.'));
    track.mode = 'showing';
    v.currentTime = 2;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await label('Native timed track');
  assert.equal(
    await page.evaluate(() => document.querySelector('video').currentTime),
    2,
  );
  await caption('Synthetic timed cue.\n[MOCK] Synthetic timed cue.');
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('subtitle-translator:youtube-source-stop'),
    ),
  );
  await label('source unavailable');
  await page.waitForFunction(
    () => document.querySelector('video').textTracks[0].mode === 'showing',
  );
  await caption('');
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await caption('Synthetic timed cue.\n[MOCK] Synthetic timed cue.');
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 4;
  });
  await caption('');
  await send('playback.disable');
  assert.equal(
    await page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'showing',
  );
  // Whole timed captions arrive before playback, even when the DOM only has a word.
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  const timedMetadata = {
    videoDetails: { videoId: 'synthetic-next' },
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            languageCode: 'en',
            vssId: '.en',
            baseUrl:
              'https://www.youtube.com/api/timedtext?v=synthetic-next&lang=en',
          },
        ],
      },
    },
  };
  timedBody = {
    events: [
      {
        tStartMs: 2000,
        dDurationMs: 1000,
        segs: [{ utf8: 'Whole' }],
      },
      { tStartMs: 3000, dDurationMs: 2000, segs: [{ utf8: 'sentence.' }] },
      {
        tStartMs: 6000,
        dDurationMs: 2000,
        segs: [{ utf8: 'Next complete cue.' }],
      },
    ],
  };
  await page.evaluate((metadata) => {
    window.fixture.timed(metadata);
    window.fixture.text('Whole');
    document.querySelector('video').pause();
  }, timedMetadata);
  await context.addCookies([
    {
      name: 'synthetic-cookie',
      value: 'not-a-secret',
      domain: 'www.youtube.com',
      path: '/',
      secure: true,
    },
  ]);
  await page.bringToFront();
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['/youtube-source.js'],
      world: 'MAIN',
    });
  });
  const originalBody = await page.evaluate(() => window.fixture.loadCaptions());
  assert.deepEqual(
    JSON.parse(originalBody),
    timedBody,
    'The player must receive its original response unchanged',
  );
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await label('YouTube timed track · advance translation');
  await caption('');
  await page.waitForTimeout(300); // Deterministic mock completes while media is paused.
  assert.equal(timedRequests.length, 1);
  assert.equal(timedRequests[0].url.searchParams.get('fmt'), 'json3');
  assert.match(timedRequests[0].headers.cookie, /synthetic-cookie/);
  assert.equal(
    timedRequests[0].url.searchParams.get('player'),
    '1',
    'Only the unmodified player request is used',
  );
  await page.evaluate(() => {
    const video = document.querySelector('video');
    video.muted = true;
    video.playbackRate = 2;
    void video.play();
  });
  await caption('Whole sentence.\n[MOCK] Whole sentence.');
  await page.evaluate(() => document.querySelector('video').pause());
  const shownAt = await page.evaluate(
    () => document.querySelector('video').currentTime,
  );
  assert.ok(
    shownAt >= 2 && shownAt < 2.5,
    `Prepared caption arrived at ${shownAt}`,
  );
  await page.evaluate(() => window.fixture.text('Whole sentence.'));
  await caption('Whole sentence.\n[MOCK] Whole sentence.');
  assert.equal(
    timedRequests.length,
    1,
    'DOM revisions do not refetch a timed track',
  );
  assert.deepEqual(
    JSON.parse(await page.evaluate(() => window.fixture.loadCaptions('fetch'))),
    timedBody,
    'Fetch response is not consumed or rewritten',
  );
  await send('playback.disable');
  assert.equal(await page.evaluate(() => window.fixture.restored()), true);
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await label('YouTube timed track · advance translation');
  await caption('Whole sentence.\n[MOCK] Whole sentence.');
  assert.equal(
    timedRequests.length,
    2,
    'Re-enable uses the bounded page-memory track without a reload request',
  );
  await page.evaluate(() => {
    window.fixture.source({ languageCode: 'tr', kind: '', vss_id: '.tr' });
    window.fixture.text('Changed source.');
  });
  await label('Advance translation unavailable');
  await send('playback.disable');
  // Redirected timed text must stop; no credential-bearing or cross-origin followup.
  assert.equal(await page.evaluate(() => window.fixture.restored()), true);
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('subtitle-translator:youtube-source-stop', {
        detail: 'purge',
      }),
    ),
  );
  timedRedirect = true;
  await page.evaluate(() =>
    window.fixture.source({ languageCode: 'en', kind: '', vss_id: '.en' }),
  );
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await label('Advance translation unavailable');
  assert.equal(timedRequests.length, 3);
  await send('playback.disable');
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('subtitle-translator:youtube-source-stop', {
        detail: 'purge',
      }),
    ),
  );
  timedRedirect = false;
  holdTimed = true;
  await send('playback.enable', { youtubeSourceConfirmed: true });
  const deadline = Date.now() + 5000;
  while (!heldTimed) {
    if (Date.now() > deadline) throw new Error('No player request');
    await page.waitForTimeout(20);
  }
  await send('playback.disable');
  heldTimed();
  holdTimed = false;
  await page.waitForTimeout(200);
  assert.equal(
    await page.locator('subtitle-translator-overlay').count(),
    0,
    'Late player responses cannot recreate disabled work',
  );
  assert.equal(await page.evaluate(() => window.fixture.restored()), true);
  assert.equal(
    await page
      .locator('.ytp-caption-window-container')
      .evaluate((el) => el.style.opacity),
    '',
  );
  console.log(
    `Prepared synthetic timed caption first observed at ${shownAt.toFixed(3)}s for its 2.000s start (mock, not live latency).`,
  );
  assert.deepEqual(errors, []);
  console.log(
    `Synthetic YouTube adapter checks passed in Chromium ${context.browser().version()}; live caption delivery remains a separate owner check.`,
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
