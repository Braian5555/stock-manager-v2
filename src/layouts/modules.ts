import {
  ArrowLeftRight, BarChart3, Boxes, ClipboardCheck, Cloud, Download, Forklift, Home, MapPin, Package, Plug, Receipt, Ruler, Scale, Settings as SettingsIcon,
  ShoppingCart, Tags, Truck, UserCog, ChefHat,
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

/** Grupos para "Más" (celular y computadora). */
export const MODULE_GROUPS: { title: string; keys: ModuleKey[] }[] = [
  { title: 'Operación diaria', keys: ['dashboard', 'stock', 'count', 'production', 'orders', 'movements', 'transfers', 'invoices'] },
  { title: 'Catálogo', keys: ['products', 'suppliers', 'categories', 'units', 'locations'] },
  { title: 'Reportes y control', keys: ['reports', 'reconciliation', 'export'] },
  { title: 'Administración', keys: ['cloud', 'users', 'integrations', 'settings'] },
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
  return settings.menu.filter((m) => m.visible && canAny(MODULE_PERMISSIONS[m.key])).map((m) => m.key);
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
  return list.length ? list : visible.filter((k) => k !== 'settings').slice(0, 4);
}
