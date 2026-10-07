import {
  ArrowLeftRight, Boxes, Cloud, ClipboardCheck, Download, Home, MapPin, Package, Plug, Ruler, Scale, Settings, ShoppingCart, Tags, Truck,
  type LucideIcon,
} from 'lucide-react';
import type { ModuleKey } from '../models';

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
  settings: Settings,
};

/** Módulos de la barra inferior en móvil (el resto va en "Más"). */
export const BOTTOM_KEYS: ModuleKey[] = ['dashboard', 'stock', 'count', 'orders'];
