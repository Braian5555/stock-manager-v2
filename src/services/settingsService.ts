import { APP_NAME } from '../config/app';
import { db } from '../database/db';
import type { MenuItemSetting, ModuleKey, Settings } from '../models';
import { nowIso } from '../utils/id';

export const SETTINGS_ID = 'app';

/** Módulos de la app y su etiqueta por defecto (orden por defecto del menú). */
export const MODULES: { key: ModuleKey; label: string; primary?: boolean; locked?: boolean }[] = [
  { key: 'dashboard', label: 'Inicio', primary: true, locked: true },
  { key: 'stock', label: 'Stock', primary: true },
  { key: 'products', label: 'Productos' },
  { key: 'count', label: 'Conteo', primary: true },
  { key: 'production', label: 'Panadería' },
  { key: 'pastry', label: 'Pastelería' },
  { key: 'showcase', label: 'Cámara' },
  { key: 'salon', label: 'Salón' },
  { key: 'kitchen', label: 'Cocina' },
  { key: 'fiscal', label: 'Comprobantes' },
  { key: 'salonConfig', label: 'Configuración del salón' },
  { key: 'orders', label: 'Pedidos', primary: true },
  { key: 'movements', label: 'Movimientos' },
  { key: 'transfers', label: 'Remitos internos' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'invoices', label: 'Facturas' },
  { key: 'reports', label: 'Reportes' },
  { key: 'categories', label: 'Familias' },
  { key: 'units', label: 'Unidades' },
  { key: 'locations', label: 'Ubicaciones' },
  { key: 'reconciliation', label: 'Conciliación' },
  { key: 'export', label: 'Exportar y backup' },
  { key: 'cloud', label: 'Cuenta y nube' },
  { key: 'users', label: 'Usuarios', locked: true },
  { key: 'integrations', label: 'Integraciones' },
  { key: 'diagnostics', label: 'Diagnóstico' },
  { key: 'settings', label: 'Configuración', locked: true },
];

/** Orden por defecto de versiones anteriores: si el menú guardado nunca se reordenó, se pasa al orden nuevo. */
const LEGACY_DEFAULT_ORDERS: ModuleKey[][] = [
  ['dashboard', 'stock', 'count', 'orders', 'invoices', 'transfers', 'products', 'suppliers', 'locations', 'categories', 'units', 'movements', 'reconciliation', 'export', 'cloud', 'users', 'integrations', 'settings'],
];

/** Barra superior por defecto (computadora). */
export const DEFAULT_NAV_TOP: ModuleKey[] = ['dashboard', 'stock', 'products', 'count', 'orders', 'movements', 'transfers', 'suppliers', 'invoices', 'reports'];
/** Barra inferior por defecto (celular): lo de todos los días. Conteo y Movimientos están en las pestañas de Stock. */
export const DEFAULT_NAV_BOTTOM: ModuleKey[] = ['dashboard', 'stock', 'production', 'invoices'];
/** Barras inferiores por defecto de versiones anteriores: si nunca se cambiaron, pasan a la nueva. */
const LEGACY_NAV_BOTTOM: ModuleKey[][] = [['dashboard', 'stock', 'orders', 'movements']];
export const MAX_NAV_BOTTOM = 4;

/** Rojo de sello (estilo Kraft). */
export const DEFAULT_PRIMARY = '#31616e';
/** Colores por defecto de versiones anteriores: si nunca se cambiaron, se adopta la identidad nueva. */
// Colores de fábrica de versiones anteriores (si nadie los cambió, pasan a los de Orillas).
const LEGACY_PRIMARY = ['#4f46e5', '#0e6b67', '#b3261e'];
const LEGACY_SECONDARY = ['#0ea5e9', '#22282b', '#3a2315'];

export const defaultMenu = (): MenuItemSetting[] => MODULES.map((m) => ({ key: m.key, label: m.label, visible: true }));

/** ¿Se usan recetas? (si no se activó: no). */
export const recipesOn = (s: { recipes?: boolean } | undefined) => s?.recipes === true;
/** ¿Se usa el Salón? (si no se activó: no; la app es sólo de stock). */
export const salonOn = (s: { salon?: boolean } | undefined) => s?.salon === true;

