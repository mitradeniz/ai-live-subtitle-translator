import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const path of tracked) {
  assert.ok(
    !/(^|\/)(?:\.local-notes|\.output|\.wxt|node_modules|\.pnpm-store|\.browser-profiles|test-results|playwright-report)(\/|$)/.test(
      path,
    ),
    `Private/generated tracked path: ${path}`,
  );
  assert.ok(
    !/(^|\/)\.env(?:\.|$)/.test(path) ||
      path.endsWith('/.env.example') ||
      path === '.env.example',
    `Tracked environment file: ${path}`,
  );
  assert.ok(
    !/\.(?:pem|key|p12|pfx)$/i.test(path),
    `Credential-like file: ${path}`,
  );
}
assert.ok(tracked.includes('pnpm-lock.yaml'));
assert.equal(
  execFileSync('git', ['check-ignore', '.local-notes/probe.md'], {
    encoding: 'utf8',
  }).trim(),
  '.local-notes/probe.md',
);
console.log(
  'Tracked inventory excludes local notes, environments, private key files and generated artifacts. This path check does not prove absence of embedded secrets.',
);
