// Prueba de ACTUALIZACIÓN del service worker (el problema histórico de caché).
// 1) Publica la versión A y la deja controlando la página (offline-ready).
// 2) "Despliega" la versión B en la misma URL.
// 3) Verifica que la app NO queda clavada en A: aparece el aviso, al tocar
//    "Actualizar" se carga B y las cachés viejas se eliminan.
// Uso: npm run test:sw
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.VITE_BASE_PATH ?? '/';
const TMP = '.sw-test';
rmSync(TMP, { recursive: true, force: true });
for (const v of ['A', 'B']) {
  execSync(`npx vite build --outDir ${TMP}/${v} --emptyOutDir`, { stdio: 'ignore', env: { ...process.env, APP_VERSION: `test-${v}` } });
}
let current = `${TMP}/A`;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(BASE)) return res.writeHead(404).end();
  let p = join(current, url.pathname.slice(BASE.length) || 'index.html');
  if (!existsSync(p) || p.endsWith('/')) p = join(current, 'index.html');
  res.writeHead(200, { 'Content-Type': types[extname(p)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(await readFile(p));
}).listen(4180);

const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage();
const url = `http://localhost:4180${BASE}#/mas`;
const version = () => page.locator('text=/Stock Manager vtest-/').innerText();
let failed = false;
const check = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) failed = true; };
try {
  await page.goto(url);
  // Primer uso: con la nube configurada se ofrece iniciar sesión; la prueba usa el modo local
  // y crea el usuario administrador para poder ver la app.
  const setup = page.getByRole('heading', { name: 'Crear usuario administrador' });
  const cloudLogin = page.getByRole('heading', { name: 'Iniciar sesión' });
  await setup.or(cloudLogin).first().waitFor();
  if (await cloudLogin.isVisible()) await page.getByRole('button', { name: 'Usar sólo en este dispositivo, sin nube' }).click();
  await setup.waitFor();
  await page.getByLabel('Tu nombre').fill('Admin');
  await page.getByLabel(/^PIN( ·|$)/).fill('1234');
  await page.getByLabel('Repetí el PIN').fill('1234');
  await page.getByRole('button', { name: 'Crear y entrar' }).click();
  await page.locator('main#contenido').waitFor();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  check((await version()).includes('test-A'), 'Versión A instalada y controlada por el SW');

  current = `${TMP}/B`; // nuevo deploy
  await page.reload();
  check((await version()).includes('test-A'), 'Tras el deploy sigue A (sin recargas inesperadas) hasta que el usuario acepte');
  await page.getByRole('button', { name: 'Actualizar' }).waitFor({ timeout: 20000 });
  check(true, 'Aparece el aviso "Hay una nueva versión disponible"');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Actualizar' }).click()]);
  await page.waitForSelector('text=/Stock Manager vtest-B/', { timeout: 20000 });
  check((await version()).includes('test-B'), 'Al tocar "Actualizar" se carga la versión B');
  const caches = await page.evaluate(async () => (await caches.keys()).length);
  const stale = await page.evaluate(async () => {
    const keys = await caches.keys();
    let n = 0;
    for (const k of keys) for (const r of await (await caches.open(k)).keys()) if (/index-.*\.js$/.test(r.url)) n++;
    return n;
  });
  check(stale === 1, `Una sola versión del bundle principal en caché (${caches} caché/s)`);
} finally {
  await browser.close();
  server.close();
  rmSync(TMP, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
