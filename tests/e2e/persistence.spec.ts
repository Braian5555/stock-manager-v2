import { chromium, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { ensureSession } from './helpers';
import { join } from 'node:path';

/** Cierra el NAVEGADOR completo (perfil persistente en disco) y lo vuelve a abrir. */
test('11-12 · los datos sobreviven al cierre completo del navegador', async ({ browserName }, info) => {
  test.skip(browserName !== 'chromium' || info.project.name !== 'desktop', 'una sola corrida alcanza');
  const dir = mkdtempSync(join(tmpdir(), 'sm-profile-'));
  const opts = { baseURL: info.project.use.baseURL, executablePath: info.project.use.launchOptions?.executablePath };
  try {
    let ctx = await chromium.launchPersistentContext(dir, opts);
    let page = await ctx.newPage();
    await page.goto('./');
    await ensureSession(page);
    await page.getByRole('button', { name: 'Cargar datos de ejemplo' }).click();
    await expect(page.getByText('Datos de ejemplo cargados')).toBeVisible();
    await ctx.close();

    ctx = await chromium.launchPersistentContext(dir, opts);
    page = await ctx.newPage();
    await page.goto('./#/productos');
    await ensureSession(page); // la sesión sigue abierta: no pide PIN
    await expect(page.getByRole('heading', { name: '¿Quién sos?' })).toHaveCount(0);
    await expect(page.locator('td.cell-title', { hasText: 'Harina 000' })).toBeVisible();
    await expect(page.locator('tbody tr:not(.group-row)')).toHaveCount(15);
    await ctx.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
