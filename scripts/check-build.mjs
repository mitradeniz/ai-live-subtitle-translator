import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));

assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '151');
assert.equal(manifest.background?.service_worker, 'background.js');
assert.equal(manifest.action?.default_popup, 'popup.html');
assert.equal(manifest.options_ui?.page, 'options.html');
assert.equal(manifest.options_ui?.open_in_tab, true);

assert.deepEqual(manifest.permissions, ['storage']);
assert.equal(manifest.incognito, 'not_allowed');
// Settings and credentials need storage, but no site access or injected code.
for (const field of [
  'host_permissions',
  'optional_permissions',
  'optional_host_permissions',
  'content_scripts',
  'web_accessible_resources',
]) {
  assert.equal(manifest[field]?.length ?? 0, 0, `Unexpected ${field}`);
}
assert.equal(manifest.externally_connectable, undefined);
assert.equal(manifest.update_url, undefined);
assert.equal(
  manifest.content_security_policy?.extension_pages,
  "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'",
);

const files = await readdir(output, { recursive: true, withFileTypes: true });
for (const file of files.filter((entry) => entry.isFile())) {
  assert.match(
    file.name,
    /\.(?:html|js|css|json)$/,
    `Unexpected file ${file.name}`,
  );
  assert.ok(!file.name.startsWith('.'), `Unexpected hidden file ${file.name}`);
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
console.log(
  'Production build: MV3 entrypoints, local scripts, CSP, and storage-only permissions verified.',
);
