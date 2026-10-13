import { db } from '../database/db';
import type { Product, StockMovement } from '../models';
import { foldStock, recomputeStock } from './stockService';
import { productionFamilyIds } from './bakeryService';
import { normalizeSettings, SETTINGS_ID } from './settingsService';
import { fmtDateTime, round3 } from '../utils/format';

/**
 * Autodiagnóstico: revisa los datos, la sincronización y los errores que tuvo la app, y arma
 * un informe para pegarle a Claude. No cambia nada salvo las correcciones seguras que se
 * piden explícitamente (recalcular stock desde los movimientos).
 */

// ───────────── Registro de errores ─────────────

const LOG_KEY = 'sm:error-log';
const LOG_MAX = 40;

export interface LoggedError { at: string; message: string; stack?: string; path: string; version: string; /** 'aviso': error que la app mostró en pantalla (p. ej. un dato inválido). */ kind?: 'aviso' }

/** Si el navegador no deja guardar (modo privado estricto), el registro vive en memoria. */
let memLog: LoggedError[] = [];
const store = () => (typeof localStorage !== 'undefined' ? localStorage : undefined);

export function readErrorLog(): LoggedError[] {
  try {
    const raw = store()?.getItem(LOG_KEY);
    if (raw == null) return memLog;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return memLog;
  }
}

export function clearErrorLog() {
  memLog = [];
  try {
    store()?.removeItem(LOG_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

export function logError(err: unknown, kind?: 'aviso') {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err ?? 'Error desconocido'));
  const entry: LoggedError = {
    at: new Date().toISOString(),
    message: String(e.message || e.name).slice(0, 300),
    stack: e.stack?.split('\n').slice(0, 6).join('\n').slice(0, 900),
    path: (typeof location !== 'undefined' && location.hash) || '/',
    version: __APP_VERSION__,
    ...(kind ? { kind } : {}),
  };
  const log = readErrorLog();
  // El mismo error repetido seguido no llena el registro.
  if (log[0]?.message === entry.message && Date.now() - Date.parse(log[0].at) < 5_000) return;
  memLog = [entry, ...log].slice(0, LOG_MAX);
  try {
    store()?.setItem(LOG_KEY, JSON.stringify(memLog));
  } catch {
    /* sin almacenamiento: queda en memoria */
  }
}

let installed = false;
/** Se llama una vez al abrir la app: guarda los errores que no se atraparon. */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => {
    // Errores de carga de recursos (imágenes) no interesan.
    if (!(ev.error instanceof Error) && !ev.message) return;
    logError(ev.error ?? ev.message);
  });
  window.addEventListener('unhandledrejection', (ev) => logError(ev.reason));
}

// ───────────── Revisiones ─────────────

export type Level = 'ok' | 'info' | 'warn' | 'error';

export interface Check {
  id: string;
  title: string;
  level: Level;
  summary: string;
  /** Hasta 15 ejemplos concretos. */
  items?: string[];
  /** Cuántos casos hay en total (puede ser más que los ejemplos). */
  count?: number;
  /** Hay una corrección segura que la app puede hacer sola. */
  fix?: 'recompute-stock' | 'count-negatives';
  /** Productos afectados (para la corrección). */
  productIds?: string[];
}

export interface CloudInfo {
  phase: string;
  provider?: string;
  workspace?: string;
  syncState?: string;
  pending?: number;
  lastSyncAt?: string;
  error?: string;
}

export interface DiagnosticReport {
  at: string;
  version: string;
  env: Record<string, string | number | boolean | undefined>;
  cloud: CloudInfo;
  counts: Record<string, number>;
  checks: Check[];
  errors: LoggedError[];
}

const SAMPLE = 15;
const sample = (xs: string[]) => xs.slice(0, SAMPLE);
const ok = (id: string, title: string, summary: string): Check => ({ id, title, level: 'ok', summary });
const nameOf = (p?: Pick<Product, 'name'>) => p?.name ?? '(sin nombre)';

