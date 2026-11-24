import { expect, test, type Page } from '@playwright/test';
import { dialog, go, loadDemo, login } from './helpers';

/** Mesas y una carta mínima (un café que no va a cocina y una milanesa que sí). */
async function setupSalon(page: Page) {
  await go(page, '/salon');
  await page.getByLabel('Cantidad de mesas').fill('3');
  await page.getByRole('button', { name: 'Crear mesas' }).click();
  await go(page, '/salon?vista=carta');
  await page.getByRole('button', { name: 'Agregar el primero' }).click();
  for (const [name, section, price, kitchen] of [['Café', 'Cafetería', '3000', false], ['Milanesa', 'Platos', '12000', true]] as const) {
    const m = dialog(page);
    await m.getByLabel('Nombre').fill(name);
    await m.getByLabel('Sección').fill(section);
    await m.getByLabel('Precio', { exact: true }).fill(price);
    await m.getByLabel('Va a la pantalla de cocina').setChecked(kitchen);
    await m.getByRole('button', { name: kitchen ? 'Guardar' : 'Guardar y otro', exact: true }).click();
  }
  await expect(page.getByText('Milanesa')).toBeVisible();
  await go(page, '/salon?vista=mesas');
  // Las pruebas usan la vista de lista (en el plano las mesas se mueven).
  await page.getByRole('group', { name: 'Vista de mesas' }).getByRole('button', { name: 'Lista' }).click();
}

const carta = async (m: ReturnType<typeof dialog>) => {
  if (!(await m.getByRole('region', { name: 'Carta' }).isVisible())) await m.getByRole('group', { name: 'Ver' }).getByRole('button', { name: 'Agregar' }).click();
};

