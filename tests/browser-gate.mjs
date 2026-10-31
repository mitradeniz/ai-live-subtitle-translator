import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

// Execute compiled production code with synthetic credentials and routed responses.
// Scoped host grants and initialization fault injection exist only in this copy.
const temp = await mkdtemp(join(tmpdir(), 'subtitle-gate-'));
const extension = join(temp, 'extension');
const sentinel = 'SENTINEL_NOT_A_REAL_GATE_KEY';
let context;
let options;
let count = 0;
let unexpected = 0;
let mode = 'success';
const logs = [];
const send = (type, extra = {}) =>
  options.evaluate((message) => chrome.runtime.sendMessage(message), {
    version: 1,
    requestId: 'gate-test',
    type,
    ...extra,
  });
async function launch(profileDirectory = join(temp, 'profile')) {
  context = await chromium.launchPersistentContext(profileDirectory, {
    channel: 'chromium',
    headless: true,
    chromiumSandbox: true,
    args: [
      `--load-extension=${extension}`,
      `--disable-extensions-except=${extension}`,
    ],
  });
  context.setDefaultTimeout(12000);
  context.on('console', (message) => logs.push(message.text()));
  await context.setOffline(true);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.href !== 'https://api.openai.com/v1/chat/completions') {
      unexpected++;
      return route.abort();
    }
    count++;
    assert.equal(route.request().headers().authorization, `Bearer ${sentinel}`);
    assert.equal(route.request().headers().cookie, undefined);
    assert.equal(url.search, '');
    if (mode.startsWith('redirect'))
      return route.fulfill({
        status: 307,
        headers: {
          location:
            mode === 'redirect-same'
              ? 'https://api.openai.com/sink'
              : 'https://translation.googleapis.com/sink',
        },
      });
    if (mode === 'oversize')
      return route.fulfill({
        contentType: 'application/json',
        body: ' '.repeat(65537) + sentinel,
      });
    if (mode === 'auth') return route.fulfill({ status: 401, body: sentinel });
    const data = JSON.parse(route.request().postDataJSON().messages[1].content);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: JSON.stringify({
                items: data.items.map((item) => ({
                  id: item.id,
                  revision: item.revision,
                  text: 'Merhaba <script>literal</script> 😊',
                })),
              }),
              ...(mode === 'tools'
                ? {
                    tool_calls: [
                      {
                        id: 'untrusted',
                        type: 'function',
                        function: { name: 'fetch', arguments: '{}' },
                      },
                    ],
                  }
                : {}),
            },
          },
        ],
      }),
    });
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  // Ensure restored workers are started only after Playwright routing is installed.
  const cdp = await context.newCDPSession(options);
  await cdp.send('ServiceWorker.enable');
  await cdp.send('ServiceWorker.stopAllWorkers');
  await cdp.detach();
  await options.reload();
}
try {
  await cp(resolve('.output/chrome-mv3'), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, 'manifest.json'), 'utf8'),
  );
  assert.equal(manifest.host_permissions, undefined);
  manifest.host_permissions = [
    'https://api.openai.com/*',
    'https://translation.googleapis.com/*',
  ];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await launch();
  await options.getByLabel('Target language', { exact: true }).waitFor();
  const profile = {
    schemaVersion: 1,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-5.4-mini-2026-03-17',
  };
  for (const endpoint of [
    'http://api.openai.com/v1/chat/completions',
    'https://user:pass@api.openai.com/v1/chat/completions',
    'https://example.test/completions',
  ]) {
    assert.deepEqual(
      await send('ai.configure', { profile: { ...profile, endpoint } }),
      { ok: false, error: 'INVALID_MESSAGE' },
    );
  }
  assert.deepEqual(await send('fetch', { url: profile.endpoint }), {
    ok: false,
    error: 'INVALID_MESSAGE',
  });
  assert.deepEqual(
    await send('settings.read', { sender: { url: options.url() } }),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.deepEqual(
    await send('settings.read', { padding: 'x'.repeat(200000) }),
    { ok: false, error: 'INVALID_MESSAGE' },
  );
  assert.equal((await send('ai.configure', { profile })).ok, true);
  assert.equal(
    (
      await send('credentials.set', {
        credentialId: 'ai',
        credential: {
          schemaVersion: 1,
          origin: 'https://api.openai.com',
          key: sentinel,
        },
        rememberOnDevice: true,
      })
    ).ok,
    true,
  );
  assert.equal((await send('ai.enable')).ok, true);
  assert.equal(count, 0, 'Configuration must not test the key automatically');
  for (const [scenario, error] of [
    ['redirect-same', 'NETWORK'],
    ['redirect-cross', 'NETWORK'],
    ['oversize', 'RESPONSE'],
    ['tools', 'RESPONSE'],
    ['success', undefined],
    ['auth', 'AUTH'],
  ]) {
    mode = scenario;
    await options.waitForTimeout(1600);
    const reply = await send('ai.test');
    assert.equal(reply.ok, true, scenario);
    assert.equal(
      reply.data.success,
      error === undefined,
      JSON.stringify(reply),
    );
    assert.equal(reply.data.error, error, scenario);
    assert.ok(!JSON.stringify(reply).includes(sentinel));
  }
  const afterAuth = count;
  await options.waitForTimeout(1600);
  for (let i = 0; i < 20; i++) {
    const reply = await send('ai.test');
    assert.equal(reply.data.success, false);
    assert.equal(
      reply.data.error,
      'AUTH',
      'Credential failure must stay blocked beyond the request spacing window',
    );
  }
  assert.equal(
    count,
    afterAuth,
    'Repeated credential failures must not loop paid requests',
  );
  assert.equal(count, 6);
  assert.equal(
    unexpected,
    0,
    'Redirects must not reach even another permitted host',
  );

  // Inserting actual DOM scripts tests browser CSP; evaluate alone bypasses CSP.
  await options.evaluate(() => {
    globalThis.__gateViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      globalThis.__gateViolations.push(event.effectiveDirective),
    );
    const inline = document.createElement('script');
    inline.textContent = 'globalThis.__gateInlineExecuted = true';
    document.head.append(inline);
    const remote = document.createElement('script');
    remote.src = 'https://api.openai.com/remote-code.js';
    document.head.append(remote);
  });
  await options.waitForFunction(() => globalThis.__gateViolations.length >= 2);
  assert.equal(
    await options.evaluate(() => globalThis.__gateInlineExecuted),
    undefined,
  );
  assert.ok(
    (await options.evaluate(() => globalThis.__gateViolations)).every(
      (value) => value === 'script-src-elem',
    ),
  );
  assert.equal(
    unexpected,
    0,
    'CSP must block remote executable requests before dispatch',
  );
  assert.ok(!JSON.stringify(await send('settings.export')).includes(sentinel));

  await context.close();
  context = undefined;
  const background = join(extension, 'background.js');
  await writeFile(
    background,
    'chrome.storage.local.setAccessLevel = async () => { throw new Error("injected initialization failure"); };\n' +
      (await readFile(background, 'utf8')),
  );
  // A fresh profile avoids Chromium's cached worker script masking the injected
  // fault. Normal persisted-key restart is covered by browser-security/ai.
  await launch(join(temp, 'fault-profile'));
  for (const [type, extra] of [
    ['settings.read', {}],
    ['settings.export', {}],
    ['credentials.status', { credentialId: 'ai' }],
    ['credentials.delete', { credentialId: 'ai' }],
    [
      'credentials.set',
      {
        credentialId: 'ai',
        credential: {
          schemaVersion: 1,
          origin: 'https://api.openai.com',
          key: sentinel,
        },
        rememberOnDevice: true,
      },
    ],
  ]) {
    const result = await send(type, extra);
    assert.deepEqual(result, { ok: false, error: 'UNAVAILABLE' });
    assert.ok(!JSON.stringify(result).includes(sentinel));
  }
  assert.equal(
    count,
    afterAuth,
    'Failed initialization must not send provider traffic',
  );
  assert.ok(
    !logs.some((message) => message.includes(sentinel)),
    'Console output must not expose credentials or provider error bodies',
  );
  console.log(
    'Packaged gate passed: fixed destinations, real redirect/CSP enforcement, bounded responses, paid failure stop, safe export, fail-closed worker initialization. Six mocked requests; no live provider.',
  );
} finally {
  await context?.close();
  await rm(temp, { recursive: true, force: true });
}
