/**
 * Herramientas del asistente: lo que la IA puede consultar o hacer dentro de la app.
 *
 * - Cada herramienta declara qué permisos la habilitan: a la IA sólo se le ofrecen las que la
 *   persona puede usar, y se vuelve a verificar al ejecutarla.
 * - Las que cambian datos no se ejecutan solas: devuelven una propuesta que la persona confirma
 *   en pantalla. Recién ahí se aplica (con clave fija, así un doble toque no duplica nada).
 */
import { db } from '../../database/db';
import type { InventoryCount, InvoiceItem, MovementType, Permission, Product, Settings, StockMovement, Unit } from '../../models';
import { MODULE_PATH, MODULE_PERMISSIONS, moduleEnabled } from '../../layouts/modules';
import { fmtDay, fmtMoney, fmtNumber, matches, normalize, round3 } from '../../utils/format';
import { MODULES } from '../settingsService';
import { discardCount, setCounted, startCount } from '../countService';
import { needsPackSize, pendingCount, similarity, toStockQty } from '../invoiceAI';
import { applyInvoiceToStock, learnFromInvoice, recentIngresos, undoInvoiceStock } from '../invoiceStock';
import { deleteInvoice, newPageId, saveInvoice, type PageDraft } from '../invoiceService';
import { saveEntity } from '../entityService';
import { base64Bytes } from '../imageService';
import { uuid } from '../../utils/id';
import { priceHistory, priceIncreases } from '../priceService';
import { RESTOCK_LEVEL_LABEL, restockList, usageSinceIso } from '../restockService';
import { deleteProduct, emptyProduct, saveProduct } from '../productService';
import { recipeConsumption, registerProduction, undoProduction } from '../productionService';
import { applyMovement, MOVEMENT_LABEL, revertMovement, statusOf, STATUS_LABEL } from '../stockService';
import { ymdAdd } from '../bakeryService';

// ───────────── Esquemas (formato de Gemini) ─────────────

