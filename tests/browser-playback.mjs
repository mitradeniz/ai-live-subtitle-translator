import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startFixture } from '../scripts/fixture-server.mjs';

const temp = await mkdtemp(join(tmpdir(), 'subtitle-playback-'));
const server = await startFixture();
let context;
const errors = [];
const screenshots = resolve('test-results');
await mkdir(screenshots, { recursive: true });

async function setup(mock) {
  const original = resolve(
    mock ? '.output/chrome-mv3-mock' : '.output/chrome-mv3',
  );
  const extension = join(
    temp,
    mock ? 'mock-extension' : 'production-extension',
  );
  await cp(original, extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts, undefined);
  // Playwright cannot click the real toolbar to grant activeTab. Only this temporary
  // copy gets a fixture-only host grant. The owner checkpoint covers the toolbar path.
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({ ...manifest, host_permissions: ['http://127.0.0.1/*'] }),
  );
  context = await chromium.launchPersistentContext(
    join(temp, mock ? 'mock-profile' : 'production-profile'),
    {
      channel: 'chromium',
      headless: true,
      chromiumSandbox: true,
      viewport: { width: 1280, height: 1000 },
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
      ],
    },
  );
  context.setDefaultTimeout(10_000);
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('dialog', async (dialog) => {
      errors.push('Unexpected script dialog');
      await dialog.dismiss();
    });
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel('Target language').waitFor();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.waitForFunction(
    () =>
      document.querySelector('video').readyState >= 2 &&
      document.querySelector('video').textTracks[0].cues?.length === 6,
  );
  async function send(type) {
    await page.bringToFront();
    return popup.evaluate(
      (type) =>
        chrome.runtime.sendMessage({
          version: 1,
          requestId: 'playback-test',
          type,
        }),
      type,
    );
  }
  async function enable() {
    assert.deepEqual(await send('playback.enable'), {
      ok: true,
      data: { kind: 'playback', state: 'enabled' },
    });
    await page.locator('subtitle-translator-overlay').waitFor();
  }
  async function seek(time) {
    await page.evaluate((time) => {
      const video = document.querySelector('video');
      video.pause();
      video.currentTime = time;
    }, time);
    await page.waitForFunction(() => !document.querySelector('video').seeking);
  }
  async function expectCaption(text) {
    await page.waitForFunction(
      (text) =>
        document
          .querySelector('subtitle-translator-overlay')
          ?.shadowRoot.querySelector('.caption').textContent === text,
      text,
    );
  }
  return { page, options, popup, send, enable, seek, expectCaption };
}

try {
  // Production never renders mock output or mock controls.
  const production = await setup(false);
  await production.options.screenshot({
    path: join(screenshots, 'settings-dark-desktop.png'),
    fullPage: true,
  });
  await production.options.setViewportSize({ width: 390, height: 844 });
  await production.options.screenshot({
    path: join(screenshots, 'settings-dark-mobile.png'),
    fullPage: true,
  });
  assert.equal(
    await production.options.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await production.popup
      .getByRole('button', { name: 'Enable native captions' })
      .count(),
    1,
  );
  assert.equal(
    (await production.popup.textContent('body')).includes('[MOCK]'),
    false,
  );
  await production.enable();
  await production.seek(1);
  await production.expectCaption('Hello from the timing lab.');
  await production.send('playback.disable');
  await production.page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  assert.equal(
    await production.page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'showing',
  );
  await context.close();
  context = undefined;

  const { page, popup, enable, send, seek, expectCaption } = await setup(true);
  assert.equal(
    await popup.getByRole('button', { name: 'Enable mock captions' }).count(),
    1,
  );
  const first = 'Hello from the timing lab.\n[MOCK] Hello from the timing lab.';
  await enable();
  await seek(1);
  await expectCaption(first);
  await enable();
  await expectCaption(first);
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 1);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'hidden',
  );
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('video').currentTime > 1.5,
  );
  await page.getByRole('button', { name: 'Play / pause', exact: true }).click();
  const pausedAt = await page.evaluate(
    () => document.querySelector('video').currentTime,
  );
  await expectCaption(first);
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => document.querySelector('video').currentTime),
    pausedAt,
  );

  await seek(6.5);
  await expectCaption(
    'Pause here. The caption should stay.\nTwo cues can overlap.\n[MOCK] Pause here. The caption should stay.\n[MOCK] Two cues can overlap.',
  );
  await seek(9.5);
  await expectCaption('');
  await seek(11);
  const literal = 'Literal <img src=x onerror=alert(1)> & <b>text</b>.';
  await expectCaption(`${literal}\n[MOCK] ${literal}`);
  assert.equal(
    await page
      .locator('subtitle-translator-overlay img, subtitle-translator-overlay b')
      .count(),
    0,
  );
  await seek(1);
  await seek(15);
  await expectCaption(
    'Seek backward, then change the speed.\n[MOCK] Seek backward, then change the speed.',
  );
  await page.getByLabel('Speed').selectOption('2');
  await expectCaption(
    'Seek backward, then change the speed.\n[MOCK] Seek backward, then change the speed.',
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('video').playbackRate),
    2,
  );
  await seek(1);
  await expectCaption(first);
  await page
    .getByRole('button', { name: 'Revise first cue', exact: true })
    .click();
  await expectCaption('Revised first cue.\n[MOCK] Revised first cue.');
  await page
    .getByRole('button', { name: 'Replace track', exact: true })
    .click();
  await expectCaption(
    'Replacement track. The old cue must be gone.\n[MOCK] Replacement track. The old cue must be gone.',
  );
  await page
    .getByRole('button', { name: 'Container fullscreen', exact: true })
    .click();
  await page.waitForFunction(() => document.fullscreenElement?.id === 'player');
  await page.waitForFunction(() =>
    document.fullscreenElement?.contains(
      document.querySelector('subtitle-translator-overlay'),
    ),
  );
  await page.screenshot({ path: join(screenshots, 'mock-fullscreen.png') });
  await page.evaluate(() => document.exitFullscreen());
  await page
    .getByRole('button', { name: 'Video fullscreen (fallback)', exact: true })
    .click();
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  assert.equal(
    await page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'showing',
  );
  await page.evaluate(() => document.exitFullscreen());
  await enable();
  await page
    .getByRole('button', { name: 'Same-page navigation', exact: true })
    .click();
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  await enable();
  await page
    .getByRole('button', { name: 'Replace video', exact: true })
    .click();
  await page
    .locator('subtitle-translator-overlay')
    .waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector('video').readyState >= 2,
  );
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  await enable();
  await seek(1);
  await send('playback.disable');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('video').textTracks[0].mode,
    ),
    'showing',
  );
  // Full navigation does not automatically reactivate the overlay.
  await enable();
  await seek(1);
  await expectCaption(first);
  await page.goto('http://127.0.0.1:4173/?navigation=full');
  assert.equal(await page.locator('subtitle-translator-overlay').count(), 0);
  assert.deepEqual(errors, []);
  console.log(
    `Playback browser checks passed in Chromium ${context.browser().version()}.`,
  );
  console.log(
    'Verified production/mock separation, timing, pause/seek/rate, overlaps, plain text, revision/track replacement, fullscreen, cleanup and navigation. Toolbar activeTab grant awaits owner B2.',
  );
} finally {
  await context?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
}
