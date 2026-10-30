import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Custom WXT mode selects the fixture tool; NODE_ENV keeps React/Vite in production.
const cli = fileURLToPath(
  new URL('../node_modules/wxt/bin/wxt.mjs', import.meta.url),
);
const result = spawnSync(
  process.execPath,
  [cli, 'build', '-b', 'chrome', '--mv3', '--mode', 'mock'],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