export interface Schema {
  type: 'OBJECT' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'ARRAY';
  description?: string;
  enum?: string[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
}
const str = (description: string, values?: string[]): Schema => ({ type: 'STRING', description, ...(values ? { enum: values } : {}) });
const num = (description: string): Schema => ({ type: 'NUMBER', description });
const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema => ({ type: 'OBJECT', properties, required, ...(description ? { description } : {}) });
const arr = (items: Schema, description: string): Schema => ({ type: 'ARRAY', items, description });

// ───────────── Contexto ─────────────

export interface ToolContext {
  can: (p: Permission) => boolean;
  settings: Settings;
  /** Hoy (AAAA-MM-DD, hora local). */
  today: string;
  /** Referencias cortas de productos que conoce la IA (p12 → id) y al revés. */
  refs: RefMap;
  /** Fotos del último mensaje de la persona que traía fotos (para guardar facturas). */
  images?: ContextImage[];
}

export interface ContextImage { data: string; type: string; thumb: string; width?: number; height?: number; bytes?: number }

export class RefMap {
  private byRef = new Map<string, string>();
  private byId = new Map<string, string>();
  constructor(products: Product[]) {
    products
      .filter((p) => p.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
      .forEach((p) => this.add(p.id));
  }
  add(id: string): string {
    const had = this.byId.get(id);
    if (had) return had;
    const ref = `p${this.byRef.size + 1}`;
    this.byRef.set(ref, id);
    this.byId.set(id, ref);
    return ref;
  }
  id(ref: string) { return this.byRef.get(ref.trim().toLowerCase()); }
  ref(id: string) { return this.byId.get(id) ?? this.add(id); }
}

/** Error que se le devuelve a la IA (y se muestra si corresponde) en lenguaje claro. */
export class ToolError extends Error {}

export interface Proposal {
  /** Título de la confirmación ("Registrar 3 movimientos"). */
  title: string;
  /** Un renglón por cambio, para que la persona vea exactamente qué se va a hacer. */
  lines: string[];
  /** Avisos (productos que no se encontraron, etc.). */
  notes?: string[];
  /**
   * Aplica los cambios. Devuelve el resultado para la IA, un texto corto para la pantalla y,
   * si se puede, cómo deshacerlo (para corregir enseguida si la IA se equivocó).
   */
  execute: (key: string) => Promise<{ result: unknown; done: string; undo?: () => Promise<string> }>;
}

export interface ToolDef {
  name: string;
  /** Cómo se muestra en la actividad del chat ("Consultó el stock"). */
  label: string;
  description: string;
  parameters: Schema;
  /** Alcanza con tener uno. */
  perms: Permission[];
  /** Consulta: se ejecuta sola. */
  run?: (args: Args, ctx: ToolContext) => Promise<unknown>;
  /** Cambio: arma la propuesta para confirmar. */
  prepare?: (args: Args, ctx: ToolContext) => Promise<Proposal>;
}
type Args = Record<string, unknown>;

// ───────────── Ayudas ─────────────

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.'))) ? Number(v.replace(',', '.')) : undefined);
const list = (v: unknown): Args[] => (Array.isArray(v) ? v.filter((x): x is Args => !!x && typeof x === 'object') : []);
const ymd = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : undefined);

async function lookups() {
  const [units, categories, suppliers, locations] = await Promise.all([db.units.toArray(), db.categories.toArray(), db.suppliers.toArray(), db.locations.toArray()]);
  const by = <T extends { id: string }>(l: T[]) => new Map(l.map((x) => [x.id, x]));
  const u = by(units), c = by(categories), sp = by(suppliers), l = by(locations);
  return {
    units, categories, suppliers,
    unit: (id?: string) => (id ? u.get(id)?.abbreviation ?? '' : '') || 'u',
    category: (id?: string) => (id ? c.get(id)?.name : undefined),
    supplier: (id?: string) => (id ? sp.get(id)?.name : undefined),
    location: (id?: string) => (id ? l.get(id)?.name : undefined),
  };
}
type Lk = Awaited<ReturnType<typeof lookups>>;

/** Producto por referencia (p12), por nombre exacto o por el nombre más parecido. */
export async function resolveProduct(raw: unknown, ctx: ToolContext): Promise<Product> {
  const text = s(raw);
  if (!text) throw new ToolError('Falta indicar el producto.');
  const id = ctx.refs.id(text);
  if (id) {
    const p = await db.products.get(id);
    if (p?.active) return p;
    if (p) throw new ToolError(`“${p.name}” está desactivado en el catálogo.`);
  }
  const all = (await db.products.toArray()).filter((p) => p.active);
  const key = normalize(text);
  const exact = all.find((p) => normalize(p.name) === key) ?? all.find((p) => (p.sku && normalize(p.sku) === key) || (p.barcode && p.barcode === text));
  if (exact) return exact;
  // Por parecido, sólo si no hay dudas: "coca" con dos tamaños de Coca-Cola no se adivina.
  const ranked = all.map((p) => ({ p, sc: similarity(text, p.name) })).filter((x) => x.sc >= 0.45).sort((a, b) => b.sc - a.sc);
  const [first, second] = ranked;
  if (first && ((first.sc >= 0.6 && (!second || first.sc - second.sc >= 0.12)) || (first.sc >= 0.5 && !second))) return first.p;
  if (ranked.length) throw new ToolError(`No sé cuál es “${text}”: puede ser ${ranked.slice(0, 4).map((x) => `“${x.p.name}”`).join(', ')}.`);
  throw new ToolError(`No encontré “${text}” en el catálogo.`);
}

/** Cantidad en unidad de stock: con unidad "compra" se multiplica por las unidades por caja. */
function stockQty(p: Product, qty: number, unit: unknown): number {
  return s(unit) === 'compra' && p.purchaseFactor > 1 ? round3(qty * p.purchaseFactor) : round3(qty);
}

function productRow(p: Product, lk: Lk, ctx: ToolContext) {
  return {
    ref: ctx.refs.ref(p.id),
    nombre: p.name,
    familia: lk.category(p.categoryId),
    unidad: lk.unit(p.unitId),
    ...(ctx.can('stock.view') ? { stock: p.stock, minimo: p.minStock || undefined, maximo: p.maxStock || undefined, estado: STATUS_LABEL[statusOf(p, ctx.settings)] } : {}),
  };
}

const PRODUCT_PERMS: Permission[] = ['stock.view', 'catalog.manage', 'count.do', 'production', 'recipes', 'invoices', 'stock.move'];

// ───────────── Pantallas (para "llevame a…") ─────────────

const SCREENS: Record<string, keyof typeof MODULE_PATH> = {
  inicio: 'dashboard', stock: 'stock', productos: 'products', conteo: 'count', produccion: 'production', vitrina: 'showcase',
  movimientos: 'movements', facturas: 'invoices', familias: 'categories', unidades: 'units', ubicaciones: 'locations',
  usuarios: 'users', configuracion: 'settings', nube: 'cloud', exportar: 'export', diagnostico: 'diagnostics',
};

// ───────────── Herramientas ─────────────

export const TOOLS: ToolDef[] = [
  {
    name: 'buscar_productos',
    label: 'Buscó productos',
    description: 'Busca productos del catálogo por nombre o familia, o filtra por estado del stock. Devuelve stock, mínimo y estado si la persona puede ver el stock.',
    parameters: obj({
      texto: str('Parte del nombre, código o familia. Vacío para todos.'),
      estado: str('Filtro de estado del stock.', ['todos', 'bajo_minimo', 'sin_stock', 'negativo']),
      limite: num('Máximo de resultados (por defecto 30, máximo 80).'),
    }),
    perms: PRODUCT_PERMS,
    run: async (a, ctx) => {
      const lk = await lookups();
      const q = s(a.texto);
      const st = s(a.estado);
      if (st && st !== 'todos' && !ctx.can('stock.view')) throw new ToolError('Esta persona no tiene permiso para ver el stock.');
      const lim = Math.min(80, Math.max(1, n(a.limite) ?? 30));
      const rows = (await db.products.toArray())
        .filter((p) => p.active && (!q || matches(q, p.name, p.sku, p.barcode, lk.category(p.categoryId))))
        .filter((p) => !st || st === 'todos' || (st === 'negativo' ? p.stock < 0 : st === 'sin_stock' ? p.stock <= 0 : p.minStock > 0 && p.stock <= p.minStock))
        .sort((x, y) => x.name.localeCompare(y.name, 'es'));
      return { total: rows.length, productos: rows.slice(0, lim).map((p) => productRow(p, lk, ctx)) };
    },
  },
  {
    name: 'ver_producto',
    label: 'Miró un producto',
    description: 'Detalle de un producto: stock, mínimo y máximo, unidad de compra, proveedor, receta, últimos movimientos y últimos precios de compra (según permisos).',
    parameters: obj({ producto: str('Referencia (p12) o nombre del producto.') }, ['producto']),
    perms: PRODUCT_PERMS,
    run: async (a, ctx) => {
      const p = await resolveProduct(a.producto, ctx);
      const lk = await lookups();
      const out: Record<string, unknown> = {
        ...productRow(p, lk, ctx),
        compra: p.purchaseFactor > 1 ? `${lk.unit(p.purchaseUnitId) === 'u' ? 'caja' : lk.unit(p.purchaseUnitId)} x${p.purchaseFactor}` : undefined,
        proveedor: lk.supplier(p.supplierId),
        ubicacion: lk.location(p.locationId),
        notas: p.notes,
      };
      if (p.recipe && (ctx.can('recipes') || ctx.can('catalog.manage') || ctx.can('production'))) {
        const ids = await db.products.bulkGet(p.recipe.items.map((i) => i.productId));
        out.receta = {
          rinde: `${fmtNumber(p.recipe.yield)} ${lk.unit(p.unitId)}`,
          insumos: p.recipe.items.map((i, k) => ({ ref: ctx.refs.ref(i.productId), nombre: ids[k]?.name ?? '(borrado)', cantidad: i.quantity, unidad: lk.unit(ids[k]?.unitId) })),
        };
      }
      if (ctx.can('movements.view')) {
        const ms = (await db.movements.where('productId').equals(p.id).toArray()).filter((m) => !m.outletId).sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 8);
        out.ultimos_movimientos = ms.map((m) => ({ fecha: m.createdAt.slice(0, 16).replace('T', ' '), tipo: MOVEMENT_LABEL[m.type], cantidad: m.delta, quien: m.performedBy?.name, motivo: m.reason }));
      }
      if (ctx.can('invoices') || ctx.can('catalog.manage')) {
        const points = priceHistory(await db.invoices.toArray()).get(p.id) ?? [];
        out.precios_de_compra = points.slice(-5).map((x) => ({ fecha: x.date, proveedor: lk.supplier(x.supplierId), costo_por_unidad: x.costPerUnit, precio_en_factura: x.unitPrice, unidad_factura: x.invoiceUnit }));
      }
      return out;
    },
  },
  {
    name: 'consultar_movimientos',
    label: 'Consultó movimientos',
    description: 'Totales de movimientos de stock en un período (ingresos, salidas, consumos de recetas, producción, pérdidas/mermas, ajustes), agrupados por producto, día o tipo. Sirve para "cuánto se usó/vendió/produjo".',
    parameters: obj({
      producto: str('Referencia o nombre, para un solo producto (opcional).'),
      desde: str('Fecha inicial AAAA-MM-DD (por defecto, hace 7 días).'),
      hasta: str('Fecha final AAAA-MM-DD, inclusive (por defecto, hoy).'),
      tipo: str('Sólo un tipo de movimiento (opcional).', ['ingreso', 'salida', 'consumo', 'produccion', 'perdida', 'ajuste', 'conteo', 'devolucion']),
      agrupar: str('Cómo agrupar.', ['producto', 'dia', 'tipo']),
    }),
    perms: ['movements.view'],
    run: async (a, ctx) => {
      const from = ymd(a.desde) ?? ymdAdd(ctx.today, -6);
      const to = ymd(a.hasta) ?? ctx.today;
      const product = s(a.producto) ? await resolveProduct(a.producto, ctx) : undefined;
      const tipo = s(a.tipo) as MovementType | '';
      const group = s(a.agrupar) || (product ? 'dia' : 'producto');
      const fromIso = new Date(`${from}T00:00:00`).toISOString();
      const toIso = new Date(`${ymdAdd(to, 1)}T00:00:00`).toISOString();
      const all = await db.movements.where('createdAt').between(fromIso, toIso, true, false).toArray();
      const undone = new Set(all.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
      const ms = all.filter((m) => !m.outletId && !undone.has(m.id) && !m.idempotencyKey?.startsWith('undo:') && (!product || m.productId === product.id) && (!tipo || m.type === tipo));
      const lk = await lookups();
      const products = new Map((await db.products.toArray()).map((p) => [p.id, p]));
      const groups = new Map<string, Record<string, number | string>>();
      for (const m of ms) {
        const local = new Date(m.createdAt);
        const key = group === 'dia' ? `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}` : group === 'tipo' ? m.type : m.productId;
        const g = groups.get(key) ?? { movimientos: 0 };
        g.movimientos = (g.movimientos as number) + 1;
        const field = m.type === 'conteo' || m.type === 'ajuste' ? 'ajustes_netos' : m.type;
        g[field] = round3(((g[field] as number) ?? 0) + m.delta);
        groups.set(key, g);
      }
      const rows: Record<string, unknown>[] = [...groups.entries()].map(([k, g]) => {
        if (group !== 'producto') return { [group]: group === 'tipo' ? MOVEMENT_LABEL[k as MovementType] : k, ...g };
        const p = products.get(k);
        return { ref: ctx.refs.ref(k), producto: p?.name ?? ms.find((m) => m.productId === k)?.productName, unidad: lk.unit(p?.unitId), ...g };
      });
      rows.sort((x, y) => (y.movimientos as number) - (x.movimientos as number));
      return { desde: from, hasta: to, nota: 'Salidas, consumos y pérdidas vienen en negativo. "consumo" es lo descontado por recetas al producir.', grupos: rows.slice(0, 60), total_grupos: rows.length };
    },
  },
  {
    name: 'reponer',
    label: 'Armó la sugerencia de pedido',
    description: 'Qué hay que reponer o pedir: lo que está por debajo del mínimo y TODO lo que está en 0 o en negativo (aunque no tenga mínimo), agrupado por proveedor, con la cantidad sugerida (por mínimo/máximo, o por lo que se gasta en una semana). Usala siempre para "qué tengo que pedir/reponer", pedidos o mensajes a proveedores.',
    parameters: obj({ proveedor: str('Nombre del proveedor para filtrar (opcional).') }),
    perms: ['stock.view'],
    run: async (a, ctx) => {
      const lk = await lookups();
      const { lines, idleAtZero } = restockList(await db.products.toArray(), await db.movements.where('createdAt').aboveOrEqual(usageSinceIso()).toArray(), ctx.settings);
      const buyUnit = (p: Product) => (p.purchaseFactor > 1 ? `${lk.unit(p.purchaseUnitId) === 'u' ? 'caja' : lk.unit(p.purchaseUnitId)} (x${p.purchaseFactor})` : lk.unit(p.unitId));
      const groups = new Map<string, typeof lines>();
      for (const l of lines) {
        const key = lk.supplier(l.product.supplierId) ?? 'Sin proveedor';
        groups.set(key, [...(groups.get(key) ?? []), l]);
      }
      const f = s(a.proveedor);
      return {
        criterio: `Con mínimo: ${ctx.settings.suggestionMode === 'toMax' ? 'completar hasta el máximo' : 'completar hasta el mínimo'}. Sin mínimo: lo que se gasta en una semana (según las últimas 4 semanas).`,
        sin_stock: lines.filter((l) => l.level === 'out').length,
        negativos: lines.filter((l) => l.level === 'neg').length,
        en_cero_sin_movimiento_reciente: idleAtZero,
        total_a_reponer: lines.length,
        proveedores: [...groups.entries()]
          .filter(([name]) => !f || matches(f, name))
          .map(([proveedor, ls]) => ({
            proveedor,
            productos: ls.map((l) => ({
              ref: ctx.refs.ref(l.product.id), nombre: l.product.name,
              estado: RESTOCK_LEVEL_LABEL[l.level], stock: l.product.stock, minimo: l.product.minStock || undefined,
              ...(l.level === 'out' && !l.used ? { sin_movimiento_reciente: true } : {}),
              consumo_semanal: l.weeklyUse !== undefined ? `${fmtNumber(l.weeklyUse)} ${lk.unit(l.product.unitId)}` : undefined,
              pedir: l.quantity !== undefined ? `${fmtNumber(l.quantity)} ${buyUnit(l.product)}` : 'a definir (no tiene mínimo ni consumo reciente)',
              segun: l.basis === 'consumo' ? 'consumo de una semana' : l.basis === 'sin_dato' ? undefined : `stock ${l.basis}`,
            })),
          })),
      };
    },
  },
  {
    name: 'precios',
    label: 'Revisó precios de compra',
    description: 'Precios de compra según las facturas revisadas. Con un producto: su historial. Sin producto: los aumentos recientes (última compra contra la anterior).',
    parameters: obj({ producto: str('Referencia o nombre (opcional).'), dias: num('Para aumentos: cuántos días mirar (por defecto 30).') }),
    perms: ['invoices', 'catalog.manage'],
    run: async (a, ctx) => {
      const lk = await lookups();
      const invoices = await db.invoices.toArray();
      if (s(a.producto)) {
        const p = await resolveProduct(a.producto, ctx);
        const points = priceHistory(invoices).get(p.id) ?? [];
        return { producto: p.name, unidad: lk.unit(p.unitId), historial: points.slice(-12).map((x) => ({ fecha: x.date, proveedor: lk.supplier(x.supplierId), factura: x.number, costo_por_unidad: x.costPerUnit, precio_en_factura: x.unitPrice, unidad_factura: x.invoiceUnit })) };
      }
      const days = Math.min(365, Math.max(1, n(a.dias) ?? 30));
      const products = new Map((await db.products.toArray()).map((p) => [p.id, p]));
      const ups = priceIncreases(invoices, { sinceYmd: ymdAdd(ctx.today, -days), minPct: 1 });
      return {
        dias: days,
        aumentos: ups.slice(0, 30).map((c) => ({ ref: ctx.refs.ref(c.productId), producto: products.get(c.productId)?.name, antes: fmtMoney(c.previous.costPerUnit), ahora: fmtMoney(c.current.costPerUnit), por: lk.unit(products.get(c.productId)?.unitId), aumento_pct: Math.round(c.pct * 10) / 10, fecha: c.current.date, proveedor: lk.supplier(c.current.supplierId) })),
      };
    },
  },
  {
    name: 'facturas',
    label: 'Revisó facturas',
    description: 'Facturas cargadas en un período, con proveedor, total y si ya se cargaron al stock.',
    parameters: obj({ desde: str('AAAA-MM-DD (por defecto, hace 30 días).'), hasta: str('AAAA-MM-DD (por defecto, hoy).'), proveedor: str('Nombre del proveedor (opcional).') }),
    perms: ['invoices'],
    run: async (a, ctx) => {
      const from = ymd(a.desde) ?? ymdAdd(ctx.today, -30);
      const to = ymd(a.hasta) ?? ctx.today;
      const lk = await lookups();
      const products = await db.products.toArray();
      const unitLk = { unit: (id?: string) => (id ? lk.units.find((u) => u.id === id)?.abbreviation ?? '' : '') };
      const rows = (await db.invoices.where('date').between(from, to, true, true).toArray())
        .filter((i) => !s(a.proveedor) || matches(s(a.proveedor), lk.supplier(i.supplierId)))
        .sort((x, y) => y.date.localeCompare(x.date));
      return {
        desde: from, hasta: to, cantidad: rows.length,
        total: rows.reduce((t, i) => t + (i.total ?? 0), 0),
        facturas: rows.slice(0, 40).map((i) => ({ fecha: fmtDay(i.date), proveedor: lk.supplier(i.supplierId), numero: i.number, total: i.total, renglones: i.items?.length ?? 0, cargada_al_stock: !!i.stockAppliedAt, renglones_a_revisar: i.items?.length ? pendingCount(i.items, products, unitLk) : undefined })),
      };
    },
  },
  {
    name: 'conteos',
    label: 'Revisó los conteos',
    description: 'Conteos de inventario abiertos: cuántos productos van contados y cuáles faltan.',
    parameters: obj({}),
    perms: ['count.do'],
    run: async (_a, ctx) => {
      const open = (await db.counts.toArray()).filter((c) => c.status === 'abierto');
      const products = new Map((await db.products.toArray()).map((p) => [p.id, p]));
      const out = [];
      for (const c of open) {
        const items = await db.countItems.where('countId').equals(c.id).toArray();
        const missing = items.filter((i) => i.counted === undefined);
        out.push({ id: c.id, nombre: c.name, contados: items.length - missing.length, total: items.length, faltan: missing.slice(0, 40).map((i) => ({ ref: ctx.refs.ref(i.productId), nombre: products.get(i.productId)?.name })) });
      }
      return { abiertos: out };
    },
  },
  {
    name: 'ir_a',
    label: 'Sugirió una pantalla',
    description: 'Muestra un botón para abrir una pantalla de la app (sólo las que la persona puede usar).',
    parameters: obj({ pantalla: str('Pantalla.', Object.keys(SCREENS)) }, ['pantalla']),
    perms: ['stock.view', 'count.do', 'production', 'recipes', 'invoices', 'catalog.manage', 'movements.view', 'admin', 'stock.move', 'export'],
    run: async (a, ctx) => {
      const key = SCREENS[s(a.pantalla)];
      if (!key) throw new ToolError('Esa pantalla no existe.');
      if (!moduleEnabled(key) || !MODULE_PERMISSIONS[key].some((p) => ctx.can(p))) throw new ToolError('Esta persona no tiene acceso a esa pantalla.');
      const label = ctx.settings.menu.find((m) => m.key === key)?.label ?? MODULES.find((m) => m.key === key)?.label ?? key;
      return { link: { to: MODULE_PATH[key], label } };
    },
  },

  // ───────── Cambios (con confirmación) ─────────

  {
    name: 'cargar_factura',
    label: 'Preparó una factura',
    description: 'Guarda en Facturas la factura o remito de la foto que mandó la persona (con la foto, proveedor, número, fecha, total y renglones) y la carga al stock. Usala siempre que manden la foto de una factura o remito de proveedor. Leé TODOS los renglones. Cantidades como figuran: "1.000" con tres decimales es 1; "B"/"BU"/"BTO" es bulto, "CJ" es caja; "X 950 CC" es el tamaño, no las unidades por caja. La persona confirma antes de guardar.',
    parameters: obj({
      proveedor: str('Nombre del proveedor como figura en el comprobante.'),
      numero: str('Número del comprobante (p. ej. "0011-00065063").'),
      fecha: str('Fecha del comprobante AAAA-MM-DD.'),
      total: num('Total del comprobante.'),
      tipo: str('Tipo de comprobante.', ['factura', 'remito']),
      renglones: arr(obj({
        descripcion: str('Texto del renglón tal como figura.'),
        producto: str('Referencia del catálogo (p12) si lo reconocés; vacío si no está en el catálogo.'),
        cantidad: num('Cantidad como figura en el comprobante.'),
        unidad: str('Unidad como figura (u, kg, bulto, caja…).'),
        unidades_por_caja: num('Si viene por caja/bulto y está impreso o la persona lo dijo: unidades que trae.'),
        precio_unitario: num('Precio unitario.'),
        total_renglon: num('Total del renglón.'),
        no_va_al_stock: { type: 'BOOLEAN', description: 'true para fletes, envases, descuentos y cosas que no se controlan en el stock.' },
      }, ['descripcion', 'cantidad']), 'Todos los renglones de productos.'),
      cargar_stock: { type: 'BOOLEAN', description: 'false para guardarla sin cargar al stock (p. ej. si la mercadería ya se cargó antes).' },
    }, ['proveedor', 'renglones']),
    perms: ['invoices'],
    prepare: async (a, ctx) => {
      const images = ctx.images ?? [];
      if (!images.length) throw new ToolError('Para guardar la factura en Facturas hace falta la foto: pedile que la mande (o que la cargue en Facturas).');
      const lk = await lookups();
      const unitLk = { unit: (id?: string) => (id ? lk.units.find((u) => u.id === id)?.abbreviation ?? '' : '') };
      const supplierName = s(a.proveedor);
      const supplier = supplierName ? lk.suppliers.find((x) => normalize(x.name) === normalize(supplierName)) ?? lk.suppliers.find((x) => matches(supplierName, x.name) || matches(x.name, supplierName)) : undefined;
      const number = s(a.numero) || undefined;
      const date = ymd(a.fecha) ?? ctx.today;
      const total = n(a.total);
      const remito = s(a.tipo) === 'remito';
      // La misma factura dos veces (por ejemplo, la foto mandada de nuevo): no se vuelve a cargar.
      if (number) {
        const dupe = (await db.invoices.toArray()).find((i) => i.number && normalize(i.number) === normalize(number) && (!supplier || !i.supplierId || i.supplierId === supplier.id));
        if (dupe) throw new ToolError(`Esa factura (${number}) ya está guardada en Facturas, del ${fmtDay(dupe.date)}${dupe.stockAppliedAt ? ', y ya está cargada al stock' : ''}. No la cargo de nuevo.`);
      }
      const items: InvoiceItem[] = [];
      const lines: string[] = [];
      const notes: string[] = [];
      for (const r of list(a.renglones)) {
        const description = s(r.descripcion) || s(r.producto) || 'Renglón';
        const quantity = n(r.cantidad);
        if (quantity === undefined || quantity <= 0) { notes.push(`Sin cantidad: “${description}”.`); continue; }
        const unit = s(r.unidad) || undefined;
        const base: InvoiceItem = { id: uuid(), description, quantity: round3(quantity), unit, unitPrice: n(r.precio_unitario), lineTotal: n(r.total_renglon), status: 'none' };
        const pack = n(r.unidades_por_caja);
        if (pack && pack >= 1) base.packSize = Math.round(pack);
        if (r.no_va_al_stock === true) {
          items.push({ ...base, status: 'ignored' });
          lines.push(`No va al stock: ${description}`);
          continue;
        }
        let p: Product | undefined;
        if (s(r.producto)) {
          try { p = await resolveProduct(r.producto, ctx); } catch (e) { notes.push(`${description}: ${e instanceof Error ? e.message : String(e)}`); }
        } else notes.push(`“${description}” no está en el catálogo.`);
        if (!p) { items.push(base); lines.push(`Sin producto: ${description}`); continue; }
        const item: InvoiceItem = { ...base, productId: p.id, stockQty: toStockQty(quantity, unit, p, unitLk, base.packSize), status: 'ok' };
        if (needsPackSize(item, p, unitLk)) {
          item.status = 'check';
          notes.push(`Falta cuántas unidades trae cada ${unit ?? 'caja'} de “${p.name}”.`);
          lines.push(`${p.name}: ${fmtNumber(quantity)} ${unit ?? ''} (falta cuántas trae cada uno)`);
        } else {
          lines.push(`+${fmtNumber(item.stockQty!)} ${lk.unit(p.unitId)} · ${p.name}${unit && item.stockQty !== quantity ? ` (${fmtNumber(quantity)} ${unit})` : ''}`);
        }
        items.push(item);
      }
      if (!items.length) throw new ToolError(notes.join(' ') || 'La factura no tiene renglones.');
      const pending = items.filter((i) => i.status === 'none' || i.status === 'check').length;
      const loadable = items.filter((i) => i.status === 'ok' && (i.stockQty ?? 0) > 0);
      const wantStock = a.cargar_stock !== false;
      const canStock = ctx.can('stock.move');
      const willLoad = wantStock && canStock && !pending && loadable.length > 0;
      // ¿Ya entró esta mercadería por otro lado en estos días? (p. ej. cargada antes con el asistente)
      if (willLoad) {
        const recent = await recentIngresos(loadable.map((i) => i.productId!), ['asistente', 'manual'], 10);
        const names = [...new Set(recent.map((r) => r.name))];
        if (names.length) notes.push(`Ojo: en estos días ya entró ${names.slice(0, 4).join(', ')}${names.length > 4 ? ` y ${names.length - 4} más` : ''} sin factura. Si es la misma mercadería, guardala sin cargar al stock.`);
      }
      const head = [supplier?.name ?? (supplierName ? `${supplierName} (proveedor nuevo)` : 'Sin proveedor'), number, fmtDay(date), total !== undefined ? fmtMoney(total) : undefined].filter(Boolean).join(' · ');
      const how = willLoad ? 'Se guarda en Facturas con la foto y se carga al stock.'
        : !wantStock ? 'Se guarda en Facturas con la foto, sin cargar al stock.'
        : !canStock ? 'Se guarda en Facturas con la foto; cargarla al stock lo hace alguien con permiso.'
        : pending ? `Se guarda en Facturas con la foto. El stock se carga cuando se revisen ${pending === 1 ? 'el renglón pendiente' : `los ${pending} renglones pendientes`} (en Facturas).`
        : 'Se guarda en Facturas con la foto.';
      return {
        title: willLoad ? `Guardar ${remito ? 'el remito' : 'la factura'} y cargarla al stock` : `Guardar ${remito ? 'el remito' : 'la factura'} en Facturas`,
        lines: [head, ...lines, how],
        notes,
        execute: async () => {
          if (!ctx.can('invoices')) throw new ToolError('Ya no tenés permiso para cargar facturas.');
          if (number && (await db.invoices.toArray()).some((i) => i.number && normalize(i.number) === normalize(number) && (!supplier || !i.supplierId || i.supplierId === supplier.id))) {
            throw new ToolError('Esa factura ya está guardada.');
          }
          const supplierId = supplier?.id ?? (supplierName ? (await saveEntity(db.suppliers, { name: supplierName })).id : undefined);
          const pages: PageDraft[] = images.slice(0, 6).map((img) => ({
            id: newPageId(),
            image: { data: img.data, type: 'image/jpeg', width: img.width ?? 0, height: img.height ?? 0, bytes: img.bytes ?? base64Bytes(img.data), thumb: img.thumb },
          }));
          const inv = await saveInvoice({
            date, supplierId, number, total, pages, items, aiReadAt: new Date().toISOString(),
            notes: `${remito ? 'Remito cargado' : 'Cargada'} con el Asistente IA`,
          });
          await learnFromInvoice(items);
          let loaded = 0;
          if (willLoad && ctx.can('stock.move')) loaded = (await applyInvoiceToStock(inv.id)).applied;
          return {
            result: { ok: true, guardada_en_facturas: true, cargada_al_stock: loaded > 0, productos_cargados: loaded, renglones_a_revisar: pending },
            done: loaded ? `Guardada en Facturas y cargada al stock (${loaded} ${loaded === 1 ? 'producto' : 'productos'})` : 'Guardada en Facturas',
            undo: async () => {
              const cur = await db.invoices.get(inv.id);
              if (!cur) return 'Deshecho: la factura ya no estaba';
              if (cur.stockAppliedAt) await undoInvoiceStock(inv.id);
              await deleteInvoice(inv.id);
              return loaded ? 'Deshecho: se sacó del stock y se borró la factura' : 'Deshecho: se borró la factura';
            },
          };
        },
      };
    },
  },
  {
    name: 'registrar_movimientos',
    label: 'Preparó movimientos de stock',
    description: 'Registra movimientos de stock sin comprobante: salidas, mermas, consumos, ajuste a una cantidad, o mercadería que entró sin factura ni remito. Si la persona manda la foto de una factura o remito, NO uses esta: usá cargar_factura. La persona confirma antes de aplicar.',
    parameters: obj({
      movimientos: arr(obj({
        producto: str('Referencia (p12) o nombre.'),
        tipo: str('ingreso suma, salida/perdida/consumo restan, ajuste deja el stock en la cantidad indicada.', ['ingreso', 'salida', 'perdida', 'consumo', 'ajuste']),
        cantidad: num('Cantidad positiva.'),
        unidad: str('"stock" (la unidad del producto) o "compra" (cajas/bultos: se multiplica por las unidades por caja).', ['stock', 'compra']),
        motivo: str('Motivo corto (opcional).'),
      }, ['producto', 'tipo', 'cantidad']), 'Uno o más movimientos (máximo 60).'),
      referencia: str('Referencia general, p. ej. "Remito 0001-123 Distribuidora X" (opcional).'),
    }, ['movimientos']),
    perms: ['stock.move'],
    prepare: async (a, ctx) => {
      const rows = list(a.movimientos);
      if (!rows.length) throw new ToolError('No hay movimientos para registrar.');
      if (rows.length > 60) throw new ToolError('Máximo 60 movimientos por vez.');
      const lk = await lookups();
      const plan: { p: Product; type: MovementType; qty: number; reason: string }[] = [];
      const notes: string[] = [];
      const projected = new Map<string, number>();
      for (const r of rows) {
        let p: Product;
        try { p = await resolveProduct(r.producto, ctx); } catch (e) { notes.push(e instanceof Error ? e.message : String(e)); continue; }
        const tipo = s(r.tipo);
        const type = (['ingreso', 'salida', 'perdida', 'consumo', 'ajuste'].includes(tipo) ? tipo : '') as MovementType;
        const raw = n(r.cantidad);
        if (!type || raw === undefined || raw < 0 || (raw === 0 && type !== 'ajuste')) { notes.push(`Cantidad o tipo inválido para “${p.name}”.`); continue; }
        const qty = stockQty(p, raw, r.unidad);
        const reason = s(r.motivo) || s(a.referencia) || 'Asistente IA';
        plan.push({ p, type, qty, reason });
      }
      if (!plan.length) throw new ToolError(notes.join(' ') || 'No hay movimientos válidos.');
      // Remito de algo que ya entró por factura en estos días: se avisa (puede ser la misma mercadería).
      const viaInvoice = await recentIngresos(plan.filter((x) => x.type === 'ingreso').map((x) => x.p.id), ['factura'], 10);
      for (const id of new Set(viaInvoice.map((r) => r.productId))) {
        const r = viaInvoice.find((x) => x.productId === id)!;
        notes.push(`“${r.name}” ya entró por ${r.reason ?? 'una factura'} el ${new Date(r.at).toLocaleDateString('es-AR')} (+${fmtNumber(r.qty)}): fijate que no sea la misma mercadería.`);
      }
      const lines = plan.map(({ p, type, qty }) => {
        const before = projected.get(p.id) ?? p.stock;
        const after = type === 'ajuste' ? qty : type === 'ingreso' ? before + qty : before - qty;
        projected.set(p.id, round3(after));
        const sign = type === 'ajuste' ? `queda en ${fmtNumber(qty)}` : `${type === 'ingreso' ? '+' : '−'}${fmtNumber(qty)}`;
        return `${MOVEMENT_LABEL[type]} ${sign} ${lk.unit(p.unitId)} · ${p.name} (${fmtNumber(before)} → ${fmtNumber(round3(after))})`;
      });
      return {
        title: plan.length === 1 ? 'Registrar 1 movimiento' : `Registrar ${plan.length} movimientos`,
        lines, notes,
        execute: async (key) => {
          if (!ctx.can('stock.move')) throw new ToolError('Ya no tenés permiso para registrar movimientos.');
          const created = await db.transaction('rw', db.products, db.movements, async () => {
            const out: StockMovement[] = [];
            let i = 0;
            for (const { p, type, qty, reason } of plan) {
              const r = await applyMovement({
                productId: p.id, type,
                ...(type === 'ajuste' ? { newQuantity: qty } : { delta: type === 'ingreso' ? qty : -qty }),
                origin: 'asistente', reason, idempotencyKey: `${key}:${i++}`,
              });
              if (!r.duplicate) out.push(r.movement);
            }
            return out;
          });
          const done = plan.length;
          const after = await db.products.bulkGet(plan.map((x) => x.p.id));
          return {
            result: { ok: true, registrados: done, stock_actual: after.map((p) => p && { producto: p.name, stock: p.stock }) },
            done: done === 1 ? 'Registrado 1 movimiento' : `Registrados ${done} movimientos`,
            undo: async () => {
              if (!ctx.can('stock.move')) throw new ToolError('No tenés permiso para registrar movimientos.');
              await db.transaction('rw', db.products, db.movements, async () => {
                for (const m of [...created].reverse()) await revertMovement(m);
              });
              return `Deshecho: el stock volvió a como estaba (${created.length} ${created.length === 1 ? 'movimiento revertido' : 'movimientos revertidos'})`;
            },
          };
        },
      };
    },
  },
  {
    name: 'cargar_conteo',
    label: 'Preparó cantidades del conteo',
    description: 'Anota lo contado (p. ej. lo que la persona dicta: "12 cocas, 3 cajas de aceite"). Si hay un solo conteo abierto se usa ese; si no hay ninguno, se empieza uno nuevo con esos productos. La persona confirma antes de guardar.',
    parameters: obj({
      conteo: str('Id o nombre del conteo (opcional si hay uno solo abierto).'),
      cantidades: arr(obj({ producto: str('Referencia o nombre.'), cantidad: num('Cantidad contada.'), unidad: str('"stock" o "compra" (cajas: se multiplica).', ['stock', 'compra']) }, ['producto', 'cantidad']), 'Lo contado.'),
    }, ['cantidades']),
    perms: ['count.do'],
    prepare: async (a, ctx) => {
      const open = (await db.counts.toArray()).filter((c) => c.status === 'abierto');
      const wanted = s(a.conteo);
      let count: InventoryCount | undefined;
      if (wanted) {
        count = open.find((c) => c.id === wanted || normalize(c.name) === normalize(wanted)) ?? open.find((c) => matches(wanted, c.name));
        if (!count) throw new ToolError(`No hay un conteo abierto que se llame “${wanted}”.${open.length ? ` Abiertos: ${open.map((c) => `“${c.name}”`).join(', ')}.` : ''}`);
      } else if (open.length === 1) count = open[0];
      else if (open.length > 1) throw new ToolError(`Hay ${open.length} conteos abiertos: ${open.map((c) => `“${c.name}”`).join(', ')}. Preguntá en cuál anotar.`);
      // Sin conteo abierto: se empieza uno nuevo sólo con lo que se dictó (después se aplica en Conteo).
      const items = count ? await db.countItems.where('countId').equals(count.id).toArray() : [];
      const byProduct = new Map(items.map((i) => [i.productId, i]));
      const lk = await lookups();
      const plan = new Map<string, { p: Product; qty: number; before?: number }>();
      const notes: string[] = [];
      for (const r of list(a.cantidades)) {
        let p: Product;
        try { p = await resolveProduct(r.producto, ctx); } catch (e) { notes.push(e instanceof Error ? e.message : String(e)); continue; }
        const raw = n(r.cantidad);
        if (raw === undefined || raw < 0) { notes.push(`Cantidad inválida para “${p.name}”.`); continue; }
        const item = byProduct.get(p.id);
        if (count && !item) { notes.push(`“${p.name}” no está en “${count.name}”.`); continue; }
        if (plan.has(p.id)) notes.push(`“${p.name}” se dijo dos veces: queda la última cantidad.`);
        plan.set(p.id, { p, qty: stockQty(p, raw, r.unidad), before: item?.counted });
      }
      if (!plan.size) throw new ToolError(notes.join(' ') || 'No hay cantidades para anotar.');
      const rows = [...plan.values()];
      const lines = rows.map(({ p, qty, before }) => `${p.name}: ${fmtNumber(qty)} ${lk.unit(p.unitId)}${before !== undefined ? ` (antes ${fmtNumber(before)})` : ''}`);
      return {
        title: count ? `Anotar en “${count.name}”` : `Empezar un conteo nuevo con ${rows.length} ${rows.length === 1 ? 'producto' : 'productos'}`,
        lines,
        notes: count ? notes : [...notes, 'No había ningún conteo abierto: se crea uno con estos productos. Para que cambie el stock, después hay que aplicarlo en Conteo.'],
        execute: async () => {
          if (!ctx.can('count.do')) throw new ToolError('Ya no tenés permiso para contar.');
          let target = count;
          if (target) {
            const fresh = await db.counts.get(target.id);
            if (fresh?.status !== 'abierto') throw new ToolError('El conteo ya no está abierto.');
          } else {
            target = await startCount({ name: `Conteo dictado ${new Date().toLocaleDateString('es-AR')}`, productIds: rows.map((r) => r.p.id) });
          }
          const its = await db.countItems.where('countId').equals(target.id).toArray();
          const itemOf = new Map(its.map((i) => [i.productId, i]));
          const prev = new Map<string, number | undefined>();
          for (const r of rows) {
            const it = itemOf.get(r.p.id);
            if (!it) continue;
            prev.set(it.id, it.counted);
            await setCounted(it.id, r.qty);
          }
          const after = await db.countItems.where('countId').equals(target.id).toArray();
          const counted = after.filter((i) => i.counted !== undefined).length;
          const created = !count;
          const countId = target.id;
          return {
            result: { ok: true, conteo: target.name, conteo_nuevo: created, anotados: prev.size, contados: counted, total: after.length },
            done: `${created ? `Conteo “${target.name}” creado. ` : ''}Anotados ${prev.size} · van ${counted} de ${after.length}`,
            undo: async () => {
              const c = await db.counts.get(countId);
              if (c?.status !== 'abierto') throw new ToolError('El conteo ya no está abierto: corregilo desde Conteo.');
              if (created) { await discardCount(countId); return 'Deshecho: se descartó el conteo nuevo'; }
              for (const [itemId, v] of prev) await setCounted(itemId, v);
              return 'Deshecho: las cantidades volvieron a como estaban';
            },
          };
        },
      };
    },
  },
  {
    name: 'crear_producto',
    label: 'Preparó un producto nuevo',
    description: 'Crea un producto en el catálogo. Antes, verificá con buscar_productos que no exista. La persona confirma antes de crearlo.',
    parameters: obj({
      nombre: str('Nombre claro (p. ej. "Amargo Obrero 950 cc").'),
      familia: str('Nombre de una familia existente (opcional).'),
      unidad: str('Unidad de stock: abreviatura o nombre de una unidad existente (u, kg, g, l…). Por defecto "u".'),
      unidades_por_caja: num('Si se compra por caja/bulto: cuántas unidades trae (opcional).'),
      minimo: num('Stock mínimo (opcional).'),
      maximo: num('Stock máximo (opcional).'),
      proveedor: str('Nombre de un proveedor existente (opcional).'),
    }, ['nombre']),
    perms: ['catalog.manage'],
    prepare: async (a, ctx) => {
      const name = s(a.nombre);
      if (!name) throw new ToolError('Falta el nombre.');
      const all = await db.products.toArray();
      const dupe = all.find((p) => p.active && normalize(p.name) === normalize(name));
      if (dupe) throw new ToolError(`Ya existe “${dupe.name}” (${ctx.refs.ref(dupe.id)}).`);
      const lk = await lookups();
      const notes: string[] = [];
      const fam = s(a.familia) ? lk.categories.find((c) => normalize(c.name) === normalize(s(a.familia))) ?? lk.categories.find((c) => matches(s(a.familia), c.name)) : undefined;
      if (s(a.familia) && !fam) notes.push(`No existe la familia “${s(a.familia)}”: queda sin familia.`);
      const unit = findUnit(lk.units, s(a.unidad) || 'u');
      if (!unit) throw new ToolError(`No existe la unidad “${s(a.unidad)}”. Unidades: ${lk.units.map((u) => u.abbreviation).join(', ')}.`);
      const sup = s(a.proveedor) ? lk.suppliers.find((x) => normalize(x.name) === normalize(s(a.proveedor))) ?? lk.suppliers.find((x) => matches(s(a.proveedor), x.name)) : undefined;
      if (s(a.proveedor) && !sup) notes.push(`No existe el proveedor “${s(a.proveedor)}”: queda sin proveedor.`);
      const pack = Math.round(n(a.unidades_por_caja) ?? 1);
      const min = Math.max(0, n(a.minimo) ?? 0);
      const max = Math.max(0, n(a.maximo) ?? 0);
      const caja = findUnit(lk.units, 'caja');
      const lines = [
        `Nombre: ${name}`,
        `Se cuenta en: ${unit.name} (${unit.abbreviation})`,
        ...(fam ? [`Familia: ${fam.name}`] : []),
        ...(pack > 1 ? [`Se compra por caja de ${pack}`] : []),
        ...(min || max ? [`Mínimo ${fmtNumber(min)}${max ? ` · máximo ${fmtNumber(max)}` : ''}`] : []),
        ...(sup ? [`Proveedor: ${sup.name}`] : []),
      ];
      return {
        title: 'Crear producto',
        lines, notes,
        execute: async () => {
          if (!ctx.can('catalog.manage')) throw new ToolError('Ya no tenés permiso para crear productos.');
          const again = (await db.products.toArray()).find((p) => p.active && normalize(p.name) === normalize(name));
          if (again) return { result: { ok: true, ref: ctx.refs.ref(again.id), ya_existia: true }, done: `Ya existía “${again.name}”` };
          const p = await saveProduct({
            ...emptyProduct(), name, unitId: unit.id, categoryId: fam?.id, supplierId: sup?.id,
            purchaseFactor: pack > 1 ? pack : 1, purchaseUnitId: pack > 1 ? caja?.id : undefined, minStock: min, maxStock: max,
          });
          return {
            result: { ok: true, ref: ctx.refs.add(p.id), nombre: p.name }, done: `Creado “${p.name}”`,
            undo: async () => {
              const used = (await db.movements.where('productId').equals(p.id).count()) > 0 || (await db.products.toArray()).some((x) => x.recipe?.items.some((i) => i.productId === p.id));
              if (used) throw new ToolError('Ya se usó (tiene movimientos o está en una receta): desactivalo desde Productos.');
              await deleteProduct(p.id);
              return `Deshecho: se borró “${p.name}”`;
            },
          };
        },
      };
    },
  },
  {
    name: 'actualizar_producto',
    label: 'Preparó cambios en un producto',
    description: 'Cambia datos de un producto: mínimo, máximo, unidades por caja, familia, proveedor o nombre. La persona confirma antes de guardar.',
    parameters: obj({
      producto: str('Referencia o nombre.'),
      nombre: str('Nombre nuevo (opcional).'),
      minimo: num('Stock mínimo (opcional).'),
      maximo: num('Stock máximo (opcional).'),
      unidades_por_caja: num('Unidades por caja/bulto (opcional).'),
      familia: str('Familia existente (opcional).'),
      proveedor: str('Proveedor existente (opcional).'),
    }, ['producto']),
    perms: ['catalog.manage'],
    prepare: async (a, ctx) => {
      const p = await resolveProduct(a.producto, ctx);
      const lk = await lookups();
      const patch: Partial<Product> = {};
      const lines: string[] = [];
      const notes: string[] = [];
      if (s(a.nombre) && s(a.nombre) !== p.name) { patch.name = s(a.nombre); lines.push(`Nombre: ${p.name} → ${patch.name}`); }
      const min = n(a.minimo), max = n(a.maximo), pack = n(a.unidades_por_caja);
      if (min !== undefined && min >= 0) { patch.minStock = min; lines.push(`Mínimo: ${fmtNumber(p.minStock)} → ${fmtNumber(min)}`); }
      if (max !== undefined && max >= 0) { patch.maxStock = max; lines.push(`Máximo: ${fmtNumber(p.maxStock)} → ${fmtNumber(max)}`); }
      if (pack !== undefined && pack >= 1) {
        patch.purchaseFactor = Math.round(pack);
        if (pack > 1 && !p.purchaseUnitId) patch.purchaseUnitId = findUnit(lk.units, 'caja')?.id;
        lines.push(`Unidades por caja: ${fmtNumber(p.purchaseFactor)} → ${fmtNumber(Math.round(pack))}`);
      }
      if (s(a.familia)) {
        const fam = lk.categories.find((c) => normalize(c.name) === normalize(s(a.familia))) ?? lk.categories.find((c) => matches(s(a.familia), c.name));
        if (fam) { patch.categoryId = fam.id; lines.push(`Familia: ${lk.category(p.categoryId) ?? '—'} → ${fam.name}`); } else notes.push(`No existe la familia “${s(a.familia)}”.`);
      }
      if (s(a.proveedor)) {
        const sup = lk.suppliers.find((x) => normalize(x.name) === normalize(s(a.proveedor))) ?? lk.suppliers.find((x) => matches(s(a.proveedor), x.name));
        if (sup) { patch.supplierId = sup.id; lines.push(`Proveedor: ${lk.supplier(p.supplierId) ?? '—'} → ${sup.name}`); } else notes.push(`No existe el proveedor “${s(a.proveedor)}”.`);
      }
      if (!lines.length) throw new ToolError(notes.join(' ') || 'No hay cambios para hacer.');
      return {
        title: `Cambiar “${p.name}”`,
        lines, notes,
        execute: async () => {
          if (!ctx.can('catalog.manage')) throw new ToolError('Ya no tenés permiso para editar productos.');
          const cur = await db.products.get(p.id);
          if (!cur) throw new ToolError('El producto ya no existe.');
          const before = Object.fromEntries(Object.keys(patch).map((k) => [k, cur[k as keyof Product]])) as Partial<Product>;
          await saveProduct({ ...cur, ...patch });
          return {
            result: { ok: true }, done: `Guardado “${patch.name ?? p.name}”`,
            undo: async () => {
              const now = await db.products.get(p.id);
              if (!now) throw new ToolError('El producto ya no existe.');
              await saveProduct({ ...now, ...before });
              return 'Deshecho: el producto volvió a como estaba';
            },
          };
        },
      };
    },
  },
  {
    name: 'guardar_receta',
    label: 'Preparó una receta',
    description: 'Guarda (o reemplaza) la receta de un producto: cuánto rinde una tanda y qué insumos lleva, en la unidad de stock de cada insumo. Los insumos tienen que existir en el catálogo. La persona confirma antes de guardar.',
    parameters: obj({
      producto: str('Producto que se elabora (referencia o nombre).'),
      rinde: num('Cuánto sale por tanda, en la unidad del producto.'),
      insumos: arr(obj({ producto: str('Insumo (referencia o nombre).'), cantidad: num('Cantidad por tanda, en la unidad de stock del insumo.'), unidad: str('"stock" o "compra".', ['stock', 'compra']) }, ['producto', 'cantidad']), 'Insumos.'),
    }, ['producto', 'rinde', 'insumos']),
    perms: ['recipes', 'catalog.manage'],
    prepare: async (a, ctx) => {
      const p = await resolveProduct(a.producto, ctx);
      const yieldQty = n(a.rinde);
      if (!yieldQty || yieldQty <= 0) throw new ToolError('Falta cuánto rinde la receta.');
      const lk = await lookups();
      const items: { productId: string; quantity: number }[] = [];
      const lines = [`Rinde ${fmtNumber(yieldQty)} ${lk.unit(p.unitId)} por tanda`];
      const notes: string[] = [];
      for (const r of list(a.insumos)) {
        let ing: Product;
        try { ing = await resolveProduct(r.producto, ctx); } catch (e) { notes.push(e instanceof Error ? e.message : String(e)); continue; }
        if (ing.id === p.id) { notes.push('Un producto no puede ser insumo de sí mismo.'); continue; }
        const raw = n(r.cantidad);
        if (!raw || raw <= 0) { notes.push(`Falta la cantidad de “${ing.name}”.`); continue; }
        const qty = stockQty(ing, raw, r.unidad);
        const prev = items.find((i) => i.productId === ing.id);
        if (prev) prev.quantity = round3(prev.quantity + qty);
        else items.push({ productId: ing.id, quantity: qty });
        lines.push(`${ing.name}: ${fmtNumber(qty)} ${lk.unit(ing.unitId)}`);
      }
      if (!items.length) throw new ToolError(notes.join(' ') || 'La receta no tiene insumos válidos.');
      if (notes.length) throw new ToolError(`Antes de guardar hay que resolver: ${notes.join(' ')} Si falta un insumo en el catálogo, se puede crear con crear_producto.`);
      return {
        title: p.recipe ? `Reemplazar la receta de “${p.name}”` : `Guardar la receta de “${p.name}”`,
        lines,
        execute: async () => {
          if (!ctx.can('recipes') && !ctx.can('catalog.manage')) throw new ToolError('Ya no tenés permiso para editar recetas.');
          const cur = await db.products.get(p.id);
          if (!cur) throw new ToolError('El producto ya no existe.');
          const previous = cur.recipe;
          await saveProduct({ ...cur, recipe: { yield: yieldQty, items } });
          return {
            result: { ok: true, insumos: items.length }, done: `Receta guardada (${items.length} insumos)`,
            undo: async () => {
              const now = await db.products.get(p.id);
              if (!now) throw new ToolError('El producto ya no existe.');
              await saveProduct({ ...now, recipe: previous });
              return previous ? 'Deshecho: volvió la receta anterior' : 'Deshecho: el producto quedó sin receta';
            },
          };
        },
      };
    },
  },
  {
    name: 'anotar_produccion',
    label: 'Preparó una producción',
    description: 'Anota lo que se produjo (panadería, cocina): suma al producto y, si tiene receta, descuenta los insumos. La persona confirma antes de anotar.',
    parameters: obj({ producto: str('Referencia o nombre.'), cantidad: num('Cantidad producida, en la unidad del producto.') }, ['producto', 'cantidad']),
    perms: ['production'],
    prepare: async (a, ctx) => {
      const p = await resolveProduct(a.producto, ctx);
      const qty = n(a.cantidad);
      if (!qty || qty <= 0) throw new ToolError('Falta cuánto se produjo.');
      const lk = await lookups();
      const products = new Map((await db.products.toArray()).map((x) => [x.id, x]));
      const used = recipeConsumption(p, qty, products);
      return {
        title: `Anotar producción de “${p.name}”`,
        lines: [`+${fmtNumber(qty)} ${lk.unit(p.unitId)} · ${p.name}`, ...used.map((c) => `Descuenta ${fmtNumber(c.quantity)} ${lk.unit(products.get(c.productId)?.unitId)} · ${c.name}`)],
        notes: p.recipe ? [] : ['No tiene receta: sólo se suma lo producido.'],
        execute: async () => {
          if (!ctx.can('production')) throw new ToolError('Ya no tenés permiso para anotar producción.');
          const r = await registerProduction(p.id, qty);
          return {
            result: { ok: true, insumos_descontados: r.consumed.length }, done: `Anotado: ${fmtNumber(qty)} ${lk.unit(p.unitId)} de ${p.name}`,
            undo: async () => {
              if (!ctx.can('production')) throw new ToolError('No tenés permiso para anotar producción.');
              await undoProduction(r.movement);
              return 'Deshecho: se sacó la producción y volvieron los insumos';
            },
          };
        },
      };
    },
  },
];

function findUnit(units: Unit[], text: string): Unit | undefined {
  const t = normalize(text);
  return units.find((u) => normalize(u.abbreviation) === t) ?? units.find((u) => normalize(u.name) === t) ?? units.find((u) => normalize(u.name).startsWith(t));
}

/** Herramientas que esta persona puede usar. */
export const toolsFor = (can: (p: Permission) => boolean) => TOOLS.filter((t) => t.perms.some((p) => can(p)));

