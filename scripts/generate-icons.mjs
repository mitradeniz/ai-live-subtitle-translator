import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
// The detailed mark is used from 48 px up; 16/32 px use a simplified drawing
// with thicker strokes so the toolbar icon stays legible.
const svg = await readFile(
  new URL('../assets/logo.svg', import.meta.url),
  'utf8',
);
const small = await readFile(
  new URL('../assets/logo-small.svg', import.meta.url),
  'utf8',
);
const destination = new URL('../public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({
  channel: 'chromium',
  headless: true,
  chromiumSandbox: true,
});
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;${size === 128 ? 'width:96px;height:96px;margin:16px' : 'width:100vw;height:100vh'}}</style>${size <= 32 ? small : svg}`,
    );
    await page.screenshot({
      path: new URL(`icon-${size}.png`, destination).pathname,
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
