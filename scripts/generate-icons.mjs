import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
const svg = await readFile(
  new URL('../assets/logo.svg', import.meta.url),
  'utf8',
);
const destination = new URL('../public/icons/', import.meta.url);
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>${svg}`,
    );
    await page.screenshot({
      path: new URL(`icon-${size}.png`, destination).pathname,
      omitBackground: true,
    });
  }
} finally {
  await browser.close();
}
