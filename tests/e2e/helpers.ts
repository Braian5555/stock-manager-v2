import { expect, type Page } from '@playwright/test';

export const ADMIN = { name: 'Admin Prueba', pin: '1234' };

/**
 * Si la app muestra "Crear usuario administrador" (base vacía) lo crea; si muestra
 * la pantalla de bloqueo, entra con el administrador de prueba.
 */
export async function ensureSession(page: Page) {
  const setup = page.getByRole('heading', { name: 'Crear usuario administrador' });
  const cloudLogin = page.getByRole('heading', { name: 'Iniciar sesión' });
  const lock = page.locator('.pinpad, .user-grid');
  const app = page.locator('main#contenido');
  await expect(setup.or(cloudLogin).or(lock).or(app).first()).toBeVisible();
  // Con la nube configurada, un dispositivo nuevo ofrece iniciar sesión: las pruebas
  // generales usan el modo local.
  if (await cloudLogin.isVisible()) {
    await page.getByRole('button', { name: 'Usar sólo en este dispositivo, sin nube' }).click();
    await expect(setup).toBeVisible();
  }
  if (await setup.isVisible()) {
    await page.getByLabel('Tu nombre').fill(ADMIN.name);
    await page.getByLabel(/^PIN( ·|$)/).fill(ADMIN.pin);
    await page.getByLabel('Repetí el PIN').fill(ADMIN.pin);
    await page.getByRole('button', { name: 'Crear y entrar' }).click();
  } else if (await lock.first().isVisible()) {
    await login(page, ADMIN.name, ADMIN.pin);
  }
  await expect(app).toBeVisible();
}

export async function login(page: Page, name: string, pin: string) {
  await expect(page.locator('.pinpad, .user-grid').first()).toBeVisible();
  const tile = page.locator('.user-tile', { hasText: name });
  if (await tile.isVisible()) await tile.click();
  for (const d of pin) await page.getByRole('button', { name: `Número ${d}` }).click();
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.locator('main#contenido')).toBeVisible();
}

export async function open(page: Page, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./${hash ? `#${hash}` : ''}`);
  await expect(page.locator('#root')).not.toBeEmpty();
  await ensureSession(page);
  return errors;
}

export async function loadDemo(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'Cargar datos de ejemplo' }).click();
  await expect(page.getByText('Datos de ejemplo cargados')).toBeVisible();
}

export async function go(page: Page, hash: string) {
  await page.goto(`./#${hash}`);
  await ensureSession(page);
  await expect(page).toHaveURL(new RegExp(`#${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('main h1').first()).toBeVisible();
}

export const dialog = (page: Page) => page.getByRole('dialog');
