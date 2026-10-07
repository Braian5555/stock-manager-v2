// Verificación del build de producción. Falla (exit 1) si algo puede mostrar
// código como texto, romper rutas en GitHub Pages o dejar un SW mal configurado.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const BASE = process.env.VITE_BASE_PATH ?? '/stock-manager/';
const errors = [];
const ok = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => errors.push(m);

const html = readFileSync(join(DIST, 'index.html'), 'utf8');

// 1. El HTML no contiene código fuente sin compilar.
if (/src\/main\.tsx|\.tsx["']/.test(html)) fail('index.html referencia archivos .tsx (no compilado)');
const body = html.split(/<body[^>]*>/i)[1]?.split(/<\/body>/i)[0] ?? '';
const bodyText = body.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<noscript[\s\S]*?<\/noscript>/gi, '').replace(/<[^>]+>/g, '').trim();
if (bodyText.length > 0) fail(`El <body> tiene texto visible fuera de scripts: "${bodyText.slice(0, 80)}"`);
const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].filter((m) => m[1].trim());
if (inlineScripts.length) fail('index.html contiene scripts inline (riesgo de mostrar código y de CSP)');
const opens = (html.match(/<script\b/gi) ?? []).length;
const closes = (html.match(/<\/script>/gi) ?? []).length;
if (opens !== closes) fail(`Etiquetas <script> desbalanceadas (${opens} aperturas, ${closes} cierres)`);
else ok(`HTML limpio: ${opens} script(s) externos, sin código visible`);

// 2. Todas las rutas de assets respetan el base path y existen.
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|data:|#)/.test(u));
for (const r of refs) {
  if (!r.startsWith(BASE)) fail(`Ruta fuera del base path ${BASE}: ${r}`);
  else if (!existsSync(join(DIST, r.slice(BASE.length)))) fail(`Archivo referenciado inexistente: ${r}`);
}
if (!html.includes(`type="module"`)) fail('No hay script de módulo');
ok(`${refs.length} rutas de assets bajo ${BASE}`);

// 3. Los JS son JavaScript compilado (sin JSX ni anotaciones TS).
const assets = readdirSync(join(DIST, 'assets'));
for (const f of assets.filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join(DIST, 'assets', f), 'utf8');
  if (/^\s*import\s+type\s/m.test(src) || /<\/?[A-Z][A-Za-z]+[\s>]/.test(src.slice(0, 2000)) && /return\s*\(\s*</.test(src)) fail(`${f} parece contener JSX/TS sin compilar`);
}
ok(`${assets.filter((x) => x.endsWith('.js')).length} bundles JS compilados`);

// 4. Manifest PWA.
const manifest = JSON.parse(readFileSync(join(DIST, 'manifest.webmanifest'), 'utf8'));
if (manifest.start_url !== BASE || manifest.scope !== BASE) fail(`manifest start_url/scope deben ser ${BASE}`);
for (const i of manifest.icons ?? []) if (!existsSync(join(DIST, i.src))) fail(`Icono inexistente: ${i.src}`);
if (!(manifest.icons ?? []).some((i) => i.sizes === '512x512')) fail('Falta icono 512x512');
if (!html.includes(`${BASE}manifest.webmanifest`)) fail('index.html no enlaza el manifest');
ok(`manifest.webmanifest (scope ${manifest.scope}, ${manifest.icons.length} iconos)`);

// 5. Service worker.
const sw = readFileSync(join(DIST, 'sw.js'), 'utf8');
if (!sw.includes('index.html')) fail('El SW no precachea index.html');
if (!/cleanupOutdatedCaches/.test(sw)) fail('El SW no limpia caches antiguas');
if (/skipWaiting\(\)\s*[;,]?\s*self\.addEventListener\("install"/.test(sw)) fail('El SW hace skipWaiting automático');
const workbox = readdirSync(DIST).find((f) => /^workbox-.*\.js$/.test(f));
if (!workbox) fail('Falta runtime de Workbox');
ok('service worker con precache versionado y limpieza de caches');

// 6. Archivos de GitHub Pages.
if (!existsSync(join(DIST, '.nojekyll'))) fail('Falta .nojekyll');
const size = assets.reduce((a, f) => a + statSync(join(DIST, 'assets', f)).size, 0);
ok(`assets: ${(size / 1024).toFixed(0)} KB en total`);

if (errors.length) {
  console.error('\n✗ Verificación del build FALLÓ:\n' + errors.map((e) => `  - ${e}`).join('\n'));
  process.exit(1);
}
console.log('\n✓ Build verificado');