/** Productos cuyo stock guardado no coincide con lo que dicen sus movimientos. */
export function stockMismatches(products: Product[], movements: StockMovement[]) {
  const byProduct = new Map<string, StockMovement[]>();
  for (const m of movements) if (!m.outletId) (byProduct.get(m.productId) ?? byProduct.set(m.productId, []).get(m.productId)!).push(m);
  const out: { product: Product; expected: number }[] = [];
  for (const p of products) {
    const ms = byProduct.get(p.id);
    if (!ms?.length) continue;
    const expected = foldStock(ms);
    if (expected !== undefined && Math.abs(round3(expected) - round3(p.stock)) > 0.0005) out.push({ product: p, expected });
  }
  return out;
}

export async function runDiagnostics(cloud: CloudInfo): Promise<DiagnosticReport> {
  const [products, movements, categories, units, locations, users, syncJobs, rawSettings] = await Promise.all([
    db.products.toArray(),
    db.movements.toArray(),
    db.categories.toArray(),
    db.units.toArray(),
    db.locations.toArray(),
    db.users.toArray(),
    db.syncJobs.toArray(),
    db.settings.get(SETTINGS_ID),
  ]);
  const settings = normalizeSettings(rawSettings);
  const checks: Check[] = [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const active = products.filter((p) => p.active);

  // 1. Stock vs movimientos
  const mism = stockMismatches(products, movements);
  checks.push(
    mism.length
      ? { id: 'stock-mismatch', title: 'Stock que no coincide con los movimientos', level: 'error', count: mism.length, fix: 'recompute-stock',
          summary: `${mism.length} productos tienen un stock distinto al que da su historial de movimientos.`,
          items: sample(mism.map((x) => `${nameOf(x.product)}: guardado ${x.product.stock}, según movimientos ${x.expected}`)) }
      : ok('stock-mismatch', 'Stock vs movimientos', 'El stock de todos los productos coincide con su historial.'),
  );

  // 2. Stock negativo. Casi siempre son insumos que nunca se contaron: las recetas los
  // descuentan al anotar producción y quedan por debajo de cero.
  const neg = active.filter((p) => p.stock < 0);
  const loaded = new Set(movements.filter((m) => m.type === 'ingreso' || m.type === 'conteo' || m.type === 'devolucion' || (m.absolute && m.quantityAfter > 0) || (m.type === 'ajuste' && m.delta > 0 && m.origin !== 'deshacer')).map((m) => m.productId));
  const byRecipe = new Set(movements.filter((m) => m.type === 'consumo').map((m) => m.productId));
  const never = neg.filter((p) => !loaded.has(p.id));
  checks.push(
    neg.length
      ? { id: 'negative-stock', title: 'Stock negativo', level: 'warn', count: neg.length, fix: 'count-negatives', productIds: neg.map((p) => p.id),
          summary: `${neg.length} productos activos tienen stock negativo. ${never.length} nunca tuvieron stock cargado${never.filter((p) => byRecipe.has(p.id)).length ? ' y se descontaron por recetas al anotar producción' : ''}. Se arregla contándolos: “Contar estos productos” arma un conteo sólo con ellos.`,
          items: sample(neg.map((p) => `${nameOf(p)}: ${p.stock}${loaded.has(p.id) ? '' : ' (nunca se cargó stock)'}`)) }
      : ok('negative-stock', 'Stock negativo', 'Ningún producto activo tiene stock negativo.'),
  );

  // 3. Referencias rotas (familia, unidad, ubicación)
  const cat = new Set(categories.map((c) => c.id));
  const uni = new Set(units.map((u) => u.id));
  const loc = new Set(locations.map((l) => l.id));
  const broken: string[] = [];
  for (const p of products) {
    if (p.categoryId && !cat.has(p.categoryId)) broken.push(`${nameOf(p)}: familia inexistente (${p.categoryId})`);
    if (p.unitId && !uni.has(p.unitId)) broken.push(`${nameOf(p)}: unidad inexistente (${p.unitId})`);
    if (p.locationId && !loc.has(p.locationId)) broken.push(`${nameOf(p)}: ubicación inexistente (${p.locationId})`);
  }
  checks.push(
    broken.length
      ? { id: 'broken-refs', title: 'Familias, unidades o ubicaciones borradas', level: 'warn', count: broken.length, summary: `${broken.length} referencias apuntan a algo que ya no existe.`, items: sample(broken) }
      : ok('broken-refs', 'Referencias del catálogo', 'Todas las familias, unidades y ubicaciones de los productos existen.'),
  );

  // 4. Sin familia / sin unidad
  const noCat = active.filter((p) => !p.categoryId);
  const noUnit = active.filter((p) => !p.unitId);
  checks.push(
    noCat.length || noUnit.length
      ? { id: 'missing-fields', title: 'Productos sin familia o sin unidad', level: 'info', count: noCat.length + noUnit.length,
          summary: `${noCat.length} sin familia y ${noUnit.length} sin unidad.`,
          items: sample([...noCat.map((p) => `${nameOf(p)}: sin familia`), ...noUnit.map((p) => `${nameOf(p)}: sin unidad`)]) }
      : ok('missing-fields', 'Familia y unidad', 'Todos los productos activos tienen familia y unidad.'),
  );

  // 5. Códigos de barras repetidos
  const codes = new Map<string, Product[]>();
  for (const p of active) for (const c of [p.barcode, p.sku].filter(Boolean) as string[]) {
    const k = c.trim().toLowerCase();
    if (k) (codes.get(k) ?? codes.set(k, []).get(k)!).push(p);
  }
  const dupCodes = [...codes.entries()].filter(([, ps]) => new Set(ps.map((p) => p.id)).size > 1);
  checks.push(
    dupCodes.length
      ? { id: 'dup-codes', title: 'Códigos repetidos', level: 'error', count: dupCodes.length, summary: `${dupCodes.length} códigos (de barras o SKU) los usan dos o más productos: el escáner no sabe cuál es.`,
          items: sample(dupCodes.map(([c, ps]) => `${c}: ${[...new Set(ps.map(nameOf))].join(', ')}`)) }
      : ok('dup-codes', 'Códigos únicos', 'No hay códigos de barras ni SKU repetidos.'),
  );

  // 6. Nombres repetidos
  const names = new Map<string, Product[]>();
  for (const p of active) {
    const k = p.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    (names.get(k) ?? names.set(k, []).get(k)!).push(p);
  }
  const dupNames = [...names.values()].filter((ps) => ps.length > 1);
  checks.push(
    dupNames.length
      ? { id: 'dup-names', title: 'Productos con el mismo nombre', level: 'warn', count: dupNames.length, summary: `${dupNames.length} nombres se repiten entre productos activos (posibles duplicados).`,
          items: sample(dupNames.map((ps) => `${ps[0].name} ×${ps.length}`)) }
      : ok('dup-names', 'Nombres únicos', 'No hay productos activos con el mismo nombre.'),
  );

  // 7. Recetas
  const recipeIssues: string[] = [];
  for (const p of products) {
    const r = p.recipe;
    if (!r?.items.length) continue;
    if (!(r.yield > 0)) recipeIssues.push(`${nameOf(p)}: rinde ${r.yield} (debe ser mayor a 0)`);
    for (const i of r.items) {
      const ing = byId.get(i.productId);
      if (!ing) recipeIssues.push(`${nameOf(p)}: usa un insumo que ya no existe (${i.productId})`);
      else if (!ing.active) recipeIssues.push(`${nameOf(p)}: usa "${ing.name}", que está desactivado`);
      if (i.productId === p.id) recipeIssues.push(`${nameOf(p)}: se usa a sí mismo como insumo`);
      if (!(i.quantity > 0)) recipeIssues.push(`${nameOf(p)}: cantidad ${i.quantity} de ${nameOf(ing)}`);
    }
  }
  checks.push(
    recipeIssues.length
      ? { id: 'recipes', title: 'Recetas con problemas', level: 'warn', count: recipeIssues.length, summary: `${recipeIssues.length} problemas en recetas: al anotar producción se descontaría mal.`, items: sample(recipeIssues) }
      : ok('recipes', 'Recetas', `${products.filter((p) => p.recipe?.items.length).length} recetas revisadas, sin problemas.`),
  );

  // 8. Familias de producción
  const famIds = productionFamilyIds(settings, categories);
  const staleFam = (settings.productionCategoryIds ?? []).filter((id) => !cat.has(id));
  checks.push(
    !famIds.size
      ? { id: 'production-families', title: 'Familias de Producción', level: 'warn', summary: 'Ninguna familia coincide con panadería/pastelería y no hay familias elegidas: Producción muestra todos los productos.' }
      : staleFam.length
        ? { id: 'production-families', title: 'Familias de Producción', level: 'info', count: staleFam.length, summary: `${staleFam.length} familias elegidas para Producción ya no existen (se ignoran).` }
        : ok('production-families', 'Familias de Producción', `${famIds.size} familias: ${categories.filter((c) => famIds.has(c.id)).map((c) => c.name).join(', ')}.`),
  );

  // 9. Movimientos huérfanos y fechas raras
  const orphan = movements.filter((m) => !byId.has(m.productId));
  const future = movements.filter((m) => Date.parse(m.createdAt) > Date.now() + 86_400_000);
  const badNum = movements.filter((m) => !Number.isFinite(m.delta) || !Number.isFinite(m.quantityAfter));
  const movIssues = [
    ...badNum.map((m) => `Movimiento ${m.id} (${m.productName ?? m.productId}): cantidad inválida`),
    ...future.map((m) => `Movimiento ${m.id} (${m.productName ?? m.productId}): fecha futura ${m.createdAt}`),
    ...[...orphan.reduce((g, m) => g.set(m.productId, [...(g.get(m.productId) ?? []), m]), new Map<string, StockMovement[]>()).entries()].map(([id, ms]) => {
      const last = ms.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));
      return `${ms[0].productName ?? `Producto borrado ${id.slice(0, 8)}`}: ${ms.length} ${ms.length === 1 ? 'movimiento' : 'movimientos'} (último ${fmtDateTime(last.createdAt)}, ${last.type} ${last.delta})`;
    }),
  ];
  checks.push(
    badNum.length || future.length
      ? { id: 'movements', title: 'Movimientos con datos inválidos', level: 'error', count: badNum.length + future.length, summary: `${badNum.length} con cantidad inválida y ${future.length} con fecha futura (reloj del dispositivo mal configurado).`, items: sample(movIssues) }
      : orphan.length
        ? { id: 'movements', title: 'Movimientos de productos borrados', level: 'info', count: orphan.length, summary: `${orphan.length} movimientos son de ${new Set(orphan.map((m) => m.productId)).size} productos que ya no existen (queda la historia; no afecta el stock ni los informes).`, items: sample(movIssues) }
        : ok('movements', 'Movimientos', `${movements.length} movimientos revisados, sin problemas.`),
  );

  // 10. Usuarios
  const activeUsers = users.filter((u) => u.active);
  const admins = activeUsers.filter((u) => u.role === 'admin' || (u.role === 'custom' && u.permissions?.includes('admin')));
  const emails = new Map<string, string[]>();
  for (const u of activeUsers) if (u.email) (emails.get(u.email.toLowerCase()) ?? emails.set(u.email.toLowerCase(), []).get(u.email.toLowerCase())!).push(u.name);
  const dupEmails = [...emails.entries()].filter(([, ns]) => ns.length > 1);
  checks.push(
    users.length && !admins.length
      ? { id: 'users', title: 'Usuarios', level: 'error', summary: 'No hay ningún usuario administrador activo: nadie puede cambiar permisos ni configuración.' }
      : dupEmails.length
        ? { id: 'users', title: 'Usuarios con el mismo email', level: 'warn', count: dupEmails.length, summary: 'Dos usuarios tienen el mismo email: al iniciar sesión no se sabe cuál es.', items: sample(dupEmails.map(([e, ns]) => `${maskEmail(e)}: ${ns.join(', ')}`)) }
        : ok('users', 'Usuarios', `${activeUsers.length} usuarios activos, ${admins.length} administradores.`),
  );

  // 11. Sincronización con la nube
  const stalePending = !!cloud.pending && cloud.pending > 0 && (!cloud.lastSyncAt || Date.now() - Date.parse(cloud.lastSyncAt) > 30 * 60_000);
  checks.push(
    cloud.phase !== 'linked'
      ? { id: 'cloud', title: 'Nube', level: cloud.phase === 'unconfigured' ? 'info' : 'warn', summary: cloud.phase === 'signed_out' ? 'No hay sesión iniciada en la nube: los cambios quedan sólo en este dispositivo.' : cloud.phase === 'no_workspace' ? 'Sesión iniciada pero sin espacio de trabajo: los datos no se comparten.' : `Estado de la nube: ${cloud.phase}.` }
      : cloud.syncState === 'error' || cloud.error
        ? { id: 'cloud', title: 'Nube', level: 'error', summary: `Error de sincronización: ${cloud.error ?? 'desconocido'}.` }
        : stalePending
          ? { id: 'cloud', title: 'Nube', level: 'warn', summary: `${cloud.pending} cambios sin subir desde hace más de media hora.` }
          : ok('cloud', 'Nube', `Sincronizado con "${cloud.workspace ?? '?'}"${cloud.pending ? ` (${cloud.pending} cambios subiendo)` : ''}.`),
  );

  // 12. Integraciones (Maxirest)
  const jobErrors = syncJobs.filter((j) => j.status === 'error');
  checks.push(
    jobErrors.length
      ? { id: 'integrations', title: 'Integraciones', level: 'warn', count: jobErrors.length, summary: `${jobErrors.length} envíos a la integración fallaron.`, items: sample(jobErrors.map((j) => `${j.operation}: ${j.error ?? j.technicalError ?? 'error'}`)) }
      : ok('integrations', 'Integraciones', syncJobs.length ? 'Sin envíos con error.' : 'Sin integraciones activas.'),
  );

  // 13. Errores de la app
  const errors = readErrorLog();
  const week = errors.filter((e) => Date.now() - Date.parse(e.at) < 7 * 86_400_000);
  const crashes = week.filter((e) => !e.kind);
  checks.push(
    week.length
      ? { id: 'app-errors', title: 'Errores de la app', level: crashes.length ? 'warn' : 'info', count: week.length,
          summary: `En los últimos 7 días: ${crashes.length} errores inesperados y ${week.length - crashes.length} avisos mostrados en pantalla (detalle al final del informe).`,
          items: sample(week.map((e) => `${fmtDateTime(e.at)} · ${e.kind ? 'aviso' : 'ERROR'} · ${e.path} · ${e.message}`)) }
      : ok('app-errors', 'Errores de la app', 'Sin errores registrados en los últimos 7 días.'),
  );

  // 14. Dispositivo: espacio, actualización pendiente
  const env: DiagnosticReport['env'] = {
    online: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
    standalone: typeof matchMedia === 'function' ? matchMedia('(display-mode: standalone)').matches : undefined,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    language: typeof navigator !== 'undefined' ? navigator.language : undefined,
    screen: typeof screen !== 'undefined' ? `${screen.width}x${screen.height}` : undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  const devIssues: string[] = [];
  try {
    const est = typeof navigator !== 'undefined' ? await navigator.storage?.estimate?.() : undefined;
    if (est?.quota) {
      const pct = Math.round(((est.usage ?? 0) / est.quota) * 100);
      env.storageUsedMB = Math.round((est.usage ?? 0) / 1e6);
      env.storagePct = pct;
      if (pct > 80) devIssues.push(`Almacenamiento al ${pct}%`);
    }
    env.persisted = typeof navigator !== 'undefined' ? ((await navigator.storage?.persisted?.()) ?? undefined) : undefined;
  } catch {
    /* no disponible */
  }
  try {
    const reg = typeof navigator !== 'undefined' ? await navigator.serviceWorker?.getRegistration() : undefined;
    env.serviceWorker = reg?.active ? 'activo' : 'ninguno';
    if (reg?.waiting) devIssues.push('Hay una versión nueva descargada esperando para instalarse');
  } catch {
    /* no disponible */
  }
  checks.push(devIssues.length ? { id: 'device', title: 'Dispositivo', level: 'warn', summary: devIssues.join('. ') + '.' } : ok('device', 'Dispositivo', 'Espacio y versión en orden.'));

  const counts: Record<string, number> = {
    productos: products.length,
    productosActivos: active.length,
    movimientos: movements.length,
    familias: categories.length,
    unidades: units.length,
    usuarios: users.length,
    facturas: await db.invoices.count(),
    conteos: await db.counts.count(),
  };

  return { at: new Date().toISOString(), version: __APP_VERSION__, env, cloud, counts, checks, errors };
}

