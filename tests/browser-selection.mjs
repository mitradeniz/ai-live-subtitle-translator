import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const temp = await mkdtemp(join(tmpdir(), 'selection-preview-'));
let context;
let hold = false,
  release;
const sent = [];
const languagesSent = [];
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
        'https://pages.example.test/*',
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
    if (url.origin === 'https://pages.example.test')
      return route.fulfill({
        contentType: 'text/html',
        body: await readFile('tests/fixtures/page/index.html', 'utf8'),
      });
    if (url.origin === 'https://translate.googleapis.com') {
      const text = url.searchParams.get('q');
      sent.push(text);
      languagesSent.push({
        source: url.searchParams.get('sl'),
        target: url.searchParams.get('tl'),
      });
      if (hold)
        await new Promise((resolve) => {
          release = resolve;
        });
      return route
        .fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            [[`${url.searchParams.get('tl').toUpperCase()} ${text}`, text]],
            null,
            'en',
          ]),
        })
        .catch(() => {});
    }
    return route.abort();
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
  await page.goto('https://pages.example.test/article');
  const send = (type, extra = {}) =>
    options.evaluate((body) => chrome.runtime.sendMessage(body), {
      version: 1,
      requestId: 'selection-test',
      type,
      ...extra,
    });
  const enable = async () => {
    await page.bringToFront();
    const result = await popup.evaluate(() =>
      chrome.runtime.sendMessage({
        version: 1,
        requestId: 'enable-selection',
        type: 'page.enable',
        run: false,
      }),
    );
    assert.equal(result.ok, true);
  };
  const select = async (selector, synthetic = false) => {
    await page.bringToFront();
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(() => getSelection().removeAllRanges());
    const box = await page.locator(selector).boundingBox();
    await page.mouse.move(box.x + 8, box.y + 8);
    if (!synthetic) await page.mouse.down();
    await page.evaluate((selector) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(selector));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    }, selector);
    if (synthetic)
      await page
        .locator(selector)
        .dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
    else await page.mouse.up();
  };
  await send('google.enable');
  const prefs = (await send('page.preferences')).data.preferences;
  assert.equal(prefs.autoSelection, false);
  await send('page.configure', { preferences: { ...prefs, selection: true } });
  await enable();
  await select('#selectable');
  await page.waitForTimeout(400);
  assert.equal(
    sent.length,
    0,
    'Existing manual selection opt-in does not become automatic',
  );
  await options.bringToFront();
  await options.reload();
  const automatic = options.getByRole('checkbox', {
    name: 'Translate automatically after selection',
  });
  await automatic.check();
  await options
    .getByRole('status')
    .filter({ hasText: 'Preferences saved. Enable page tools' })
    .waitFor();
  assert.equal(
    (await send('page.preferences')).data.preferences.autoSelection,
    true,
  );
  await enable();
  await select('#selectable', true);
  await page.waitForTimeout(400);
  assert.equal(sent.length, 0, 'Script-only selection cannot send text');
  await select('#selectable');
  const card = page.locator('translator-selection-popup').getByRole('dialog');
  await card
    .locator('.result')
    .filter({ hasText: 'TR Selection preview sentence.' })
    .waitFor();
  assert.equal(sent.length, 1);
  assert.match(await card.locator('.recipient').textContent(), /Google.*tr/);
  const targetLanguage = card.getByRole('combobox', {
    name: 'Target language',
  });
  const sourceLanguage = card.getByRole('combobox', {
    name: 'Source language',
  });
  await targetLanguage.evaluate((select) => {
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.value = 'tr';
  });
  await page.waitForTimeout(350);
  assert.equal(sent.length, 1, 'Synthetic language changes cannot send text');
  await targetLanguage.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  await card
    .locator('.result')
    .filter({ hasText: 'EN Selection preview sentence.' })
    .waitFor();
  assert.equal(languagesSent.at(-1).target, 'en');
  await sourceLanguage.focus();
  await page.keyboard.press('t');
  await page.keyboard.press('Tab');
  await card
    .locator('.result')
    .filter({ hasText: 'EN Selection preview sentence.' })
    .waitFor();
  assert.equal(languagesSent.at(-1).source, 'tr');
  await sourceLanguage.focus();
  await page.keyboard.press('a');
  await page.keyboard.press('Tab');
  await card
    .locator('.result')
    .filter({ hasText: 'EN Selection preview sentence.' })
    .waitFor();
  assert.equal(languagesSent.at(-1).source, 'auto');
  await targetLanguage.focus();
  await page.keyboard.press('t');
  await page.keyboard.press('Tab');
  await card
    .locator('.result')
    .filter({ hasText: 'TR Selection preview sentence.' })
    .waitFor();
  const stored = (await send('settings.read')).data.settings;
  assert.equal(stored.sourceLanguage, 'auto');
  assert.equal(stored.targetLanguage, 'tr');
  const afterLanguages = sent.length;

  const rect = await card.boundingBox();
  assert.ok(
    rect.x >= 0 &&
      rect.y >= 0 &&
      rect.x + rect.width <= 1280 &&
      rect.y + rect.height <= 800,
  );
  await page.screenshot({ path: '.output/selection-preview.png' });
  await card.getByRole('button', { name: 'Close', exact: true }).click();
  await card.waitFor({ state: 'hidden' });
  await select('form p');
  await page.waitForTimeout(400);
  assert.equal(sent.length, afterLanguages, 'Form text stays excluded');
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.id = 'long-selection';
    p.textContent = 'x'.repeat(1001);
    document.querySelector('main').prepend(p);
  });
  await select('#long-selection');
  await page.waitForTimeout(400);
  assert.equal(
    sent.length,
    afterLanguages,
    'Oversized selection is not truncated or sent',
  );
  await page.locator('#long-selection').evaluate((node) => node.remove());
  hold = true;
  await page.locator('#selectable').evaluate((node) => {
    node.textContent = 'First held selection.';
  });
  await select('#selectable');
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(50);
  assert.ok(release);
  const beforeLatest = sent.length;
  await select('#first');
  await page.waitForTimeout(400);
  assert.equal(
    sent.length,
    beforeLatest,
    'One request in flight; newest selection waits',
  );
  hold = false;
  release();
  release = undefined;
  await card
    .locator('.result')
    .filter({ hasText: 'literal <img src=x onerror=bad> text.' })
    .waitFor();
  assert.equal(
    await card.locator('img').count(),
    0,
    'Provider output stays plain text',
  );
  assert.equal(
    (await card.locator('.result').textContent()).includes(
      'First held selection.',
    ),
    false,
  );
  // Dismiss the card covering the next target before selecting beneath it.
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'hidden' });
  hold = true;
  await page.locator('#selectable').evaluate((node) => {
    node.textContent = 'Closed selection must stay closed.';
  });
  await select('#selectable');
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(50);
  assert.ok(release);
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'hidden' });
  hold = false;
  release();
  release = undefined;
  await page.waitForTimeout(500);
  assert.equal(
    await card.isVisible(),
    false,
    'Late result cannot reopen a dismissed preview',
  );
  hold = true;
  await page.locator('#selectable').evaluate((node) => {
    node.textContent = 'Source before page rerender.';
  });
  await select('#selectable');
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(50);
  assert.ok(release);
  await page.locator('#selectable').evaluate((node) => {
    node.textContent = 'Changed page content.';
  });
  hold = false;
  release();
  release = undefined;
  await card.waitFor({ state: 'hidden' });
  hold = true;
  await page.locator('#selectable').evaluate((node) => {
    node.textContent = 'Language change during a request.';
  });
  await select('#selectable');
  for (let i = 0; i < 100 && !release; i++) await page.waitForTimeout(50);
  assert.ok(release);
  await targetLanguage.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Tab');
  hold = false;
  release();
  release = undefined;
  await card
    .locator('.result')
    .filter({ hasText: 'EN Language change during a request.' })
    .waitFor();
  assert.equal(languagesSent.at(-1).target, 'en');
  await send('page.configure', {
    preferences: { ...prefs, selection: true, autoSelection: false },
  });
  await enable();
  const beforeOff = sent.length;
  await select('#selectable');
  await page.waitForTimeout(400);
  assert.equal(sent.length, beforeOff, 'Click mode sends nothing on selection');
  const chip = page
    .locator('translator-selection-popup')
    .getByRole('button', { name: 'Translate selection' });
  await chip.waitFor();
  const chipBox = await chip.boundingBox();
  const textBox = await page.locator('#selectable').boundingBox();
  assert.ok(
    chipBox.y >= textBox.y - chipBox.height - 12 &&
      chipBox.y <= textBox.y + textBox.height + 12,
    'The icon sits next to the selection',
  );
  await chip.evaluate((button) => button.click());
  await page.waitForTimeout(350);
  assert.equal(
    sent.length,
    beforeOff,
    'A scripted icon click cannot send text',
  );
  await page.keyboard.press('Escape');
  await chip.waitFor({ state: 'hidden' });
  await select('#selectable');
  await chip.waitFor();
  await chip.click();
  await chip.waitFor({ state: 'hidden' });
  await card
    .locator('.result')
    .filter({ hasText: 'TR Language change during a request.' })
    .waitFor();
  assert.equal(sent.length, beforeOff + 1);
  await page.mouse.click(5, 5);
  await card.waitFor({ state: 'hidden' });
  console.log(
    JSON.stringify({
      result: 'passed',
      browser: context.browser().version(),
      requests: sent.length,
      checks:
        'default off, options opt-in, trusted selection, anchored preview, form/size exclusion, one in flight, newest selection, literal output, close/Escape, stale result, click-to-translate icon',
    }),
  );
} finally {
  release?.();
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
