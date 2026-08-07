// Dev-only screenshot harness. Not part of the app or the gh-pages build.
//
// 1) npm install && npm run install:browsers   (once)
// 2) npm run shot
//
// Serves the repo root, opens the app with ?synthetic=1 (charts render from a
// built-in waveform, no mic/permission needed), and captures desktop + Samsung
// mobile PNGs into ./shots/.

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const root = resolve(import.meta.dirname, '..', '..');
const shotsDir = join(import.meta.dirname, 'shots');
mkdirSync(shotsDir, { recursive: true });

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/') pathname = '/index.html';
    const data = await readFile(join(root, pathname));
    res.writeHead(200, { 'Content-Type': mime[extname(pathname)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end();
  }
});

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const SAMSUNG_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

async function shoot(browser, viewport, userAgent, tag) {
  // deviceScaleFactor: 1 so the captured resolution matches the viewport size.
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, userAgent });
  const page = await context.newPage();
  await page.goto('http://localhost:8000/?synthetic=1', { waitUntil: 'networkidle' });
  // Let the spectrogram history fill a few frames.
  await page.waitForTimeout(2500);

  const s = (name) => join(shotsDir, `${tag}_${name}.png`);
  await page.screenshot({ path: s('overview'), fullPage: true });
  await page.locator('.canvas-container[data-fs-key="spec"]').screenshot({ path: s('freq_spec') });
  await page.locator('.canvas-container[data-fs-key="specgram"]').screenshot({ path: s('spectrum') });
  await context.close();
}

await new Promise((r) => server.listen(8000, r));

const browser = await chromium.launch();
try {
  await shoot(browser, { width: 1440, height: 900 }, CHROME_UA, 'desktop');
  await shoot(browser, { width: 412, height: 915 }, SAMSUNG_UA, 'mobile');
  console.log('Shots written to ' + shotsDir);
} finally {
  await browser.close();
  server.close();
}