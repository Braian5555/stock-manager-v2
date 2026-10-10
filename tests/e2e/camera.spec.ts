import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { code128Widths } from '../../src/utils/barcode';
import { go, loadDemo } from './helpers';

/** Video falso (Y4M) con un código Code 128 en el centro, para simular la cámara. */
function fakeVideo(path: string, text: string) {
  const W = 640, H = 480, scale = 4;
  const widths = code128Widths(text);
  const bars = new Uint8Array(W).fill(235);
  let x = Math.floor((W - widths.reduce((a, b) => a + b, 0) * scale) / 2);
  widths.forEach((w, i) => { if (i % 2 === 0) bars.fill(16, x, x + w * scale); x += w * scale; });
  const y = Buffer.alloc(W * H, 235);
  for (let r = 140; r < 340; r++) y.set(bars, r * W);
  const uv = Buffer.alloc(W * H / 2, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${W} H${H} F15:1 Ip A1:1 C420jpeg\n`)];
  for (let f = 0; f < 20; f++) parts.push(Buffer.from('FRAME\n'), y, uv);
  writeFileSync(path, Buffer.concat(parts));
}

test('cámara: lee el código del video (lector alternativo, el mismo que usa iPhone)', async ({ baseURL }, info) => {
  test.skip(info.project.name !== 'desktop', 'una sola vez alcanza');
  // Ruta sin acentos: Chromium no abre el video falso si la ruta tiene caracteres no ASCII.
  const video = join(mkdtempSync(join(tmpdir(), 'sm-cam-')), 'code.y4m');
  fakeVideo(video, 'SM000123');
  const browser = await chromium.launch({
    executablePath: info.project.use.launchOptions?.executablePath,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  try {
    const ctx = await browser.newContext({ baseURL, permissions: ['camera'] });
    const page = await ctx.newPage();
    await loadDemo(page);
    await go(page, '/stock');
    await page.getByRole('button', { name: 'Escanear' }).click();
    // Con el permiso ya concedido la cámara arranca sola y encuentra el código.
    await expect(page.getByRole('heading', { name: 'Código no encontrado' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('dialog').last().locator('strong.num')).toHaveText('SM000123');
  } finally {
    await browser.close();
  }
});
