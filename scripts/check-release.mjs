import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import './check-build.mjs';

const output = resolve('.output/chrome-mv3');
const manifest = JSON.parse(await readFile(`${output}/manifest.json`, 'utf8'));
assert.match(manifest.version_name, /^\d+\.\d+\.\d+-preview\.\d+$/);
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
export const archive = resolve(
  `.output/${pkg.name}-${manifest.version_name}-chrome.zip`,
);
export const version = manifest.version_name;
const files = await readdir(output, { recursive: true, withFileTypes: true });
assert.ok(
  !files.some((file) => file.isSymbolicLink()),
  'Do not package symbolic links',
);
const names = files
  .filter((file) => file.isFile())
  .map((file) =>
    relative(output, resolve(file.parentPath, file.name)).replaceAll('\\', '/'),
  )
  .sort();
const listed = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
  .trim()
  .split('\n');
assert.deepEqual(
  listed,
  names,
  'Archive must contain exactly the inspected extension files at its root',
);
execFileSync('unzip', ['-tq', archive], { stdio: 'pipe' });
const inventory = [];
for (const name of names) {
  const disk = await readFile(resolve(output, name));
  const archived = execFileSync('unzip', ['-p', archive, name], {
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.deepEqual(
    archived,
    disk,
    `Archive differs from inspected build: ${name}`,
  );
  inventory.push({
    path: name,
    bytes: disk.length,
    sha256: createHash('sha256').update(disk).digest('hex'),
  });
}
export const checksum = createHash('sha256')
  .update(await readFile(archive))
  .digest('hex');
await writeFile(`${archive}.sha256`, `${checksum}  ${basename(archive)}\n`);
await writeFile(
  archive.replace(/\.zip$/, '.inventory.json'),
  JSON.stringify({ version, files: inventory }, null, 2) + '\n',
);
console.log(
  `Verified ${names.length} extension-only files: ${archive}\nSHA-256 ${checksum}`,
);
