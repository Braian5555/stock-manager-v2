import { Snowflake, UtensilsCrossed, CookingPot, ReceiptText, Store, Wallet, BookOpen, Armchair,
  ArrowLeftRight, BarChart3, Boxes, ClipboardCheck, Cloud, Download, Forklift, Home, MapPin, Package, Plug, Receipt, Ruler, Scale, Settings as SettingsIcon,
  ShoppingCart, Stethoscope, Tags, Truck, UserCog, ChefHat, CakeSlice,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, Permission, Settings } from '../models';
import { MODULES } from '../services/settingsService';

export const MODULE_PATH: Record<ModuleKey, string> = {
  dashboard: '/',
  stock: '/stock',
  count: '/conteo',
  orders: '/pedidos',
  invoices: '/facturas',
  transfers: '/remitos',
  products: '/productos',
  suppliers: '/proveedores',
  locations: '/ubicaciones',
  categories: '/familias',
  units: '/unidades',
  movements: '/movimientos',
  reconciliation: '/conciliacion',
  reports: '/reportes',
  production: '/produccion',
  pastry: '/pasteleria',
  showcase: '/camara',
  salon: '/salon',
  kitchen: '/cocina',
  fiscal: '/comprobantes',
  salonConfig: '/salon/configuracion',
  diagnostics: '/diagnostico',
  export: '/exportar',
  integrations: '/integraciones',
  cloud: '/nube',
  users: '/usuarios',
  settings: '/configuracion',
};

export const MODULE_ICON: Record<ModuleKey, LucideIcon> = {
  dashboard: Home,
  stock: Boxes,
  count: ClipboardCheck,
  orders: ShoppingCart,
  invoices: Receipt,
  transfers: Forklift,
  products: Package,
  suppliers: Truck,
  locations: MapPin,
  categories: Tags,
  units: Ruler,
  movements: ArrowLeftRight,
  reconciliation: Scale,
  reports: BarChart3,
  production: ChefHat,
  pastry: CakeSlice,
  showcase: Snowflake,
  salon: UtensilsCrossed,
  kitchen: CookingPot,
  fiscal: ReceiptText,
  salonConfig: SettingsIcon,
  diagnostics: Stethoscope,
  export: Download,
  integrations: Plug,
  cloud: Cloud,
  users: UserCog,
  settings: SettingsIcon,
};

/** Nombre corto para las barras de navegación (el menú completo usa el nombre largo). */
const SHORT_LABEL: Partial<Record<ModuleKey, string>> = {
  transfers: 'Remitos',
  export: 'Exportar',
  cloud: 'Cuenta',
  reconciliation: 'Conciliación',
};

/**
 * Módulos retirados (pedidos, proveedores, remitos, reportes, conciliación): la app se dedica a
 * stock, panadería (producción) y facturas para el administrativo.
 * Sus datos se conservan (los proveedores siguen en cada producto); sólo dejan de mostrarse.
 * Para reactivarlos alcanza con sacarlos de esta lista.
 */
export const RETIRED_MODULES: ReadonlySet<ModuleKey> = new Set<ModuleKey>(['orders', 'suppliers', 'transfers', 'reports', 'reconciliation']);
export const moduleEnabled = (k: ModuleKey) => !RETIRED_MODULES.has(k);
/** Permisos que sólo servían a los módulos retirados (se ocultan al editar usuarios). */
export const RETIRED_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>(['orders.manage', 'orders.receive', 'transfers']);

/** Grupos para "Más" (celular y computadora). */
export const MODULE_GROUPS: { title: string; keys: ModuleKey[] }[] = [
  { title: 'Operación diaria', keys: ['dashboard', 'stock', 'count', 'production', 'pastry', 'showcase', 'movements', 'invoices'] },
  { title: 'Catálogo', keys: ['products', 'categories', 'units', 'locations'] },
  { title: 'Administración', keys: ['cloud', 'users', 'export', 'integrations', 'diagnostics', 'settings'] },
];

/** Permisos que habilitan cada módulo (alcanza con tener uno). */
export const MODULE_PERMISSIONS: Record<ModuleKey, Permission[]> = {
  dashboard: ['stock.view'],
  stock: ['stock.view'],
  count: ['count.do'],
  orders: ['orders.manage', 'orders.receive'],
  invoices: ['invoices'],
  transfers: ['transfers'],
  products: ['catalog.manage'],
  suppliers: ['catalog.manage'],
  locations: ['catalog.manage'],
  categories: ['catalog.manage'],
  units: ['catalog.manage'],
  movements: ['movements.view'],
  reconciliation: ['admin'],
  reports: ['movements.view', 'export'],
  production: ['production'],
  pastry: ['pastry'],
  showcase: ['stock.move'],
  salon: ['salon'],
  kitchen: ['salon'],
  fiscal: ['billing'],
  salonConfig: ['admin'],
  diagnostics: ['admin'],
  export: ['export'],
  integrations: ['admin'],
  cloud: ['admin'],
  users: ['admin'],
  settings: ['admin'],
};

