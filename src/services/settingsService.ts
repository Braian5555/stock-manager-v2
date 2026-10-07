import { db } from '../database/db';
import type { MenuItemSetting, ModuleKey, Settings } from '../models';
import { nowIso } from '../utils/id';

export const SETTINGS_ID = 'app';

/** Módulos de la app y su etiqueta por defecto (orden por defecto del menú). */
export const MODULES: { key: ModuleKey; label: string; primary?: boolean; locked?: boolean }[] = [
  { key: 'dashboard', label: 'Inicio', primary: true, locked: true },
  { key: 'stock', label: 'Stock', primary: true },
  { key: 'count', label: 'Conteo', primary: true },
  { key: 'orders', label: 'Pedidos', primary: true },
  { key: 'invoices', label: 'Facturas' },
  { key: 'products', label: 'Productos' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'locations', label: 'Ubicaciones' },
  { key: 'categories', label: 'Familias' },
  { key: 'units', label: 'Unidades' },
  { key: 'movements', label: 'Movimientos' },
  { key: 'reconciliation', label: 'Conciliación' },
  { key: 'export', label: 'Exportar y backup' },
  { key: 'cloud', label: 'Cuenta y nube' },
  { key: 'users', label: 'Usuarios', locked: true },
  { key: 'integrations', label: 'Integraciones' },
  { key: 'settings', label: 'Configuración', locked: true },
];

export const defaultMenu = (): MenuItemSetting[] => MODULES.map((m) => ({ key: m.key, label: m.label, visible: true }));

export function defaultSettings(): Settings {
  const t = nowIso();
  return {
    id: SETTINGS_ID,
    createdAt: t,
    updatedAt: t,
    businessName: 'Stock Manager',
    subtitle: 'Control de inventario',
    logo: { kind: 'default' },
    primaryColor: '#4f46e5',
    secondaryColor: '#0ea5e9',
    theme: 'system',
    menu: defaultMenu(),
    criticalRatio: 0.5,
    suggestionMode: 'toMax',
    autoLockMinutes: 15,
  };
}

/** Completa configuraciones guardadas por versiones anteriores con los campos nuevos. */
export function normalizeSettings(s: Partial<Settings> | undefined): Settings {
  const base = defaultSettings();
  const merged: Settings = { ...base, ...s, logo: { ...base.logo, ...s?.logo } } as Settings;
  const saved = new Map((s?.menu ?? []).map((m) => [m.key, m]));
  const known = new Set(MODULES.map((m) => m.key));
  const ordered = (s?.menu ?? []).filter((m) => known.has(m.key));
  // Módulos nuevos (agregados por una versión posterior): se insertan después del módulo
  // que los precede en el orden por defecto, no al final.
  base.menu.forEach((m, i) => {
    if (saved.has(m.key)) return;
    const prevKey = base.menu[i - 1]?.key;
    const at = ordered.findIndex((x) => x.key === prevKey);
    ordered.splice(at >= 0 ? at + 1 : ordered.length, 0, m);
  });
  merged.menu = ordered.map((m) => (MODULES.find((x) => x.key === m.key)?.locked ? { ...m, visible: true } : m));
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
