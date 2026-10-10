import { expect, test } from '@playwright/test';
import { go, open } from './helpers';

test('listas largas: se muestran de a tandas y la búsqueda encuentra todo', async ({ page }) => {
  await open(page);
  await page.evaluate(async () => {
    const urls = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/assets\/db-[^/]+\.js$/.test(n));
    let db: { products: { bulkAdd: (r: unknown[]) => Promise<unknown> } } | undefined;
    for (const u of urls) {
      const m = await import(u);
      for (const v of Object.values(m)) if (v && typeof v === 'object' && 'products' in v && 'movements' in v) db = v as typeof db;
    }
    const t = new Date().toISOString();
    await db!.products.bulkAdd(Array.from({ length: 300 }, (_, i) => ({
      id: crypto.randomUUID(), name: `Artículo ${String(i).padStart(3, '0')}`, alternativeSupplierIds: [], purchaseFactor: 1,
      stock: 5, minStock: 1, maxStock: 10, active: true, createdAt: t, updatedAt: t,
    })));
  });
  await go(page, '/productos');
  await expect(page.locator('table tbody tr:not(.group-row)')).toHaveCount(60);
  // "Mostrar más" (o el scroll automático) agrega otra tanda de 60.
  const more = page.getByRole('button', { name: /Mostrar más/ }).first();
  if (await more.isVisible()) await more.click({ timeout: 5000 }).catch(() => undefined);
  await expect.poll(() => page.locator('table tbody tr:not(.group-row)').count()).toBeGreaterThanOrEqual(120);
  await page.getByRole('searchbox').first().fill('Artículo 299');
  await expect(page.locator('table tbody tr:not(.group-row)')).toHaveCount(1);

  await go(page, '/stock');
  await expect(page.locator('article.pcard')).toHaveCount(60);
  await page.getByRole('searchbox').first().fill('Artículo 250');
  await expect(page.getByRole('article', { name: 'Artículo 250' })).toBeVisible();
});
