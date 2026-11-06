import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo } from './helpers';

const tabs = (page: Page) => page.getByRole('group', { name: 'Sección del salón' });

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
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('4');
  await page.getByRole('button', { name: 'Crear mesas' }).click();

  // Carta con adicionales
  await tabs(page).getByRole('button', { name: 'Carta' }).click();
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  await addMenuItem(page, 'Café con leche', 'Cafetería', '3000', [['Leche de almendras', '500']], false);
  await dialog(page).getByRole('button', { name: 'Guardar y otro' }).click();
  await expect(page.getByText('Agregado a la carta')).toBeVisible();
  await addMenuItem(page, 'Desayuno americano', 'Desayunos', '9000');
  await dialog(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText('1 adicional')).toBeVisible();

  // Abrir caja
  await tabs(page).getByRole('button', { name: 'Caja (cerrada)' }).click();
  await page.getByLabel('Efectivo inicial').fill('5000');
  await page.getByRole('button', { name: 'Abrir caja' }).click();
  await expect(page.getByText('Caja #1 abierta')).toBeVisible();

  // Plano: mover una mesa
  await tabs(page).getByRole('button', { name: 'Mesas' }).click();
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
  await tabs(page).getByRole('button', { name: /^Mostrador/ }).click();
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
  await go(page, '/cocina');
  await expect(page.getByRole('listitem', { name: 'Delivery · Ana' })).toContainText('Desayuno americano');
  await go(page, '/salon');
  await tabs(page).getByRole('button', { name: /^Mostrador/ }).click();
  await page.getByRole('button', { name: 'Delivery · Ana: En cocina' }).click();
  m = page.getByRole('dialog', { name: 'Delivery · Ana' });
  await m.getByRole('button', { name: 'Cobrar', exact: true }).click();
  pay = page.getByRole('dialog', { name: 'Cobrar · Delivery · Ana' });
  await pay.getByRole('button', { name: /^Cobrar .*10\.500,00 y cerrar$/ }).click();
  await expect(page.getByText('Delivery · Ana: cobrado y cerrado')).toBeVisible();

  // Caja: egreso y cierre con arqueo
  await tabs(page).getByRole('button', { name: 'Caja' }).click();
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
  await expect(page.getByText('La caja está cerrada')).toBeVisible();
  await expect(page.getByText(/Faltó \$\s?175/)).toBeVisible();
});
