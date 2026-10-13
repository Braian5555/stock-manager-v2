import { chromium, devices } from '@playwright/test';
import { go, loadDemo } from './helpers';
const routes = ['/', '/stock', '/productos', '/conteo', '/produccion', '/facturas', '/familias', '/unidades', '/ubicaciones', '/movimientos', '/exportar', '/integraciones', '/nube', '/usuarios', '/configuracion', '/configuracion/navegacion', '/configuracion/stock', '/configuracion/productos', '/configuracion/datos', '/configuracion/aplicacion', '/configuracion/diagnostico', '/ayuda', '/acerca', '/mas'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const [name, opts] of [['mobile', devices['Pixel 7']], ['desktop', { viewport: { width: 1280, height: 800 } }]] as const) {
  const ctx = await b.newContext({ ...opts, baseURL: 'http://localhost:4173/' });
  const page = await ctx.newPage();
  const errs: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text().slice(0, 200)}`); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await loadDemo(page);
  for (const r of routes) {
    await go(page, r);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 0) errs.push(`overflow ${overflow}px en ${r}`);
    const pv = await page.getByRole('group', { name: 'Vista' }).count();
    if (r === '/produccion' && pv) for (const v of ['Plan', 'Resumen', 'Recetas']) { await page.getByRole('group', { name: 'Vista' }).getByRole('button', { name: v }).click(); await page.waitForTimeout(200); const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); if (o > 0) errs.push(`overflow ${o}px en produccion/${v}`); }
  }
  console.log(name, JSON.stringify([...new Set(errs)], null, 1));
  await ctx.close();
}
await b.close();
