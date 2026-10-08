// Genera los PNG de la PWA a partir de public/favicon.svg usando Chromium (Playwright).
// Uso: npm run icons
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/favicon.svg', 'utf8');
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, pad: 0, round: true },
  { file: 'public/icons/icon-512.png', size: 512, pad: 0, round: true },
  { file: 'public/icons/maskable-512.png', size: 512, pad: 0.2, round: false },
  { file: 'public/icons/apple-touch-icon.png', size: 180, pad: 0.12, round: false },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2));
  const glyph = t.round ? svg : svg.replace(/<rect[^>]*\/>/, '');
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;width:${t.size}px;height:${t.size}px;display:grid;place-items:center;background:${t.round ? 'transparent' : 'linear-gradient(135deg,#0d9488,#115e59)'}">
    <div style="width:${inner}px;height:${inner}px">${glyph.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`);
  await page.screenshot({ path: t.file, omitBackground: t.round });
  console.log('✓', t.file);
}
await browser.close();