/**
 * Etiqueta para las barras: si la persona renombró el módulo en Configuración se respeta su
 * nombre; si no, se usa la versión corta ("Remitos" en vez de "Remitos internos").
 */
export function navLabel(settings: Settings, key: ModuleKey): string {
  const custom = settings.menu.find((m) => m.key === key)?.label;
  const def = MODULES.find((m) => m.key === key)?.label;
  if (custom && custom !== def) return custom;
  return SHORT_LABEL[key] ?? def ?? key;
}

/** Módulos visibles para esta persona, en el orden del menú configurado. */
export function visibleModules(settings: Settings, canAny: (p: Permission[]) => boolean): ModuleKey[] {
  return settings.menu.filter((m) => m.visible && moduleEnabled(m.key) && canAny(MODULE_PERMISSIONS[m.key])).map((m) => m.key);
}

const PRODUCTION_LINES: ModuleKey[] = ['production', 'pastry'];
/**
 * Quien usa una sola cosa (p. ej. el panadero: Producción y Pastelería) entra directo ahí y
 * nunca ve "sin permiso". Devuelve ese módulo de inicio, o undefined si usa varias secciones.
 */
export function soleModule(visible: ModuleKey[]): ModuleKey | undefined {
  const list = visible.filter((k) => k !== 'settings');
  if (list.length === 1) return list[0];
  // Mozos: Salón y Cocina.
  if (list.length > 1 && list.every((k) => SALON_MODULES.has(k))) return list.includes('salon') ? 'salon' : list[0];
  return list.length > 1 && list.every((k) => PRODUCTION_LINES.includes(k)) ? list[0] : undefined;
}

/** Barra superior (computadora): los fijados, en el orden del menú; el resto queda en "Más". */
export function topNavModules(settings: Settings, visible: ModuleKey[]) {
  const pinned = new Set(settings.navTop ?? []);
  let top = visible.filter((k) => pinned.has(k));
  // Usuarios con pocas secciones (p. ej. sólo Producción): se muestran directo en la barra.
  if (!top.length) top = visible.filter((k) => k !== 'settings').slice(0, 8);
  return { top, more: visible.filter((k) => !top.includes(k) && k !== 'settings') };
}

/** Barra inferior (celular): hasta 4 módulos + "Más". */
export function bottomNavModules(settings: Settings, visible: ModuleKey[]): ModuleKey[] {
  const allowed = new Set(visible);
  const list = (settings.navBottom ?? []).filter((k) => allowed.has(k)).slice(0, 4);
  if (!list.length) return visible.filter((k) => k !== 'settings').slice(0, 4);
  // Si algún fijado quedó oculto (p. ej. un módulo retirado), se completa con los siguientes del menú.
  if (list.length < 4 && (settings.navBottom ?? []).some((k) => !allowed.has(k))) {
    const prefer: ModuleKey[] = ['count', 'production', 'invoices'];
    for (const k of [...prefer.filter((x) => allowed.has(x)), ...visible]) if (list.length < 4 && k !== 'settings' && !list.includes(k)) list.push(k);
    const order = new Map(visible.map((k, i) => [k, i]));
    list.sort((a, b) => order.get(a)! - order.get(b)!);
  }
  return list;
}

// ───────────── Secciones (barra lateral de la computadora + pestañas) ─────────────

export interface Section {
  key: string;
  icon: LucideIcon;
  /** Nombre fijo; si falta se usa el nombre (personalizable) del primer módulo. */
  label?: string;
  modules: ModuleKey[];
  /** Va abajo en la barra lateral (configuración). */
  bottom?: boolean;
}

/** Cada sección agrupa módulos relacionados, que se muestran como pestañas arriba. */
export const SECTIONS: Section[] = [
  { key: 'inicio', icon: Home, modules: ['dashboard'] },
  { key: 'stock', icon: Boxes, modules: ['stock', 'movements', 'count', 'reconciliation'] },
  { key: 'produccion', icon: ChefHat, modules: ['production'] },
  { key: 'pasteleria', icon: CakeSlice, modules: ['pastry'] },
  { key: 'camara', icon: Snowflake, modules: ['showcase'] },
  { key: 'productos', icon: Package, modules: ['products', 'categories', 'units', 'locations'] },
  { key: 'facturas', icon: Receipt, modules: ['invoices'] },
  { key: 'config', icon: SettingsIcon, modules: ['settings', 'users', 'cloud', 'export', 'integrations', 'diagnostics'], bottom: true },
];

export interface VisibleSection extends Section {
  label: string;
  /** Módulos de la sección que esta persona puede ver, en el orden del menú configurado. */
  tabs: ModuleKey[];
}

/** Secciones con al menos un módulo visible para esta persona. */
export function visibleSections(settings: Settings, visible: ModuleKey[]): VisibleSection[] {
  const order = new Map(visible.map((k, i) => [k, i]));
  return SECTIONS.map((s) => {
    const tabs = s.modules.filter((k) => order.has(k)).sort((a, b) => order.get(a)! - order.get(b)!);
    // Configuración siempre primero dentro de su sección.
    if (s.key === 'config') tabs.sort((a, b) => Number(b === 'settings') - Number(a === 'settings'));
    const first = s.modules.find((k) => order.has(k)) ?? s.modules[0];
    return { ...s, tabs, label: s.label ?? navLabel(settings, first) };
  }).filter((s) => s.tabs.length > 0);
}

