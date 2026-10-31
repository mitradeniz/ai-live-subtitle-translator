import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
const temp = await mkdtemp(join(tmpdir(), 'edge-tools-'));
let context;
let requests = 0;
try {
  const extension = join(temp, 'extension');
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  // Only this isolated copy pregrants the hosts for both permission modes. Native permission dialogs remain owner checks.
  await writeFile(
    join(extension, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      host_permissions: ['https://*/*', 'http://*/*'],
    }),
  );
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
    context.setDefaultTimeout(15000);
    await context.setOffline(true);
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === 'chrome-extension:') return route.continue();
      if (
        ['https://edge.example.test', 'https://other.example.test'].includes(
          url.origin,
        )
      )
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Edge fixture</title><p>Ordinary synthetic page.</p>',
        });
      requests++;
      return route.abort();
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent('serviceworker'));
    return new URL(worker.url()).hostname;
  }
  let id = await launch();
  let popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  let page = await context.newPage();
  await page.goto('https://edge.example.test/article');
  const message = (type, extra = {}) =>
    popup.evaluate((body) => chrome.runtime.sendMessage(body), {
      version: 1,
      requestId: 'edge-test',
      type,
      ...extra,
    });
  await page.bringToFront();
  await popup.reload();
  // Page tools live in the popup's second section; the choice is remembered.
  await popup
    .getByRole('tab', { name: 'Page translation', exact: true })
    .click();
  await popup.getByText('Customize translation', { exact: true }).click();
  await popup.getByText('https://edge.example.test', { exact: true }).waitFor();
  const automatic = popup.getByLabel('Always show the logo on this site');
  await popup.evaluate(() => {
    window.savedRequest = chrome.permissions.request;
    chrome.permissions.request = async (request) => {
      window.requested = request;
      return false;
    };
  });
  await automatic.click();
  await popup
    .getByText(
      'Site access was not granted. You can still enable tools for this visit.',
    )
    .waitFor();
  assert.deepEqual(await popup.evaluate(() => window.requested), {
    origins: ['https://edge.example.test/*'],
  });
  assert.equal(await automatic.isChecked(), false);
  assert.equal(await page.locator('translator-page-tools').count(), 0);
  await popup.evaluate(() => {
    chrome.permissions.request = window.savedRequest;
  });
  await page.bringToFront();
  await automatic.click();
  await page.locator('translator-page-tools').waitFor();
  assert.equal(requests, 0);
  let registrations = await popup.evaluate(() =>
    chrome.scripting.getRegisteredContentScripts(),
  );
  const edge = registrations.find((entry) => entry.id === 'edge-tools-auto');
  assert.deepEqual(edge.matches, ['https://edge.example.test/*']);
  assert.equal(edge.allFrames, false);
  assert.deepEqual(edge.js, ['content-scripts/edge-auto.js']);
  await page.reload();
  await page.bringToFront();
  let tools = page.locator('translator-page-tools');
  await tools.waitFor();
  // The idle logo opens its menu only on a real click; nothing is sent.
  await tools.locator('.trigger').hover();
  await tools.locator('.trigger').evaluate((button) => button.click());
  assert.equal(await tools.locator('.panel').isVisible(), false);
  await tools.locator('.trigger').click();
  await tools.locator('.panel').waitFor({ state: 'visible' });
  const videoSwitch = tools.getByRole('switch', {
    name: 'Video subtitles',
    exact: true,
  });
  await videoSwitch.evaluate((button) => button.click());
  await page.waitForTimeout(250);
  assert.equal(
    await videoSwitch.getAttribute('aria-checked'),
    'false',
    'Synthetic switch click is ignored',
  );
  assert.equal(requests, 0, 'Opening the menu must not translate');
  // No engine is configured: a real click gives guidance without network activity.
  await videoSwitch.click();
  await tools
    .getByText('Choose a provider and translated display in the popup first.')
    .waitFor();
  assert.equal(await videoSwitch.getAttribute('aria-checked'), 'false');
  await page.evaluate(() => history.pushState({}, '', '/next'));
  await page.waitForTimeout(2400);
  await tools.waitFor();
  assert.equal(await tools.count(), 1);
  await tools.locator('.trigger').click();
  await tools.locator('.panel').waitFor({ state: 'visible' });
  await tools
    .getByRole('button', { name: 'Translate visible page', exact: true })
    .waitFor();
  await page.screenshot({ path: '.output/edge-auto-menu.png' });
  const other = await context.newPage();
  await other.goto('https://other.example.test/article');
  assert.equal(await other.locator('translator-page-tools').count(), 0);
  // Explicit all-sites opt-in is one gesture; denial must not turn it on.
  await page.bringToFront();
  await popup.reload();
  const everywhere = popup.getByLabel('Show the logo on all sites');
  await popup.evaluate(() => {
    window.savedRequest = chrome.permissions.request;
    chrome.permissions.request = async (request) => {
      window.requested = request;
      return false;
    };
  });
  await everywhere.click();
  await popup
    .getByText('All-sites access was not granted. You can try again.')
    .waitFor();
  assert.deepEqual(await popup.evaluate(() => window.requested), {
    origins: ['https://*/*', 'http://*/*'],
  });
  assert.equal(await everywhere.isChecked(), false);
  await popup.evaluate(() => {
    chrome.permissions.request = window.savedRequest;
  });
  await page.bringToFront();
  await everywhere.click();
  await popup
    .getByText(
      'The logo stays on across sites until you turn it off. Showing it does not translate anything.',
    )
    .waitFor();
  assert.equal((await message('page.site-status')).data.allSites, true);
  assert.deepEqual(
    (await popup.evaluate(() => chrome.scripting.getRegisteredContentScripts()))
      .find((entry) => entry.id === 'edge-tools-auto')
      .matches.sort(),
    ['http://*/*', 'https://*/*'],
  );
  await other.reload();
  await other.locator('translator-page-tools').waitFor();
  assert.equal(requests, 0);
  // The expiry hint reconnects only idle tools under the saved host authorization.
  await other
    .locator('translator-page-tools')
    .evaluate((host) => (host.dataset.edgeExpired = 'true'));
  await other.waitForFunction(() => {
    const host = document.querySelector('translator-page-tools');
    return host && !host.hasAttribute('data-edge-expired');
  });
  assert.equal(requests, 0);
  // Relaunch the isolated browser profile: persistent registration/settings survive.
  await context.close();
  context = undefined;
  id = await launch();
  popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  page = await context.newPage();
  await page.goto('https://edge.example.test/restart');
  tools = page.locator('translator-page-tools');
  await tools.waitFor();
  assert.equal(requests, 0);
  await page.bringToFront();
  const second = await context.newPage();
  await second.goto('https://other.example.test/restart');
  await second.locator('translator-page-tools').waitFor();
  await page.bringToFront();
  const disabled = await message('page.global-configure', { enabled: false });
  assert.equal(disabled.data.enabled, false);
  await second.locator('translator-page-tools').waitFor({ state: 'detached' });
  await tools.waitFor({ state: 'detached' });
  registrations = await popup.evaluate(() =>
    chrome.scripting.getRegisteredContentScripts(),
  );
  assert.equal(
    registrations.some((entry) => entry.id === 'edge-tools-auto'),
    false,
  );
  await page.reload();
  await page.waitForTimeout(500);
  assert.equal(await tools.count(), 0);
  await page.bringToFront();
  assert.equal(
    (await message('page.global-configure', { enabled: true })).data.enabled,
    true,
  );
  await tools.waitFor();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  const cleared = await options.evaluate(() =>
    chrome.runtime.sendMessage({
      version: 1,
      requestId: 'edge-clear',
      type: 'data.clear',
    }),
  );
  assert.equal(cleared.ok, true);
  await tools.waitFor({ state: 'detached' });
  await page.reload();
  await page.waitForTimeout(500);
  assert.equal(await tools.count(), 0);
  console.log(
    JSON.stringify({
      result: 'passed',
      browser: context.browser().version(),
      providerRequests: requests,
      checks:
        'exact-host grant, denial, idle auto logo, refresh, click-to-open menu, SPA, browser restart, other-origin isolation, opt-out, clear data, all-sites consent/denial, cross-site idle logo and expiry refresh',
    }),
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
