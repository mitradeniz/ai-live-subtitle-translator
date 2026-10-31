import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const temp = await mkdtemp(join(tmpdir(), 'lesson-controls-'));
let context;
let providerRequests = 0;
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      host_permissions: [
        'https://lesson.example.test/*',
        'https://translate.googleapis.com/*',
      ],
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
  context.setDefaultTimeout(15000);
  await context.setOffline(true);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === 'https://lesson.example.test') {
      if (url.pathname === '/pattern.webm')
        return route.fulfill({
          contentType: 'video/webm',
          body: await readFile('tests/fixtures/native/pattern.webm'),
        });
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><title>Synthetic lesson</title><style>body{margin:20px;font:16px system-ui}video{width:800px;height:450px}.video-js{position:relative;width:800px;height:450px}.video-js:fullscreen video{width:100%;height:100%}.vjs-control-bar{position:absolute;bottom:0;left:0;right:0;height:40px;display:flex;align-items:center;gap:8px;background:#172c49;color:white}.vjs-control-bar button{height:32px}.spacer{flex:1}#transcript{height:200px;overflow:auto}</style><div class="video-js"><video muted loop src="/pattern.webm"></video><div class="vjs-control-bar"><button>Play</button><span class="spacer"></span><button class="vjs-subs-caps-button">CC</button><button>Settings</button><button>Fullscreen</button></div></div><p id="tick">Lesson controls</p><div id="transcript"></div>',
      });
    }
    if (url.origin === 'https://translate.googleapis.com') {
      providerRequests++;
      const text = url.searchParams.get('q');
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify([[[`TR ${text}`, text]], null, 'en']),
      });
    }
    return route.abort();
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  // Simulate a page-status port that never responds. Trusted settings must paint
  // independently, polls must not overlap, and a read timeout must be visible.
  await popup.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    window.statusReads = 0;
    chrome.runtime.sendMessage = (message, ...rest) => {
      if (message.type === 'playback.status') {
        window.statusReads++;
        return new Promise(() => {});
      }
      return send(message, ...rest);
    };
  });
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup
    .getByRole('button', { name: 'Google · Select provider', exact: true })
    .waitFor({ timeout: 2000 });
  await popup
    .getByText('Page status unavailable', { exact: true })
    .waitFor({ timeout: 6500 });
  assert.ok(
    (await popup.evaluate(() => window.statusReads)) <= 2,
    'No overlapping status polls',
  );
  const page = await context.newPage();
  await page.goto('https://lesson.example.test/course');
  await page.evaluate(() => {
    window.ticks = 0;
    window.modeChanges = 0;
    const video = document.querySelector('video');
    const track = video.addTextTrack('subtitles', 'Synthetic', 'en');
    track.addCue(new VTTCue(0, 30, 'A complete synthetic lesson sentence.'));
    track.mode = 'showing';
    window.track = track;
    // Reproduce a player trying to own caption visibility, without an unbounded
    // test-page loop. The old event-driven scanner immediately fights each change.
    video.textTracks.addEventListener('change', () => {
      window.modeChanges++;
      if (track.mode === 'hidden' && window.modeChanges < 500)
        track.mode = 'showing';
    });
    const transcript = document.querySelector('#transcript');
    for (let i = 0; i < 8000; i++) {
      const p = document.createElement('p');
      p.textContent = `Synthetic paragraph ${i}.`;
      transcript.append(p);
    }
    window.pulse = setInterval(() => {
      window.ticks++;
      document.querySelector('#tick').textContent =
        `Lesson clock ${window.ticks}`;
    }, 20);
  });
  const send = (type, extra = {}) =>
    popup.evaluate((body) => chrome.runtime.sendMessage(body), {
      version: 1,
      requestId: 'lesson-check',
      type,
      ...extra,
    });
  await page.bringToFront();
  await popup.evaluate(async () => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [0] },
      world: 'ISOLATED',
      func: () => {
        const watching = new Set();
        const observe = MutationObserver.prototype.observe;
        const disconnect = MutationObserver.prototype.disconnect;
        const report = () => {
          document.documentElement.dataset.bodyObservers = String(
            watching.size,
          );
        };
        MutationObserver.prototype.observe = function (...args) {
          const result = observe.apply(this, args);
          if (args[0] === document.body) {
            watching.add(this);
            report();
          }
          return result;
        };
        MutationObserver.prototype.disconnect = function () {
          watching.delete(this);
          report();
          return disconnect.call(this);
        };
        report();
      },
    });
  });
  assert.equal((await send('page.enable', { run: false })).data.state, 'ready');
  assert.equal(
    await page.locator('html').getAttribute('data-body-observers'),
    '0',
    'Idle logo must not observe all page mutations',
  );
  const tools = page.locator('translator-page-tools');
  const shortcut = page
    .locator('translator-player-shortcut')
    .getByRole('button', {
      name: 'Video translation settings',
      exact: true,
    });
  await shortcut.waitFor();
  assert.equal(
    await page
      .locator(
        '.vjs-control-bar > translator-player-shortcut + .vjs-subs-caps-button',
      )
      .count(),
    1,
    'The shortcut occupies its own slot immediately before CC',
  );
  await page.evaluate(() => {
    document.querySelector('.vjs-control-bar').style.opacity = '0';
  });
  assert.equal(
    await shortcut.evaluate((button) =>
      button.checkVisibility({ checkOpacity: true }),
    ),
    false,
    'The shortcut follows native control hiding',
  );
  await page.evaluate(() => {
    document.querySelector('.vjs-control-bar').style.opacity = '';
  });
  const videoRect = await page.locator('video').boundingBox();
  const buttonRect = await shortcut.boundingBox();
  assert.ok(
    buttonRect.x >= videoRect.x &&
      buttonRect.x + buttonRect.width <= videoRect.x + videoRect.width,
  );
  assert.ok(
    buttonRect.y >= videoRect.y &&
      buttonRect.y + buttonRect.height <= videoRect.y + videoRect.height,
  );
  await shortcut.evaluate((button) => button.click());
  assert.equal(
    await tools.locator('.panel').isVisible(),
    false,
    'Page-script click cannot open controls',
  );
  const mini = page.locator('translator-player-shortcut').getByRole('dialog');
  const toggle = mini.getByRole('switch', { name: 'Subtitle translation' });
  await shortcut.click();
  await mini.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')?.disabled === false,
  );
  assert.equal(
    await tools.locator('.panel').isVisible(),
    false,
    'The player shortcut opens its own compact menu',
  );
  assert.equal(providerRequests, 0, 'Opening settings does not translate');
  assert.equal(await toggle.getAttribute('aria-checked'), 'false');
  await toggle.evaluate((button) => button.click());
  assert.equal(
    providerRequests,
    0,
    'Synthetic switch clicks cannot start translation',
  );
  const downloads = [];
  page.on('download', (download) => downloads.push(download));
  await mini
    .getByRole('button', { name: /^Download subtitles/ })
    .evaluate((button) => button.click());
  assert.equal(
    downloads.length,
    0,
    'Synthetic download clicks do not save a file',
  );
  const downloadEvent = page.waitForEvent('download');
  await mini.getByRole('button', { name: /^Download subtitles/ }).click();
  const download = await downloadEvent;
  assert.equal(download.suggestedFilename(), 'subtitles-original.vtt');
  const saved = await readFile(await download.path(), 'utf8');
  assert.match(saved, /^WEBVTT\n\n1\n00:00:00.000 --> 00:00:30.000/);
  assert.match(saved, /A complete synthetic lesson sentence/);
  assert.equal(providerRequests, 0, 'Source export makes no provider request');
  await page.screenshot({ path: '.output/lesson-player.png' });
  await page.keyboard.press('Escape');
  await mini.waitFor({ state: 'hidden' });
  await shortcut.focus();
  await page.keyboard.press('Enter');
  await mini.waitFor();
  const settingsTab = context.waitForEvent('page');
  await mini.getByRole('button', { name: 'Settings', exact: true }).click();
  const openedSettings = await settingsTab;
  await openedSettings.waitForURL(`chrome-extension://${id}/options.html`);
  await openedSettings.close();
  await page.bringToFront();
  await shortcut.click();
  await mini.waitFor();
  const menuRect = await mini.boundingBox();
  assert.ok(
    menuRect.y + menuRect.height <= buttonRect.y,
    'Compact menu opens directly above the player button',
  );
  await page.evaluate(async () => {
    const player = document.querySelector('.video-js');
    await player.requestFullscreen();
  });
  await shortcut.waitFor();
  assert.equal(
    await tools.evaluate(
      (host) => host.parentElement === document.fullscreenElement,
    ),
    true,
  );
  if (!(await mini.isVisible())) await shortcut.click();
  await mini.waitFor();
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.exitFullscreen());

  const settings = (await send('popup.read')).data.settings;
  const { schemaVersion, ...preferences } = settings;
  void schemaVersion;
  await send('controls.update', {
    preferences: { ...preferences, displayMode: 'original' },
  });
  await page.bringToFront();
  assert.equal(
    (await send('playback.enable', { youtubeSourceConfirmed: false })).data
      .state,
    'enabled',
  );
  await page.waitForTimeout(2000);
  const heartbeat = await page.evaluate(() => ({
    ticks: window.ticks,
    changes: window.modeChanges,
  }));
  assert.ok(heartbeat.ticks >= 50, JSON.stringify(heartbeat));
  assert.ok(heartbeat.changes < 80, JSON.stringify(heartbeat));
  assert.equal((await send('playback.disable')).data.state, 'disabled');
  assert.equal(await page.evaluate(() => window.track.mode), 'showing');
  // Busy, large DOM with ongoing changes must still yield to input/timers while
  // visible text is discovered and translated.
  assert.equal(
    (await send('controls.select', { provider: 'google' })).ok,
    true,
  );
  await page.bringToFront();
  await send('controls.update', {
    preferences: { ...preferences, displayMode: 'bilingual' },
  });
  await page.bringToFront();
  assert.equal((await send('page.enable', { run: false })).ok, true);
  await shortcut.click();
  await mini.waitFor();
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')?.disabled === false,
  );
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')
        ?.getAttribute('aria-checked') === 'true',
  );
  await send('playback.disable');
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')
        ?.getAttribute('aria-checked') === 'false',
  );
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')
        ?.getAttribute('aria-checked') === 'true',
  );
  await toggle.click();
  await page.waitForFunction(
    () =>
      document
        .querySelector('translator-player-shortcut')
        ?.shadowRoot.querySelector('[role="switch"]')
        ?.getAttribute('aria-checked') === 'false',
  );
  assert.equal(
    await page.locator('subtitle-translator-overlay').count(),
    0,
    'Turning the switch off removes captions',
  );
  assert.equal(await page.evaluate(() => window.track.mode), 'showing');
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => window.ticks);
  assert.equal((await send('page.enable', { run: true })).ok, true);
  await page.waitForFunction(() =>
    document.querySelector('[data-page-translation]'),
  );
  assert.equal(
    await page.locator('html').getAttribute('data-body-observers'),
    '1',
  );
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.ticks);
  assert.ok(
    after - before >= 20,
    `Page heartbeat only advanced ${after - before}`,
  );
  await page.evaluate(() => {
    const prior = document.querySelector('video');
    const replacement = prior.cloneNode(true);
    replacement.style.width = '600px';
    document.querySelector('.video-js').style.width = '600px';
    prior.replaceWith(replacement);
  });
  await page.waitForTimeout(1100);
  const replacementRect = await page.locator('video').boundingBox();
  const replacementButton = await shortcut.boundingBox();
  assert.ok(
    replacementButton.x + replacementButton.width <=
      replacementRect.x + replacementRect.width,
  );
  await page.evaluate(() => {
    const spacer = document.createElement('div');
    spacer.style.height = '1600px';
    document.body.append(spacer);
    window.scrollTo(0, 900);
  });
  await shortcut.waitFor({ state: 'hidden' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shortcut.waitFor();
  await page.evaluate(() => {
    const old = document.querySelector('.vjs-control-bar');
    const replacement = old.cloneNode(true);
    replacement.querySelector('translator-player-shortcut')?.remove();
    old.replaceWith(replacement);
  });
  // A replaced toolbar receives the same trusted button, without duplicate controls.
  await shortcut.waitFor();
  await page.evaluate(() => {
    document.querySelector('.vjs-control-bar').remove();
  });
  await shortcut.waitFor({ state: 'detached' });
  assert.equal(
    await tools.locator('.trigger').isVisible(),
    true,
    'Unknown/native-only controls keep the edge menu',
  );
  await page.bringToFront();
  await send('page.disable');
  assert.equal(await shortcut.count(), 0);
  assert.equal(
    await page.locator('html').getAttribute('data-body-observers'),
    '0',
    'Disabling must disconnect page observation',
  );
  assert.equal(await page.locator('[data-page-translation]').count(), 0);
  console.log(
    JSON.stringify({
      result: 'passed',
      browser: context.browser().version(),
      heartbeat,
      scanningTicks: after - before,
      providerRequests,
      checks:
        'hung page status independent popup, finite nonoverlapping reads, player button trusted click/placement, no automatic request, track event feedback bounded, large live DOM responsiveness, restore and cleanup',
    }),
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
