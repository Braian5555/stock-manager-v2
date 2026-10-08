import { CLOUD_LINK_KEY, db } from '../database/db';
import type { Category, Integration, Location, Product, Supplier, Unit } from '../models';
import { nowIso, uuid } from '../utils/id';
import { defaultSettings, SETTINGS_ID } from './settingsService';
import { applyMovement } from './stockService';

const DEFAULT_UNITS: [string, string][] = [
  ['Unidad', 'u'], ['Kilogramo', 'kg'], ['Gramo', 'g'], ['Litro', 'l'], ['Mililitro', 'ml'],
  ['Caja', 'caja'], ['Bolsa', 'bolsa'], ['Paquete', 'paq'], ['Botella', 'bot'], ['Bidón', 'bidón'],
];
const DEFAULT_CATEGORIES = ['Bebidas', 'Carnes', 'Verduras', 'Pescados', 'Limpieza', 'Condimentos', 'Desechables', 'Congelados', 'Hielo', 'Almacén'];
const DEFAULT_LOCATIONS = ['Depósito central', 'Cámara de verduras', 'Cámara de congelados', 'Cámara de producción', 'Depósito de bebidas', 'Depósito de limpieza'];

function base() {
  const t = nowIso();
  return { id: uuid(), createdAt: t, updatedAt: t };
}

export function defaultIntegration(): Integration {
  return {
    ...base(),
    id: 'maxirest',
    system: 'maxirest',
    mode: 'disabled',
    status: 'no_configurado',
    stockAuthority: 'maxirest',
    syncInterval: 'manual',
  };
}

/**
 * Crea la configuración y los catálogos base la primera vez que se abre la app.
 * Es idempotente: si ya existen datos no hace nada.
 */
export async function ensureBaseData(): Promise<{ firstRun: boolean }> {
  return db.transaction('rw', [db.settings, db.businesses, db.units, db.categories, db.locations, db.integrations, db.meta], async () => {
    const existing = await db.settings.get(SETTINGS_ID);
    if (!(await db.integrations.get('maxirest'))) await db.integrations.add(defaultIntegration());
    if (existing) return { firstRun: false };
    // Vinculado a la nube: la configuración y los catálogos vienen de ahí. Sembrar acá
    // pisaría la configuración del negocio y duplicaría las listas en todos los dispositivos.
    if (await db.meta.get(CLOUD_LINK_KEY)) return { firstRun: false };
    const s = defaultSettings();
    await db.settings.add(s);
    await db.businesses.add({ ...base(), name: s.businessName, subtitle: s.subtitle });
    if ((await db.units.count()) === 0)
      await db.units.bulkAdd(DEFAULT_UNITS.map(([name, abbreviation]) => ({ ...base(), name, abbreviation }) satisfies Unit));
    if ((await db.categories.count()) === 0)
      await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((name) => ({ ...base(), name }) satisfies Category));
    if ((await db.locations.count()) === 0)
      await db.locations.bulkAdd(DEFAULT_LOCATIONS.map((name) => ({ ...base(), name }) satisfies Location));
    return { firstRun: true };
  });
}

/** Unidades, familias y ubicaciones de base (sólo las listas que estén vacías). */
export async function ensureBaseCatalogs(): Promise<void> {
  await db.transaction('rw', [db.units, db.categories, db.locations], async () => {
    if ((await db.units.count()) === 0)
      await db.units.bulkAdd(DEFAULT_UNITS.map(([name, abbreviation]) => ({ ...base(), name, abbreviation }) satisfies Unit));
    if ((await db.categories.count()) === 0)
      await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((name) => ({ ...base(), name }) satisfies Category));
    if ((await db.locations.count()) === 0)
      await db.locations.bulkAdd(DEFAULT_LOCATIONS.map((name) => ({ ...base(), name }) satisfies Location));
  });
}

