import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = new URL('../tests/fixtures/native/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/fixture.js', ['fixture.js', 'text/javascript; charset=utf-8']],
  ['/fixture.css', ['fixture.css', 'text/css; charset=utf-8']],
  ['/pattern.webm', ['pattern.webm', 'video/webm']],
  ['/captions.vtt', ['captions.vtt', 'text/vtt; charset=utf-8']],
  ['/replacement.vtt', ['replacement.vtt', 'text/vtt; charset=utf-8']],
]);

export async function startFixture() {
  const server = createServer((request, response) => {
    void (async () => {
      const route = files.get(
        new URL(request.url, 'http://127.0.0.1:4173').pathname,
      );
      if (!route || !['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(404);
        response.end();
        return;
      }
      const bytes = await readFile(new URL(route[0], root));
      const headers = {
        'Content-Type': route[1],
        'Cache-Control': 'no-store',
        'Accept-Ranges': 'bytes',
        'X-Content-Type-Options': 'nosniff',
      };
      if (request.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range);
        const start = match ? Number(match[1]) : NaN;
        const end = match?.[2]
          ? Math.min(Number(match[2]), bytes.length - 1)
          : bytes.length - 1;
        if (
          !Number.isSafeInteger(start) ||
          start < 0 ||
          start > end ||
          start >= bytes.length
        ) {
          response.writeHead(416, {
            'Content-Range': `bytes */${bytes.length}`,
          });
          response.end();
          return;
        }
        response.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': end - start + 1,
        });
        response.end(
          request.method === 'HEAD'
            ? undefined
            : bytes.subarray(start, end + 1),
        );
      } else {
        response.writeHead(200, { ...headers, 'Content-Length': bytes.length });
        response.end(request.method === 'HEAD' ? undefined : bytes);
      }
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(4173, '127.0.0.1', resolve);
  });
  return server;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const server = await startFixture();
  console.log(
    'Native caption fixture: http://127.0.0.1:4173 (loopback only). Ctrl+C to stop.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => server.close());
}
