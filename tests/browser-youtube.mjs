import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { openToolbarPopup } from './browser-toolbar.mjs';
const temp = await mkdtemp(join(tmpdir(), 'subtitle-youtube-'));
let context;
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
      document.querySelector('[role="status"]').textContent.startsWith('Choose')
    ) {
      const error = document.querySelector('[role="alert"]');
      if (error) throw new Error(error.textContent);
      if (Date.now() > deadline) throw new Error('No confirmation guidance');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return document.querySelector('[role="status"]').textContent;
  });
  assert.match(sourceStatus, /Select a source caption track in YouTube/);
  await toolbar.evaluate(() =>
    document.querySelector('input[type="checkbox"]').click(),
  );
  await toolbar.evaluate(() =>
    document.querySelector('.popup-controls button').click(),
  );
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
    window.fixture.text('<img src=x onerror=alert(1)> literal'),
  );
  await caption(
    '<img src=x onerror=alert(1)> literal\n[MOCK] <img src=x onerror=alert(1)> literal',
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
  await caption('Rolling words\n[MOCK] Rolling words');
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
  await page.evaluate(() => window.fixture.text('Before seek'));
  await caption('Before seek\n[MOCK] Before seek');
  await page.evaluate(() => {
    document.querySelector('video').currentTime = 12;
  });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await caption('');
  await page.evaluate(() => window.fixture.text('After seek'));
  await caption('After seek\n[MOCK] After seek');
  await page.evaluate(() => window.fixture.cc(false));
  await label('Turn on YouTube CC');
  await caption('');
  await page.evaluate(() => {
    window.fixture.cc(true);
    window.fixture.text('');
  });
  await caption('');
  await page.evaluate(() => window.fixture.text('Recovered'));
  await caption('Recovered\n[MOCK] Recovered');
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent('subtitle-translator:youtube-source-response', {
        detail: 'x'.repeat(3000),
      }),
    ),
  );
  await caption('Recovered\n[MOCK] Recovered');
  await page.evaluate(() => window.fixture.next());
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  assert.equal(
    await page.locator('.ytp-caption-segment').textContent(),
    'Recovered',
  );
  assert.deepEqual(
    await send('playback.enable', { youtubeSourceConfirmed: true }),
    { ok: true, data: { kind: 'playback', state: 'enabled' } },
  );
  await caption('Recovered\n[MOCK] Recovered');
  await page.evaluate(() => window.fixture.replace());
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  await send('playback.enable', { youtubeSourceConfirmed: true });
  await page.evaluate(() => window.fixture.text('Late response'));
  await send('playback.disable');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  assert.equal(
    await page.locator('.ytp-subtitles-button').getAttribute('aria-pressed'),
    'true',
  );
  assert.equal(
    await page.evaluate(() => typeof window.__subtitleSourceCleanup),
    'undefined',
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
  assert.deepEqual(errors, []);
  console.log(
    `Synthetic YouTube adapter checks passed in Chromium ${context.browser().version()}; live caption delivery remains a separate owner check.`,
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
