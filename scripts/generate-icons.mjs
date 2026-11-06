// Genera los PNG de la PWA a partir del logo de Orillas (public/brand/orillas-logo.png) con Chromium.
// Uso: npm run icons   (si Playwright no encuentra su Chromium: CHROMIUM_PATH=/ruta/al/chrome npm run icons)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const logo = `data:image/png;base64,${readFileSync('public/brand/orillas-logo.png').toString('base64')}`;
const CREAM = '#f5f3ef';
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, inner: 1, bg: 'transparent' },
  { file: 'public/icons/icon-512.png', size: 512, inner: 1, bg: 'transparent' },
  { file: 'public/icons/maskable-512.png', size: 512, inner: 0.86, bg: CREAM }, // dentro de la zona segura
  { file: 'public/icons/apple-touch-icon.png', size: 180, inner: 1, bg: CREAM },
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const t of targets) {
  const inner = Math.round(t.size * t.inner);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;width:${t.size}px;height:${t.size}px;display:grid;place-items:center;background:${t.bg}">
    <img src="${logo}" width="${inner}" height="${inner}"></body></html>`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: t.file, omitBackground: t.bg === 'transparent' });
  console.log('✓', t.file);
}
await browser.close();
