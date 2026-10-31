import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { archive, checksum } from './check-release.mjs';
import './check-repository.mjs';

const root = process.cwd();
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(process.versions.node, (await readFile('.nvmrc', 'utf8')).trim());
assert.equal(
  execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim(),
  pkg.packageManager.split('@')[1],
);
const temp = await mkdtemp(join(tmpdir(), 'subtitle-repro-'));
try {
  // Only version-controlled paths, including newly staged files. Never copy
  // arbitrary untracked files or the original node_modules/browser profiles.
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8' })
        .split('\0')
        .filter(Boolean),
    ),
  ];
  for (const path of files) {
    await mkdir(dirname(join(temp, path)), { recursive: true });
    await cp(join(root, path), join(temp, path));
  }
  // The shared content-addressed store avoids network; node_modules and generated
  // WXT files are installed from scratch in a different directory.
  execFileSync(
    'pnpm',
    [
      'install',
      '--frozen-lockfile',
      '--offline',
      '--store-dir',
      resolve('.pnpm-store'),
    ],
    { cwd: temp, stdio: 'inherit' },
  );
  execFileSync(
    'pnpm',
    [
      process.argv.includes('--firefox')
        ? 'release:firefox'
        : 'release:package',
    ],
    { cwd: temp, stdio: 'inherit' },
  );
  const rebuilt = await readFile(join(temp, '.output', basename(archive)));
  assert.equal(
    createHash('sha256').update(rebuilt).digest('hex'),
    checksum,
    'Clean frozen install must reproduce the archive bytes on this toolchain/platform',
  );
  console.log(
    `Reproducible clean install/build: ${files.length} source files, ${process.version}, ${pkg.packageManager}, ${process.platform}-${process.arch}, SHA-256 ${checksum}`,
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
