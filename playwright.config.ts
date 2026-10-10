import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

/** Usa el Chromium preinstalado si existe (CI sin descarga), si no el de Playwright. */
function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const root = '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const dir = readdirSync(root).find((d) => /^chromium-\d+$/.test(d));
  const bin = dir && `${root}/${dir}/chrome-linux/chrome`;
  return bin && existsSync(bin) ? bin : undefined;
}

const BASE = `http://localhost:4173${process.env.VITE_BASE_PATH ?? '/'}`;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE,
    locale: 'es-AR',
    acceptDownloads: true,
    launchOptions: { executablePath: chromiumPath() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // Siempre contra el BUILD DE PRODUCCIÓN con el base path real de GitHub Pages.
  webServer: { command: 'npm run preview', url: BASE, reuseExistingServer: true, timeout: 60_000 },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], launchOptions: { executablePath: chromiumPath() } } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 }, launchOptions: { executablePath: chromiumPath() } } },
  ],
});