export function defaultSettings(): Settings {
  const t = nowIso();
  return {
    id: SETTINGS_ID,
    createdAt: t,
    updatedAt: t,
    businessName: APP_NAME,
    subtitle: 'Software gastronómico',
    logo: { kind: 'default' },
    primaryColor: DEFAULT_PRIMARY,
    secondaryColor: '#1f4049',
    theme: 'system',
    menu: defaultMenu(),
    criticalRatio: 0.5,
    suggestionMode: 'toMax',
    autoLockMinutes: 15,
    navTop: [...DEFAULT_NAV_TOP],
    navBottom: [...DEFAULT_NAV_BOTTOM],
  };
}

/** Completa configuraciones guardadas por versiones anteriores con los campos nuevos. */
export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  const merged: Settings = { ...base, ...s, logo: { ...base.logo, ...s?.logo } } as Settings;
  const saved = new Map((s?.menu ?? []).map((m) => [m.key, m]));
  const known = new Set(MODULES.map((m) => m.key));
  let ordered = (s?.menu ?? []).filter((m) => known.has(m.key));
  const savedOrder = ordered.map((m) => m.key).join(',');
  if (LEGACY_DEFAULT_ORDERS.some((o) => o.join(',') === savedOrder)) {
    // Nunca se reordenó: se adopta el orden nuevo, conservando nombres y visibilidad.
    ordered = MODULES.map((m) => saved.get(m.key)).filter((m): m is MenuItemSetting => !!m);
  }
  // Módulos nuevos (agregados por una versión posterior): se insertan después del módulo
  // que los precede en el orden por defecto, no al final.
  base.menu.forEach((m, i) => {
    if (saved.has(m.key)) return;
    const prevKey = base.menu[i - 1]?.key;
    const at = ordered.findIndex((x) => x.key === prevKey);
    ordered.splice(at >= 0 ? at + 1 : ordered.length, 0, m);
  });
  // La app pasó a llamarse Orillas: si el nombre seguía siendo el de fábrica, se actualiza.
  if (merged.businessName === 'Stock Manager') merged.businessName = APP_NAME;
  if (merged.subtitle === 'Control de inventario') merged.subtitle = base.subtitle;
  if (LEGACY_PRIMARY.includes(String(merged.primaryColor).toLowerCase())) merged.primaryColor = DEFAULT_PRIMARY;
  if (LEGACY_SECONDARY.includes(String(merged.secondaryColor).toLowerCase())) merged.secondaryColor = base.secondaryColor;
  // La "Vitrina" pasó a ser la cámara de congelados (no hay vitrina: se congela, se hornea y va a desayunos).
  ordered = ordered.map((m) => (m.key === 'showcase' && m.label === 'Vitrina' ? { ...m, label: 'Cámara' } : m));
  // "Producción" es la panadería (Pastelería tiene su sección): se llama así en el menú.
  ordered = ordered.map((m) => (m.key === 'production' && m.label === 'Producción' ? { ...m, label: 'Panadería' } : m));
  merged.menu = ordered.map((m) => (MODULES.find((x) => x.key === m.key)?.locked ? { ...m, visible: true } : m));
  merged.navTop = (Array.isArray(s?.navTop) ? s.navTop : DEFAULT_NAV_TOP).filter((k) => known.has(k));
  const savedBottom = Array.isArray(s?.navBottom) && !LEGACY_NAV_BOTTOM.some((o) => o.join(',') === s.navBottom!.join(',')) ? s.navBottom : DEFAULT_NAV_BOTTOM;
  merged.navBottom = savedBottom.filter((k) => known.has(k)).slice(0, MAX_NAV_BOTTOM);
  return merged;
}

export async function getSettings(): Promise<Settings> {
  return normalizeSettings(await db.settings.get(SETTINGS_ID));
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: SETTINGS_ID, updatedAt: nowIso() });
}

export function menuLabel(settings: Settings, key: ModuleKey): string {
  return settings.menu.find((m) => m.key === key)?.label || MODULES.find((m) => m.key === key)?.label || key;
}
