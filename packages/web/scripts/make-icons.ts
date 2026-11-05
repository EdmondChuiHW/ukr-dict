/** Renders public/icons/icon.svg to PNG icons with the installed Google Chrome (Playwright). node scripts/make-icons.ts */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const svg = await readFile(join(dir, 'icon.svg'), 'utf8');
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const render = async (size: number, file: string, maskable = false) => {
  await page.setViewportSize({ width: size, height: size });
  // Maskable: full-bleed background, logo inside the 80 % safe zone.
  const inner = maskable
    ? `<div style="width:${size}px;height:${size}px;background:#1f5fae;display:grid;place-items:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg}</div></div>`
    : `<div style="width:${size}px;height:${size}px">${svg}</div>`;
  await page.setContent(`<html><body style="margin:0;background:transparent">${inner}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
  await page.screenshot({ path: join(dir, file), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
};
await render(192, 'icon-192.png');
await render(512, 'icon-512.png');
await render(512, 'icon-maskable-512.png', true);
await browser.close();
console.log('icons written to', dir);
