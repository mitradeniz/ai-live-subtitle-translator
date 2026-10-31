import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const temp = await mkdtemp(join(tmpdir(), 'page-tools-'));
let context;
let mode = 'normal';
let release;
const sent = [];
let aiCalls = 0;
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      host_permissions: [
        'https://pages.example.test/*',
        'https://translate.googleapis.com/*',
        'https://api.deepseek.com/*',
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
      const responseMode = mode;
      if (responseMode === 'hold')
        await new Promise((resolve) => {
          release = resolve;
        });
      return route
        .fulfill({
          contentType: 'application/json',
          body:
            responseMode === 'malformed'
              ? '{}'
              : JSON.stringify([[[`TR ${text}`, text]], null, 'en']),
        })
        .catch(() => {});
    }
    if (url.origin === 'https://api.deepseek.com') {
      aiCalls++;
      assert.equal(
        route.request().headers().authorization,
        'Bearer SENTINEL_PAGE_NOT_A_KEY',
      );
      const body = route.request().postDataJSON();
      assert.equal(body.tools, undefined);
      assert.ok(body.messages[0].content.includes('Writing task:'));
      const data = JSON.parse(body.messages[1].content);
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  items: data.items.map((item) => ({
                    ...item,
                    text: `Polished <b>${item.text}</b>`,
                  })),
                }),
              },
            },
          ],
        }),
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
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  const page = await context.newPage();
  await page.goto('https://pages.example.test/article');
  const send = (type, extra = {}) =>
    options.evaluate((message) => chrome.runtime.sendMessage(message), {
      version: 1,
      requestId: 'page-test',
      type,
      ...extra,
    });
  const prefs = {
    page: true,
    captions: true,
    selection: true,
    hover: true,
    input: true,
    writing: true,
    clickAction: 'page',
    display: 'bilingual',
  };
  await send('google.enable');
  await send('page.configure', { preferences: prefs });
  const enable = async (run = false) => {
    await page.bringToFront();
    const result = await popup.evaluate(
      (run) =>
        chrome.runtime.sendMessage({
          version: 1,
          requestId: 'page-enable',
          type: 'page.enable',
          run,
        }),
      run,
    );
    assert.equal(result.ok, true);
    assert.notEqual(result.data.state, 'unavailable');
  };
  const originalFirst = await page.locator('#first').textContent();
  const tools = page.locator('translator-page-tools');
  const trigger = tools.getByRole('button', {
    name: 'Translate · hover for tools',
    exact: true,
  });
  const menu = async () => {
    await trigger.focus();
    await page.keyboard.press('F2');
  };
  await enable(false);
  await menu();
  assert.equal(sent.length, 0, 'Opening tools does not transmit text');
  // Synthetic page clicks must not trigger requests.
  await tools
    .getByRole('button', { name: 'Translate visible page', exact: true })
    .evaluate((button) => button.click());
  await page.waitForTimeout(250);
  assert.equal(sent.length, 0);
  await trigger.click();
  await page.waitForFunction(() =>
    document
      .querySelector('#first [data-page-translation]')
      ?.textContent.startsWith('TR '),
  );
  await page
    .waitForFunction(() =>
      document
        .querySelector('translator-page-tools')
        ?.shadowRoot.querySelector('[role="status"]')
        .textContent.includes('Visible text ready'),
    )
    .catch(async (error) => {
      throw new Error(
        JSON.stringify({
          status: await tools.getByRole('status').textContent(),
          sent,
        }),
        { cause: error },
      );
    });
  assert.ok(!sent.some((text) => text.includes('Lower paragraph')));
  assert.ok(
    !sent.some((text) =>
      /PRIVATE_SENTINEL|PASSWORD_SENTINEL|CARD_SENTINEL|NO_TRANSLATE/.test(
        text,
      ),
    ),
  );
  assert.equal(await page.locator('#first img').count(), 0);
  assert.equal(await page.locator('#link').getAttribute('href'), '#lower');
  await page.locator('#lower').scrollIntoViewIfNeeded();
  await page.waitForFunction(() =>
    document
      .querySelector('#lower [data-page-translation]')
      ?.textContent.includes('TR Lower paragraph'),
  );
  await page.evaluate(() => {
    const p = document.createElement('p');
    p.textContent = 'New dynamic sentence.';
    document.querySelector('#dynamic').append(p);
  });
  await page.waitForFunction(() =>
    document
      .querySelector('#dynamic [data-page-translation]')
      ?.textContent.includes('TR New dynamic'),
  );
  await menu();
  await tools
    .getByRole('button', { name: 'Restore original page', exact: true })
    .click();
  assert.equal(await page.locator('[data-page-translation]').count(), 0);
  assert.equal(await page.locator('#first').textContent(), originalFirst);
  await page.locator('#selectable').scrollIntoViewIfNeeded();
  const target = await page.locator('#selectable').boundingBox();
  await page.mouse.move(target.x + 5, target.y + 5);
  await page.mouse.down();
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('#selectable'));
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  });
  await page.mouse.up();
  await menu();
  await tools
    .getByRole('button', { name: 'Translate selection', exact: true })
    .click();
  await tools
    .locator('.result')
    .filter({ hasText: 'TR Selection preview sentence.' })
    .waitFor();
  const beforeHover = sent.length;
  await page.keyboard.press('Escape');
  await page.locator('#selectable').hover();
  await page.waitForTimeout(750);
  assert.equal(sent.length, beforeHover);
  await page.mouse.move(10, 10);
  await page.keyboard.down('Alt');
  await page.locator('#selectable').hover();
  await tools
    .locator('.result')
    .filter({ hasText: 'TR Selection preview sentence.' })
    .waitFor();
  // Wait for the distinct hover request, not the previous selection result.
  const deadline = Date.now() + 10000;
  while (sent.length === beforeHover && Date.now() < deadline)
    await page.waitForTimeout(50);
  await page.keyboard.up('Alt');
  assert.ok(sent.length > beforeHover);
  await page.locator('#editor').fill('Please improve this draft.');
  await menu();
  await tools
    .getByRole('button', { name: 'Translate focused field', exact: true })
    .click();
  await tools
    .locator('.result')
    .filter({ hasText: 'TR Please improve this draft.' })
    .waitFor();
  assert.equal(
    await page.locator('#editor').inputValue(),
    'Please improve this draft.',
  );
  await tools
    .getByRole('button', { name: 'Apply to focused field', exact: true })
    .click();
  assert.equal(
    await page.locator('#editor').inputValue(),
    'TR Please improve this draft.',
  );
  assert.equal(await page.evaluate(() => window.submitted), undefined);
  await send('ai.configure', {
    profile: {
      schemaVersion: 1,
      endpoint: 'https://api.deepseek.com/chat/completions',
      model: 'deepseek-flash',
    },
  });
  await send('credentials.set', {
    credentialId: 'ai',
    credential: {
      schemaVersion: 1,
      origin: 'https://api.deepseek.com',
      key: 'SENTINEL_PAGE_NOT_A_KEY',
    },
  });
  await send('ai.enable');
  await enable();
  await page.locator('#editor').fill('Short writing draft.');
  await menu();
  await tools.getByRole('button', { name: 'AI Writing', exact: true }).click();
  await tools
    .locator('.result')
    .filter({ hasText: 'Polished <b>Short writing draft.</b>' })
    .waitFor();
  assert.equal(await tools.locator('.result b').count(), 0);
  assert.equal(
    await page.locator('#editor').inputValue(),
    'Short writing draft.',
  );
  await page.locator('#editor').fill('User edited while preview was open.');
  await menu();
  await tools
    .getByRole('button', { name: 'Apply to focused field', exact: true })
    .click();
  assert.equal(
    await page.locator('#editor').inputValue(),
    'User edited while preview was open.',
  );
  assert.equal(aiCalls, 1);
  await page.screenshot({ path: '.output/page-tools.png' });
  await send('google.enable');
  await enable();
  mode = 'hold';
  await menu();
  await tools
    .getByRole('button', { name: 'Translate visible page', exact: true })
    .click();
  const heldDeadline = Date.now() + 10000;
  while (!release && Date.now() < heldDeadline) await page.waitForTimeout(50);
  assert.ok(release);
  await tools
    .getByRole('button', { name: 'Restore original page', exact: true })
    .click();
  release();
  release = undefined;
  mode = 'normal';
  await page.waitForTimeout(250);
  assert.equal(
    await page.locator('[data-page-translation]').count(),
    0,
    'Late output after restore must not repaint',
  );
  await send('page.configure', {
    preferences: { ...prefs, display: 'translated' },
  });
  await enable(true);
  await page.waitForFunction(() =>
    document.querySelector('h1').textContent.startsWith('TR '),
  );
  await send('credentials.delete', { credentialId: 'ai' }); // any security reset restores DOM
  await tools.waitFor({ state: 'detached' });
  assert.equal(await page.locator('h1').textContent(), 'Visible heading.');
  await enable();
  await page.goto('https://pages.example.test/next');
  assert.equal(await tools.count(), 0);
  await page.evaluate(() => {
    document.body.replaceChildren(
      Object.assign(document.createElement('p'), {
        textContent: 'Malformed response must leave this original intact.',
      }),
    );
  });
  mode = 'malformed';
  const beforeMalformed = sent.length;
  await enable(true);
  await page.waitForFunction(() =>
    document
      .querySelector('translator-page-tools')
      ?.shadowRoot?.querySelector('.status')
      ?.textContent.includes('unsupported response'),
  );
  await page.waitForTimeout(1500);
  assert.equal(
    sent.length,
    beforeMalformed + 1,
    'Invalid output must not loop',
  );
  assert.equal(
    await page.locator('body > p').textContent(),
    'Malformed response must leave this original intact.',
  );
  assert.equal(await page.locator('[data-page-translation]').count(), 0);
  console.log(
    JSON.stringify({
      browser: context.browser().version(),
      result: 'passed',
      googleRequests: sent.length,
      aiRequests: aiCalls,
      checks:
        'visible-only, scroll, dynamic text, exclusions, literal markup, restore, trusted gestures, selection, Alt-hover, field preview/apply, writing, stale edit/result, reset, navigation and malformed-output stop',
    }),
  );
} finally {
  release?.();
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
