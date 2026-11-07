import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

/** Va a una sección del Salón con el menú real: la barra lateral (compu) o la barra inferior / "Más" (celular). */
async function view(page: Page, name: string) {
  const side = page.getByRole('navigation', { name: 'Navegación: Salón' });
  if (await side.isVisible()) return side.getByRole('link', { name, exact: true }).click();
  const bottom = page.getByRole('navigation', { name: 'Navegación inferior' }).getByRole('link', { name, exact: true });
  if (await bottom.count()) return bottom.click();
  await page.getByRole('navigation', { name: 'Navegación inferior' }).getByRole('link', { name: 'Más' }).click();
  await page.getByRole('navigation', { name: 'Salón' }).getByRole('link', { name, exact: true }).click();
}

async function addMenuItem(page: Page, name: string, section: string, price: string, extras: [string, string][] = [], kitchen = true) {
  const m = dialog(page);
  await m.getByLabel('Nombre').fill(name);
  await m.getByLabel('Sección').fill(section);
  await m.getByLabel('Precio', { exact: true }).fill(price);
  await m.getByLabel('Va a la pantalla de cocina').setChecked(kitchen);
  for (const [i, [n, p]] of extras.entries()) {
    await m.getByRole('button', { name: 'Agregar adicional' }).click();
    await m.getByLabel(`Adicional ${i + 1}`, { exact: true }).fill(n);
    await m.getByLabel(`Precio del adicional ${i + 1}`).fill(p);
  }
}

