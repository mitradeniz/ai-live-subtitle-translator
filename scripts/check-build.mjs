import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const mock = process.argv.includes('--mock');
const output = resolve(mock ? '.output/chrome-mv3-mock' : '.output/chrome-mv3');
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '151');
assert.equal(manifest.background?.service_worker, 'background.js');
assert.equal(manifest.action?.default_popup, 'popup.html');
assert.equal(manifest.options_ui?.page, 'options.html');
assert.equal(manifest.options_ui?.open_in_tab, true);

assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'scripting']);
assert.equal(
  manifest.name,
  mock ? '[TEST] Subtitle timing lab' : 'AI Live Subtitle Translator',
);
assert.equal(manifest.incognito, 'not_allowed');
// No required hosts or static injection; automatic YouTube access is optional.
for (const field of [
  'host_permissions',
  'optional_permissions',
  'content_scripts',
  'web_accessible_resources',
]) {
  assert.equal(manifest[field]?.length ?? 0, 0, `Unexpected ${field}`);
}
assert.deepEqual(
  manifest.optional_host_permissions ?? [],
  mock
    ? []
    : [
        'https://translate.googleapis.com/*',
        'https://api.openai.com/*',
        'https://translation.googleapis.com/*',
        'https://api.deepseek.com/*',
        'https://generativelanguage.googleapis.com/*',
        'https://www.youtube.com/*',
      ],
);
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.update_url, undefined);
assert.equal(
  manifest.content_security_policy?.extension_pages,
  mock
    ? "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'"
    : "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src https://translate.googleapis.com https://api.openai.com https://translation.googleapis.com https://api.deepseek.com https://generativelanguage.googleapis.com",
);

const files = await readdir(output, { recursive: true, withFileTypes: true });
for (const file of files.filter((entry) => entry.isFile())) {
  assert.match(
    file.name,
    /\.(?:html|js|css|json|png)$/,
    `Unexpected file ${file.name}`,
  );
  assert.ok(!file.name.startsWith('.'), `Unexpected hidden file ${file.name}`);
  if (file.name.endsWith('.png')) continue;
  const source = await readFile(resolve(file.parentPath, file.name), 'utf8');
  for (const marker of [
    'SENTINEL_NOT_A_REAL',
    'provider.example.test',
    'boundary-probe',
    '.local-notes',
  ]) {
    assert.ok(!source.includes(marker), `Test/private marker in ${file.name}`);
  }
  if (!mock)
    for (const marker of [
      '[MOCK]',
      'MOCK · Timing test',
      'Enable mock captions',
    ]) {
      assert.ok(
        !source.includes(marker),
        `Mock code/UI leaked into ${file.name}`,
      );
    }
}

for (const name of ['popup.html', 'options.html']) {
  const html = await readFile(`${output}/${name}`, 'utf8');
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length > 0, `${name} has no entry script`);
  for (const [, attributes, body] of scripts) {
    assert.equal(body.trim(), '', `${name} contains an inline script`);
    const src = attributes.match(/\bsrc="([^"]+)"/)?.[1];
    assert.ok(src && /^\/?(?:assets|chunks)\/[\w.-]+\.js$/.test(src));
    await readFile(resolve(output, src.replace(/^\//, '')));
  }
}
await readFile(`${output}/background.js`);
await readFile(`${output}/youtube-source.js`);
const content = await readFile(`${output}/content-scripts/captions.js`, 'utf8');
assert.equal(
  content.includes('[MOCK]'),
  mock,
  'Mock output must exist only in the test build',
);
console.log(
  'Production build: MV3 entrypoints, local scripts, CSP, and user-triggered permissions verified.',
);

for (const size of [16, 32, 48, 128]) {
  const name = `icons/icon-${size}.png`;
  assert.equal(manifest.icons[size], name);
  if (size <= 32) assert.equal(manifest.action.default_icon[size], name);
  const png = await readFile(`${output}/${name}`);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}
await readFile(`${output}/content-scripts/auto.js`);
