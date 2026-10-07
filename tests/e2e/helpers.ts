import { expect, type Page } from '@playwright/test';

export async function open(page: Page, hash = '') {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`./${hash ? `#${hash}` : ''}`);
  await expect(page.locator('#root')).not.toBeEmpty();
  return errors;
}

export async function loadDemo(page: Page) {
  await open(page);
  await page.getByRole('button', { name: 'Cargar datos de ejemplo' }).click();
  await expect(page.getByText('Datos de ejemplo cargados')).toBeVisible();
}

export async function go(page: Page, hash: string) {
  await page.goto(`./#${hash}`);
  await expect(page).toHaveURL(new RegExp(`#${hash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  await expect(page.locator('main h1').first()).toBeVisible();
}

export const dialog = (page: Page) => page.getByRole('dialog');