function maskEmail(e: string) {
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}***@${d ?? ''}`;
}

/** Arma un conteo sólo con los productos indicados (para cargar su stock real). */
export async function countProducts(productIds: string[], name: string) {
  const { startCount } = await import('./countService');
  return startCount({ productIds, name });
}

/** Corrección segura: el stock se vuelve a calcular desde los movimientos (no se pierde nada). */
export async function fixStockMismatches(): Promise<number> {
  const [products, movements] = await Promise.all([db.products.toArray(), db.movements.toArray()]);
  const ids = stockMismatches(products, movements).map((x) => x.product.id);
  await db.transaction('rw', db.products, db.movements, async () => {
    for (const id of ids) await recomputeStock(id);
  });
  return ids.length;
}

const ICON: Record<Level, string> = { ok: '✅', info: 'ℹ️', warn: '⚠️', error: '❌' };

/** Informe en texto para pegar en el chat con Claude. */
export function reportToText(r: DiagnosticReport): string {
  const order: Level[] = ['error', 'warn', 'info', 'ok'];
  const sorted = [...r.checks].sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
  const n = (l: Level) => r.checks.filter((c) => c.level === l).length;
  const lines = [
    `# Diagnóstico de Stock Manager v${r.version}`,
    `Fecha: ${fmtDateTime(r.at)} · ${n('error')} errores · ${n('warn')} avisos · ${n('info')} notas · ${n('ok')} en orden`,
    '',
    'Claude: revisá este informe y corregí en el código (repo Braian5555/stock-manager-v2) lo que corresponda.',
    '',
  ];
  for (const c of sorted) {
    lines.push(`## ${ICON[c.level]} ${c.title} [${c.id}]`, c.summary);
    if (c.items?.length) {
      for (const i of c.items) lines.push(`- ${i}`);
      if (c.count && c.count > c.items.length) lines.push(`- … y ${c.count - c.items.length} más`);
    }
    lines.push('');
  }
  lines.push('## Datos', ...Object.entries(r.counts).map(([k, v]) => `- ${k}: ${v}`), '');
  lines.push('## Nube', ...Object.entries(r.cloud).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- ${k}: ${v}`), '');
  lines.push('## Dispositivo', ...Object.entries(r.env).filter(([, v]) => v !== undefined).map(([k, v]) => `- ${k}: ${v}`), '');
  if (r.errors.length) {
    lines.push('## Registro de errores (más nuevos primero)');
    for (const e of r.errors.slice(0, 15)) lines.push('```', `${e.at} · v${e.version} · ${e.path}${e.kind ? ' · aviso' : ''}`, e.message, e.stack ?? '', '```');
  }
  return lines.join('\n');
}
