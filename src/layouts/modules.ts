import {
  ArrowLeftRight, Boxes, Cloud, UserCog, ClipboardCheck, Download, Home, MapPin, Package, Plug, Ruler, Scale, Settings, ShoppingCart, Tags, Truck,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey, Permission } from '../models';

export const MODULE_PATH: Record<ModuleKey, string> = {
  dashboard: '/',
  stock: '/stock',
  count: '/conteo',
  orders: '/pedidos',
  products: '/productos',
  suppliers: '/proveedores',
  locations: '/ubicaciones',
  categories: '/familias',
  units: '/unidades',
  movements: '/movimientos',
  reconciliation: '/conciliacion',
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
  products: Package,
  suppliers: Truck,
  locations: MapPin,
  categories: Tags,
  units: Ruler,
  movements: ArrowLeftRight,
  reconciliation: Scale,
  export: Download,
  integrations: Plug,
  cloud: Cloud,
  users: UserCog,
  settings: Settings,
};

/** Módulos de la barra inferior en móvil (el resto va en "Más"). */
export const BOTTOM_KEYS: ModuleKey[] = ['dashboard', 'stock', 'count', 'orders'];

/** Permisos que habilitan cada módulo (alcanza con tener uno). */
export const MODULE_PERMISSIONS: Record<ModuleKey, Permission[]> = {
  dashboard: ['stock.view'],
  stock: ['stock.view'],
  count: ['count.do'],
  orders: ['orders.manage', 'orders.receive'],
  products: ['catalog.manage'],
  suppliers: ['catalog.manage'],
  locations: ['catalog.manage'],
  categories: ['catalog.manage'],
  units: ['catalog.manage'],
  movements: ['movements.view'],
  reconciliation: ['admin'],
  export: ['export'],
  integrations: ['admin'],
  cloud: ['admin'],
  users: ['admin'],
  settings: ['admin'],
};