/** Módulo de la ruta actual (la ruta más específica que coincide). */
export function moduleOfPath(pathname: string): ModuleKey | undefined {
  let best: ModuleKey | undefined;
  for (const [k, path] of Object.entries(MODULE_PATH) as [ModuleKey, string][]) {
    const hit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (hit && (!best || path.length > MODULE_PATH[best].length)) best = k;
  }
  return best;
}

// ───────────── Áreas: Stock y Salón ─────────────

/**
 * La app tiene dos áreas, cada una con su menú: Stock (inventario, producción, facturas de
 * proveedores) y Salón (mesas, mostrador, cocina, caja, carta, comprobantes y su configuración).
 * Quien sólo usa el Salón (mozos, cocina) entra directo ahí y no ve el área de Stock.
 */
export type Area = 'stock' | 'salon';
export const SALON_MODULES: ReadonlySet<ModuleKey> = new Set<ModuleKey>(['salon', 'kitchen', 'fiscal', 'salonConfig']);
export const AREA_LABEL: Record<Area, string> = { stock: 'Stock', salon: 'Salón' };
export const AREA_ICON: Record<Area, LucideIcon> = { stock: Boxes, salon: UtensilsCrossed };
export const areaOfModule = (k?: ModuleKey): Area | undefined => (!k ? undefined : SALON_MODULES.has(k) ? 'salon' : 'stock');

/** Entradas del menú del Salón: cada vista es una sección propia. */
export interface SalonItem { key: string; label: string; icon: LucideIcon; to: string; module: ModuleKey; perms?: Permission[]; bottom?: boolean }
export const SALON_NAV: SalonItem[] = [
  { key: 'mesas', label: 'Mesas', icon: Armchair, to: '/salon', module: 'salon' },
  { key: 'mostrador', label: 'Mostrador', icon: Store, to: '/salon?vista=mostrador', module: 'salon' },
  { key: 'cocina', label: 'Cocina', icon: CookingPot, to: '/cocina', module: 'kitchen' },
  { key: 'caja', label: 'Caja', icon: Wallet, to: '/salon?vista=caja', module: 'salon', perms: ['billing', 'admin'] },
  { key: 'carta', label: 'Carta', icon: BookOpen, to: '/salon?vista=carta', module: 'salon' },
  { key: 'hoy', label: 'Ventas de hoy', icon: BarChart3, to: '/salon?vista=hoy', module: 'salon' },
  { key: 'comprobantes', label: 'Comprobantes', icon: ReceiptText, to: '/comprobantes', module: 'fiscal' },
  { key: 'config', label: 'Configuración', icon: SettingsIcon, to: '/salon/configuracion', module: 'salonConfig', bottom: true },
];
export const SALON_VIEWS = ['mesas', 'mostrador', 'caja', 'carta', 'hoy'] as const;
export type SalonView = (typeof SALON_VIEWS)[number];

export function salonItems(visible: ModuleKey[], canAny: (p: Permission[]) => boolean): SalonItem[] {
  const v = new Set(visible);
  return SALON_NAV.filter((i) => v.has(i.module) && (!i.perms || canAny(i.perms)));
}

/** Entrada del Salón que corresponde a la ruta actual. */
export function activeSalonItem(pathname: string, search: string): string | undefined {
  if (pathname.startsWith('/salon/configuracion')) return 'config';
  if (pathname.startsWith('/cocina')) return 'cocina';
  if (pathname.startsWith('/comprobantes')) return 'comprobantes';
  if (pathname === '/salon' || pathname.startsWith('/salon/')) {
    const v = new URLSearchParams(search).get('vista');
    return v && (SALON_VIEWS as readonly string[]).includes(v) ? v : 'mesas';
  }
  return undefined;
}

/** Áreas a las que tiene acceso la persona. */
export function areasFor(visible: ModuleKey[]): Area[] {
  const out: Area[] = [];
  if (visible.some((k) => !SALON_MODULES.has(k) && k !== 'settings')) out.push('stock');
  if (visible.some((k) => SALON_MODULES.has(k))) out.push('salon');
  return out;
}

/** Adónde lleva cada área al elegirla. */
export function areaHome(area: Area, visible: ModuleKey[], canAny: (p: Permission[]) => boolean): string {
  if (area === 'salon') return salonItems(visible, canAny)[0]?.to ?? '/salon';
  if (visible.includes('dashboard')) return '/';
  const first = visible.find((k) => !SALON_MODULES.has(k));
  return first ? MODULE_PATH[first] : '/';
}

const AREA_KEY = 'sm.area';
export function readArea(): Area | undefined {
  try { const a = localStorage.getItem(AREA_KEY); return a === 'salon' || a === 'stock' ? a : undefined; } catch { return undefined; }
}
export function writeArea(a: Area) {
  try { localStorage.setItem(AREA_KEY, a); } catch { /* sin almacenamiento */ }
}
