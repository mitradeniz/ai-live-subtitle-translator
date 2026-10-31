import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

// WebDriver BiDi against an installed Firefox, with a new disposable profile.
// No owner's profile, credentials, unsigned-install preference or certificate
// override. System access is limited to this test process to discover addon URLs.
export async function firefoxSession() {
  const profile = await mkdtemp(join(tmpdir(), 'subtitle-firefox-'));
  const extensionOrigin =
    'moz-extension://b3758a6d-b3c8-4724-ad3a-0ffdd31e0a73/';
  await writeFile(
    join(profile, 'user.js'),
    `user_pref("extensions.webextensions.uuids", ${JSON.stringify(JSON.stringify({ 'ai-video-subtitle-translator@mitradeniz': extensionOrigin.split('/')[2] }))});`,
  );
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  const process = spawn(
    globalThis.process.env.FIREFOX_BINARY ??
      '/Applications/Firefox.app/Contents/MacOS/firefox',
    [
      '-no-remote',
      '-profile',
      profile,
      '--headless',
      '--remote-debugging-port',
      String(port),
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...globalThis.process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    },
  );
  process.stderr.on('data', () => {});
  let socket;
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
        await new Promise((resolve, reject) => {
          socket.addEventListener('open', resolve, { once: true });
          socket.addEventListener('error', reject, { once: true });
        });
        break;
      } catch {
        socket?.close();
        await delay(100);
      }
    }
    if (socket?.readyState !== WebSocket.OPEN)
      throw new Error('Firefox BiDi unavailable');
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', ({ data }) => {
      const response = JSON.parse(data);
      const item = pending.get(response.id);
      if (!item) return;
      pending.delete(response.id);
      clearTimeout(item.timer);
      if (response.type === 'error')
        item.reject(
          new Error(`${item.method}: ${response.error}: ${response.message}`),
        );
      else item.resolve(response.result);
    });
    const command = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const key = ++id;
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(new Error(`Timeout: ${method}`));
        }, 20000);
        pending.set(key, { resolve, reject, timer, method });
        socket.send(JSON.stringify({ id: key, method, params }));
      });
    const session = await command('session.new', { capabilities: {} });
    const evaluate = async (context, expression) => {
      const response = await command('script.evaluate', {
        expression: `(async () => JSON.stringify(await (${expression})))()`,
        target: { context },
        awaitPromise: true,
      });
      if (response.type !== 'success')
        throw new Error(JSON.stringify(response.exceptionDetails));
      return response.result.value === undefined
        ? undefined
        : JSON.parse(response.result.value);
    };
    const open = async (url) => {
      const { context } = await command('browsingContext.create', {
        type: 'tab',
      });
      await command('browsingContext.navigate', {
        context,
        url,
        wait: 'complete',
      });
      return context;
    };
    return {
      command,
      evaluate,
      open,
      session,
      extensionOrigin,
      close: async () => {
        await command('browser.close').catch(() => {});
        socket.close();
        process.kill();
        await Promise.race([
          new Promise((resolve) => process.once('exit', resolve)),
          delay(2000),
        ]);
        await rm(profile, { recursive: true, force: true });
      },
    };
  } catch (error) {
    socket?.close();
    process.kill();
    await delay(500);
    await rm(profile, { recursive: true, force: true });
    throw error;
  }
}
