import { spawnSync } from 'node:child_process';

// Both inspected builds must already exist. Never pass the Google suite --live.
for (const suite of [
  'security',
  'gate',
  'playback',
  'youtube',
  'google',
  'ai',
  'providers',
  'work',
  'controls',
  'page',
  'edge',
]) {
  const result = spawnSync(process.execPath, [`tests/browser-${suite}.mjs`], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