/** Datos de ejemplo 100% genéricos (sin marcas ni proveedores reales). */
export async function loadDemoData(): Promise<void> {
  const suppliers: Supplier[] = [
    { ...base(), name: 'Proveedor A', contact: 'Ventas', phone: '+54 11 0000-0001', email: 'ventas@proveedor-a.example' },
    { ...base(), name: 'Distribuidora Ejemplo', contact: 'Atención comercial', phone: '+54 11 0000-0002' },
    { ...base(), name: 'Carnicería Ejemplo', phone: '+54 11 0000-0003' },
    { ...base(), name: 'Verdulería Ejemplo', phone: '+54 11 0000-0004' },
    { ...base(), name: 'Proveedor B', email: 'pedidos@proveedor-b.example' },
  ];
  const units = await db.units.toArray();
  const cats = await db.categories.toArray();
  const locs = await db.locations.toArray();
  const u = (abbr: string) => units.find((x) => x.abbreviation === abbr)?.id;
  const c = (name: string) => cats.find((x) => x.name === name)?.id;
  const l = (name: string) => locs.find((x) => x.name === name)?.id;
  const [provA, dist, carn, verd, provB] = suppliers.map((s) => s.id);

  type Seed = [string, string, string | undefined, string | undefined, string | undefined, string, number, number, number, number?, string?];
  // nombre, sku, familia, unidad, ubicación, proveedor, stock, mín, máx, factor compra, unidad compra
  const rows: Seed[] = [
    ['Agua mineral 500 ml', 'BEB-001', c('Bebidas'), u('bot'), l('Depósito de bebidas'), dist, 48, 24, 96, 12, u('caja')],
    ['Gaseosa cola 1,5 L', 'BEB-002', c('Bebidas'), u('bot'), l('Depósito de bebidas'), dist, 10, 12, 48, 6, u('caja')],
    ['Hielo 10 kg', 'HIE-010', c('Hielo'), u('bolsa'), l('Cámara de congelados'), provA, 3, 8, 20],
    ['Hielo 5 kg', 'HIE-005', c('Hielo'), u('bolsa'), l('Cámara de congelados'), provA, 12, 6, 20],
    ['Carne picada', 'CAR-001', c('Carnes'), u('kg'), l('Cámara de producción'), carn, 2, 10, 30],
    ['Pechuga de pollo', 'CAR-002', c('Carnes'), u('kg'), l('Cámara de producción'), carn, 14, 8, 25],
    ['Papa', 'VER-001', c('Verduras'), u('kg'), l('Cámara de verduras'), verd, 0, 15, 50, 10, u('bolsa')],
    ['Tomate', 'VER-002', c('Verduras'), u('kg'), l('Cámara de verduras'), verd, 9, 6, 20],
    ['Filet de pescado', 'PES-001', c('Pescados'), u('kg'), l('Cámara de congelados'), provB, 6, 4, 12],
    ['Detergente 5 L', 'LIM-001', c('Limpieza'), u('bidón'), l('Depósito de limpieza'), provB, 1, 2, 6],
    ['Servilletas', 'DES-001', c('Desechables'), u('paq'), l('Depósito central'), provA, 40, 20, 80],
    ['Vasos descartables', 'DES-002', c('Desechables'), u('paq'), l('Depósito central'), provA, 0, 10, 40],
    ['Harina 000', 'ALM-001', c('Almacén'), u('kg'), l('Depósito central'), dist, 25, 10, 50],
    ['Aceite de girasol 900 ml', 'ALM-002', c('Almacén'), u('bot'), l('Depósito central'), dist, 7, 6, 24, 12, u('caja')],
    ['Sal fina', 'CON-001', c('Condimentos'), u('kg'), l('Depósito central'), dist, 5, 2, 10],
  ];
  const products: Product[] = rows.map(([name, sku, categoryId, unitId, locationId, supplierId, , minStock, maxStock, factor, purchaseUnitId]) => ({
    ...base(),
    name,
    sku,
    categoryId,
    unitId,
    locationId,
    supplierId,
    purchaseUnitId,
    purchaseFactor: factor ?? 1,
    alternativeSupplierIds: supplierId === provA ? [provB] : [],
    stock: 0,
    minStock,
    maxStock,
    active: true,
  }));
  await db.suppliers.bulkAdd(suppliers);
  await db.products.bulkAdd(products);
  for (let i = 0; i < products.length; i++) {
    const qty = rows[i][6];
    if (qty > 0)
      await applyMovement({ productId: products[i].id, type: 'ingreso', newQuantity: qty, reason: 'Stock inicial (ejemplo)', origin: 'alta', idempotencyKey: `initial:${products[i].id}` });
  }
}