test('salón tipo Fudo: caja, plano, adicionales, descuento, cuenta dividida, delivery y arqueo', async ({ page }) => {
  await loadDemo(page);
  // Desde el Inicio se entra al Salón con el menú grande.
  await go(page, '/');
  await page.getByRole('navigation', { name: 'Menú del Salón' }).getByRole('link', { name: /^Mesas/ }).click();
  await expect(page.getByRole('heading', { name: 'Mesas', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Área' }).first().getByRole('button', { name: 'Salón' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Cantidad de mesas').fill('4');
  await page.getByRole('button', { name: 'Crear mesas' }).click();

  // Carta con adicionales
  await view(page, 'Carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  await addMenuItem(page, 'Café con leche', 'Cafetería', '3000', [['Leche de almendras', '500']], false);
  await dialog(page).getByRole('button', { name: 'Guardar y otro' }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await addMenuItem(page, 'Desayuno americano', 'Desayunos', '9000');
  await dialog(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('1 adicional')).toBeVisible();

  // Abrir caja
  await view(page, 'Caja');
  await page.getByLabel('Efectivo inicial').fill('5000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByRole('heading', { name: /Caja #1 abierta/ })).toBeVisible();

  // Plano: mover una mesa
  await view(page, 'Mesas');
  const plan = page.getByRole('group', { name: 'Plano del salón' });
  await expect(plan.getByRole('button')).toHaveCount(4);
  await page.getByRole('button', { name: 'Editar plano' }).click();
  const t1 = plan.getByRole('button', { name: 'Mesa 1: Libre' });
  const before = await t1.getAttribute('style');
  const box = (await t1.boundingBox())!;
  const pbox = (await plan.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(pbox.x + pbox.width * 0.5, pbox.y + pbox.height * 0.7, { steps: 6 });
  await page.mouse.up();
  await expect(t1).not.toHaveAttribute('style', before!);
  await expect(page.getByRole('toolbar', { name: 'Editar mesa' })).toContainText('Mesa 1');
  await page.getByRole('button', { name: 'Redonda' }).click();
  await expect(t1).toHaveClass(/shape-redonda/);
  await page.getByRole('button', { name: 'Listo' }).click();

  // Mesa 2: adicional, descuento y cuenta dividida en 2
  await plan.getByRole('button', { name: 'Mesa 2: Libre' }).click();
  let m = dialog(page);
  await m.getByRole('button', { name: 'Agregar Café con leche' }).click();
  const extras = page.getByRole('dialog', { name: 'Café con leche' });
  await extras.getByLabel(/Leche de almendras/).check();
  await extras.getByRole('button', { name: /Agregar · \$\s?3\.500/ }).click();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  await m.getByRole('button', { name: 'Descuento' }).click();
  const disc = page.getByRole('dialog', { name: 'Descuento' });
  await disc.getByRole('button', { name: '10%' }).click();
  await disc.getByRole('button', { name: /^Aplicar/ }).click();
  await expect(page.getByText('Descuento aplicado')).toBeVisible();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await expect(m.getByRole('region', { name: 'Pedido' })).toContainText('Café con leche + Leche de almendras');
  await expect(m.locator('.salon-total')).toContainText(/19\.350/); // (3.500 + 18.000) − 10 %
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cobrar', exact: true }).first().click();

  let pay = page.getByRole('dialog', { name: 'Cobrar · Mesa 2' });
  await pay.getByRole('group', { name: 'Cómo se paga' }).getByRole('button', { name: 'Partes iguales' }).click();
  await expect(pay.getByText(/cobrando la 1 de 2/)).toBeVisible();
  await pay.getByLabel('Propina').fill('1000');
  await pay.getByRole('button', { name: /^Cobrar .*9\.675/ }).click();
  await expect(page.getByText(/Parte cobrada\. Faltan \$\s?9\.675/)).toBeVisible();
  await expect(pay.getByText(/cobrando la 2 de 2/)).toBeVisible();
  await pay.getByLabel('Medio de pago 1').selectOption('debito');
  await pay.getByRole('button', { name: /y cerrar$/ }).click();
  await expect(page.getByText('Mesa 2: cobrado y cerrado')).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Mesa 2: Libre' })).toBeVisible();

  // Delivery
  await view(page, 'Mostrador');
  await page.getByRole('button', { name: 'Nuevo · Delivery' }).click();
  m = page.getByRole('dialog', { name: 'Nuevo pedido · Delivery' });
  await m.getByLabel('Nombre').fill('Ana');
  await m.getByLabel('Dirección').fill('Mitre 123');
  await m.getByLabel('Envío (opcional)').fill('1500');
  await m.getByRole('button', { name: 'Empezar pedido' }).click();
  m = page.getByRole('dialog', { name: 'Delivery · Ana' });
  await expect(m.getByText('Entregar en: Mitre 123')).toBeVisible();
  await m.getByRole('button', { name: 'Agregar Desayuno americano' }).click();
  if (!(await m.getByRole('region', { name: 'Pedido' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: /^Pedido/ }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await m.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delivery · Ana: En cocina' })).toBeVisible();
  await view(page, 'Cocina');
  await expect(page.getByRole('listitem', { name: 'Delivery · Ana' })).toContainText('Desayuno americano');
  await view(page, 'Mostrador');
  await page.getByRole('button', { name: 'Delivery · Ana: En cocina' }).click();
  m = page.getByRole('dialog', { name: 'Delivery · Ana' });
  await m.getByRole('button', { name: 'Cobrar', exact: true }).click();
  pay = page.getByRole('dialog', { name: 'Cobrar · Delivery · Ana' });
  await pay.getByRole('button', { name: /^Cobrar .*10\.500,00 y cerrar$/ }).click();
  await expect(page.getByText('Delivery · Ana: cobrado y cerrado')).toBeVisible();

  // Caja: egreso y cierre con arqueo
  await view(page, 'Caja');
  await expect(page.getByText(/vendido \(3 cobros\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Egreso' }).click();
  m = page.getByRole('dialog', { name: 'Egreso de dinero' });
  await m.getByLabel('Importe').fill('2000');
  await m.getByRole('button', { name: 'Pago a proveedor' }).click();
  await m.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Egreso: Pago a proveedor')).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  m = page.getByRole('dialog', { name: 'Cerrar Caja #1' });
  // Efectivo esperado: 5.000 inicial + 9.675 + 1.000 propina + 10.500 − 2.000 = 24.175
  await expect(m.getByRole('row', { name: /Efectivo/ })).toContainText(/24\.175/);
  await m.getByLabel('Contado Efectivo').fill('24000');
  await m.getByLabel('Contado Débito').fill('9675');
  await expect(m.getByText(/Faltan \$\s?175/)).toBeVisible();
  await m.getByRole('button', { name: 'Cerrar caja' }).click();
  await page.getByRole('dialog', { name: 'Caja cerrada' }).getByRole('button', { name: 'Cancelar' }).click();
  await expect(page.getByRole('heading', { name: 'La caja está cerrada' })).toBeVisible();
  await expect(page.getByText(/Faltó \$\s?175/)).toBeVisible();
});

test('áreas: el Salón y el Stock tienen menús separados', async ({ page }) => {
  await loadDemo(page);
  await go(page, '/stock');
  const isDesktop = await page.getByRole('navigation', { name: 'Navegación principal' }).isVisible();
  if (isDesktop) {
    const side = page.getByRole('navigation', { name: 'Navegación principal' });
    await expect(side.getByRole('link', { name: 'Stock', exact: true })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Cocina' })).toHaveCount(0);
  }
  await page.getByRole('group', { name: 'Área' }).first().getByRole('button', { name: 'Salón' }).click();
  await expect(page.getByRole('heading', { name: 'Mesas', level: 1 })).toBeVisible();
  if (isDesktop) {
    const side = page.getByRole('navigation', { name: 'Navegación: Salón' });
    for (const n of ['Inicio', 'Mesas', 'Mostrador', 'Cocina', 'Caja', 'Carta', 'Ventas de hoy', 'Comprobantes', 'Configuración']) await expect(side.getByRole('link', { name: n, exact: true })).toBeVisible();
    await expect(side.getByRole('link', { name: 'Stock', exact: true })).toHaveCount(0);
    await side.getByRole('link', { name: 'Configuración', exact: true }).click();
  } else {
    const bottom = page.getByRole('navigation', { name: 'Navegación inferior' });
    for (const n of ['Inicio', 'Mesas', 'Mostrador', 'Cocina']) await expect(bottom.getByRole('link', { name: n, exact: true })).toBeVisible();
    await bottom.getByRole('link', { name: 'Más' }).click();
    await page.getByRole('navigation', { name: 'Salón' }).getByRole('link', { name: 'Configuración', exact: true }).click();
  }
  // Configuración del salón: lo del salón y lo general, sin lo del stock.
  await expect(page.getByRole('heading', { name: 'Configuración del salón', level: 1 })).toBeVisible();
  const row = (n: string) => page.locator('main .settings-card-title').getByText(n, { exact: true });
  for (const n of ['Facturación electrónica', 'Mesas, carta y caja', 'Impresión de tickets', 'Empresa y apariencia', 'Usuarios y permisos']) await expect(row(n)).toBeVisible();
  for (const n of ['Stock', 'Importar y exportar', 'Integraciones']) await expect(row(n)).toHaveCount(0);
  await row('Facturación electrónica').click();
  await expect(page.getByRole('heading', { name: 'Configuración fiscal' })).toBeVisible();
  // Volver al Stock.
  await page.getByRole('group', { name: 'Área' }).first().getByRole('button', { name: 'Stock' }).click();
  await expect(page).toHaveURL(/#\/$/);
  // Configuración del Stock: lo del stock y lo general, sin lo del salón.
  await go(page, '/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible();
  for (const n of ['Stock', 'Importar y exportar', 'Empresa y apariencia']) await expect(row(n)).toBeVisible();
  for (const n of ['Facturación electrónica', 'Mesas, carta y caja', 'Impresión de tickets']) await expect(row(n)).toHaveCount(0);
});