test('varias cuentas en una mesa, mozo a cargo y aviso de cocina al mozo', async ({ page }) => {
  await loadDemo(page);
  await setupSalon(page);

  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  let m = dialog(page);
  await expect(m.getByRole('button', { name: /^Mozo: Admin Prueba/ })).toContainText('(vos)');
  await m.getByRole('button', { name: 'Agregar Café' }).click();

  // Otra cuenta en la misma mesa
  await m.getByRole('button', { name: 'Otra cuenta en la mesa' }).click();
  await expect(page.getByText('Cuenta nueva en la mesa')).toBeVisible();
  m = page.getByRole('dialog', { name: 'Mesa 1 · Cuenta 2' });
  await expect(m.getByRole('group', { name: 'Cuentas de la mesa 1' }).getByRole('button')).toHaveCount(2);
  await carta(m);
  await m.getByRole('button', { name: 'Agregar Milanesa' }).click();
  await m.getByRole('button', { name: /^Mandar a cocina/ }).click();
  await expect(page.getByText(/Comanda mandada/)).toBeVisible();
  await m.getByRole('button', { name: 'Nombre de la cuenta' }).click();
  await page.getByRole('dialog', { name: 'Nombre de la cuenta' }).getByLabel(/^Nombre/).fill('Juan');
  await page.getByRole('dialog', { name: 'Nombre de la cuenta' }).getByRole('button', { name: 'Guardar' }).click();
  m = page.getByRole('dialog', { name: 'Mesa 1 · Juan' });
  await expect(m).toBeVisible();
  await page.screenshot({ path: 'test-results/salon-varias-cuentas.png' });
  await page.keyboard.press('Escape');

  // La mesa muestra las dos cuentas y, al tocarla, se elige cuál abrir.
  await expect(page.getByRole('button', { name: /^Mesa 1: / })).toContainText('2 cuentas');
  await page.getByRole('button', { name: /^Mesa 1: / }).click();
  const pick = page.getByRole('dialog', { name: 'Mesa 1 · 2 cuentas' });
  await expect(pick.getByRole('button', { name: /^Abrir Mesa 1 · / })).toHaveCount(2);
  await pick.getByRole('button', { name: 'Abrir Mesa 1 · Cuenta 1' }).click();
  await expect(page.getByRole('dialog', { name: 'Mesa 1 · Cuenta 1' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Cocina: la comanda dice de qué cuenta es y quién es el mozo; el sonido se puede apagar.
  await go(page, '/cocina');
  const card = page.getByRole('listitem', { name: 'Mesa 1 · Juan' });
  await expect(card).toContainText('Mozo: Admin Prueba');
  await expect(page.getByRole('button', { name: 'Sonido activado' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Sonido activado' }).click();
  await expect(page.getByRole('button', { name: 'Sin sonido' })).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: 'Todo listo' }).click();

  // El mozo ve resaltado que lo suyo está listo.
  await go(page, '/salon?vista=mesas');
  await expect(page.locator('.salon-ready-mine')).toContainText('Tus mesas, listo para llevar: mesa 1 · Juan');
});

test('otro mozo necesita el PIN del mozo de la mesa (o de un encargado) para tocarla', async ({ page, isMobile }) => {
  await loadDemo(page);
  // Un mozo
  await go(page, '/usuarios');
  await page.getByRole('button', { name: 'Nuevo usuario' }).click();
  const u = dialog(page);
  await u.getByLabel('Nombre').fill('Beto');
  await u.getByLabel(/^PIN( ·|$)/).fill('2468');
  await u.getByLabel('Repetí el PIN').fill('2468');
  await u.getByLabel('Rol').selectOption('waiter');
  await u.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Beto')).toBeVisible();

  await setupSalon(page);
  await page.getByRole('button', { name: 'Mesa 1: Libre' }).click();
  await dialog(page).getByRole('button', { name: 'Agregar Café' }).click();
  await page.keyboard.press('Escape');

  // Entra Beto: la mesa es del administrador.
  await page.goto('./#/mas');
  await page.getByRole('button', { name: 'Bloquear / cambiar usuario' }).click();
  await login(page, 'Beto', '2468');
  await page.goto('./#/salon');
  if (await page.getByRole('group', { name: 'Vista de mesas' }).getByRole('button', { name: 'Lista' }).getAttribute('aria-pressed') !== 'true')
    await page.getByRole('group', { name: 'Vista de mesas' }).getByRole('button', { name: 'Lista' }).click();
  await expect(page.getByRole('button', { name: /^Mesa 1: / })).toContainText('Admin Prueba');
  await page.getByRole('button', { name: /^Mesa 1: / }).click();
  const m = dialog(page).first();
  await expect(m.getByText(/Esta mesa es de/)).toBeVisible();
  await expect(m.getByRole('button', { name: /^Mandar a cocina/ })).toBeDisabled();
  await page.screenshot({ path: 'test-results/salon-mesa-de-otro.png' });

  // PIN equivocado, después el del mozo de la mesa.
  await m.getByRole('button', { name: 'Autorizar' }).click();
  const pin = page.getByRole('dialog', { name: 'Autorizar' });
  await pin.getByLabel('PIN').fill('0000');
  await pin.getByRole('button', { name: 'Autorizar' }).click();
  await expect(pin.getByRole('alert')).toHaveText('PIN incorrecto.');
  await pin.getByLabel('PIN').fill('1234');
  await pin.getByRole('button', { name: 'Autorizar' }).click();
  await expect(page.getByText('Autorizado: podés tocar esta mesa')).toBeVisible();
  await expect(m.getByText(/Esta mesa es de/)).toHaveCount(0);

  // Y se la puede pasar.
  await m.getByRole('button', { name: /^Mozo: Admin Prueba/ }).click();
  await page.getByRole('dialog', { name: /^Mozo de Mesa 1/ }).getByRole('button', { name: 'Pasármela a mí (Beto)' }).click();
  await expect(m.getByRole('button', { name: /^Mozo: Beto\./ })).toContainText('Beto (vos)');
  test.info().annotations.push({ type: 'device', description: isMobile ? 'celular' : 'compu' });
});
