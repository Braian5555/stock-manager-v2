/**
 * Herramientas del asistente: lo que la IA puede consultar o hacer dentro de la app.
 *
 * - Cada herramienta declara qué permisos la habilitan: a la IA sólo se le ofrecen las que la
 *   persona puede usar, y se vuelve a verificar al ejecutarla.
 * - Las que cambian datos no se ejecutan solas: devuelven una propuesta que la persona confirma
 *   en pantalla. Recién ahí se aplica (con clave fija, así un doble toque no duplica nada).
 */
import { db } from '../../database/db';
import type { InventoryCount, MovementType, Permission, Product, Settings, Unit } from '../../models';
import { MODULE_PATH, MODULE_PERMISSIONS, moduleEnabled } from '../../layouts/modules';
import { fmtDay, fmtMoney, fmtNumber, matches, normalize, round3 } from '../../utils/format';
import { MODULES } from '../settingsService';
import { setCounted } from '../countService';
import { pendingCount, similarity } from '../invoiceAI';
import { suggestOrders } from '../orderService';
import { priceHistory, priceIncreases } from '../priceService';
import { emptyProduct, saveProduct } from '../productService';
import { recipeConsumption, registerProduction } from '../productionService';
import { applyMovement, MOVEMENT_LABEL, statusOf, STATUS_LABEL } from '../stockService';
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
}

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
  /** Aplica los cambios. Devuelve el resultado para la IA y un texto corto para la pantalla. */
  execute: (key: string) => Promise<{ result: unknown; done: string }>;
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
    if (p) return p;
  }
  const all = (await db.products.toArray()).filter((p) => p.active);
  const exact = all.find((p) => normalize(p.name) === normalize(text));
  if (exact) return exact;
  let best: Product | undefined;
  let score = 0;
  for (const p of all) {
    const sc = similarity(text, p.name);
    if (sc > score) { score = sc; best = p; }
  }
  if (best && score >= 0.6) return best;
  throw new ToolError(`No encontré el producto “${text}”. Pedile a la persona que lo confirme o buscalo con buscar_productos.`);
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
    description: 'Productos en o por debajo del mínimo con la cantidad sugerida a pedir (en unidad de compra), agrupados por proveedor. Para armar pedidos o mensajes a proveedores.',
    parameters: obj({ proveedor: str('Nombre del proveedor para filtrar (opcional).') }),
    perms: ['stock.view'],
    run: async (a, ctx) => {
      const lk = await lookups();
      const groups = suggestOrders(await db.products.toArray(), ctx.settings);
      const f = s(a.proveedor);
      return {
        criterio: ctx.settings.suggestionMode === 'toMax' ? 'completar hasta el máximo' : 'completar hasta el mínimo',
        proveedores: groups
          .map((g) => ({
            proveedor: lk.supplier(g.supplierId) ?? 'Sin proveedor',
            productos: g.lines.map((l) => ({
              ref: ctx.refs.ref(l.product.id), nombre: l.product.name, stock: l.product.stock, minimo: l.product.minStock,
              falta: `${fmtNumber(l.needed)} ${lk.unit(l.product.unitId)}`,
              pedir: `${fmtNumber(l.quantity)} ${l.product.purchaseFactor > 1 ? `${lk.unit(l.product.purchaseUnitId) === 'u' ? 'caja' : lk.unit(l.product.purchaseUnitId)} (x${l.product.purchaseFactor})` : lk.unit(l.product.unitId)}`,
            })),
          }))
          .filter((g) => !f || matches(f, g.proveedor)),
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
    name: 'registrar_movimientos',
    label: 'Preparó movimientos de stock',
    description: 'Registra movimientos de stock (mercadería que entra, salidas, mermas, consumos o ajuste a una cantidad). Para remitos o compras sin factura, varios renglones juntos. La persona confirma antes de aplicar.',
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
          const done = await db.transaction('rw', db.products, db.movements, async () => {
            let i = 0;
            for (const { p, type, qty, reason } of plan) {
              await applyMovement({
                productId: p.id, type,
                ...(type === 'ajuste' ? { newQuantity: qty } : { delta: type === 'ingreso' ? qty : -qty }),
                origin: 'asistente', reason, idempotencyKey: `${key}:${i++}`,
              });
            }
            return i;
          });
          const after = await db.products.bulkGet(plan.map((x) => x.p.id));
          return { result: { ok: true, registrados: done, stock_actual: after.map((p) => p && { producto: p.name, stock: p.stock }) }, done: `Registrados ${done} ${done === 1 ? 'movimiento' : 'movimientos'}` };
        },
      };
    },
  },
  {
    name: 'cargar_conteo',
    label: 'Preparó cantidades del conteo',
    description: 'Anota lo contado en un conteo abierto (p. ej. lo que la persona dicta: "12 cocas, 3 cajas de aceite"). Si hay un solo conteo abierto se usa ese. La persona confirma antes de guardar.',
    parameters: obj({
      conteo: str('Id o nombre del conteo (opcional si hay uno solo abierto).'),
      cantidades: arr(obj({ producto: str('Referencia o nombre.'), cantidad: num('Cantidad contada.'), unidad: str('"stock" o "compra" (cajas: se multiplica).', ['stock', 'compra']) }, ['producto', 'cantidad']), 'Lo contado.'),
    }, ['cantidades']),
    perms: ['count.do'],
    prepare: async (a, ctx) => {
      const open = (await db.counts.toArray()).filter((c) => c.status === 'abierto');
      const wanted = s(a.conteo);
      let count: InventoryCount | undefined;
      if (wanted) count = open.find((c) => c.id === wanted || normalize(c.name) === normalize(wanted)) ?? open.find((c) => matches(wanted, c.name));
      else if (open.length === 1) count = open[0];
      if (!count) {
        if (!open.length) throw new ToolError('No hay conteos abiertos. Hay que empezar uno en Conteo.');
        throw new ToolError(`Hay ${open.length} conteos abiertos: ${open.map((c) => `“${c.name}”`).join(', ')}. Preguntá en cuál anotar.`);
      }
      const items = await db.countItems.where('countId').equals(count.id).toArray();
      const byProduct = new Map(items.map((i) => [i.productId, i]));
      const lk = await lookups();
      const plan: { itemId: string; qty: number }[] = [];
      const lines: string[] = [];
      const notes: string[] = [];
      for (const r of list(a.cantidades)) {
        let p: Product;
        try { p = await resolveProduct(r.producto, ctx); } catch (e) { notes.push(e instanceof Error ? e.message : String(e)); continue; }
        const raw = n(r.cantidad);
        if (raw === undefined || raw < 0) { notes.push(`Cantidad inválida para “${p.name}”.`); continue; }
        const item = byProduct.get(p.id);
        if (!item) { notes.push(`“${p.name}” no está en este conteo.`); continue; }
        const qty = stockQty(p, raw, r.unidad);
        plan.push({ itemId: item.id, qty });
        lines.push(`${p.name}: ${fmtNumber(qty)} ${lk.unit(p.unitId)}${item.counted !== undefined ? ` (antes ${fmtNumber(item.counted)})` : ''}`);
      }
      if (!plan.length) throw new ToolError(notes.join(' ') || 'No hay cantidades para anotar.');
      return {
        title: `Anotar en “${count.name}”`,
        lines, notes,
        execute: async () => {
          if (!ctx.can('count.do')) throw new ToolError('Ya no tenés permiso para contar.');
          const fresh = await db.counts.get(count.id);
          if (fresh?.status !== 'abierto') throw new ToolError('El conteo ya no está abierto.');
          for (const x of plan) await setCounted(x.itemId, x.qty);
          const after = await db.countItems.where('countId').equals(count.id).toArray();
          const counted = after.filter((i) => i.counted !== undefined).length;
          return { result: { ok: true, anotados: plan.length, contados: counted, total: after.length }, done: `Anotados ${plan.length} · van ${counted} de ${after.length}` };
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
          return { result: { ok: true, ref: ctx.refs.add(p.id), nombre: p.name }, done: `Creado “${p.name}”` };
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
          await saveProduct({ ...cur, ...patch });
          return { result: { ok: true }, done: `Guardado “${patch.name ?? p.name}”` };
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
          await saveProduct({ ...cur, recipe: { yield: yieldQty, items } });
          return { result: { ok: true, insumos: items.length }, done: `Receta guardada (${items.length} insumos)` };
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
          return { result: { ok: true, insumos_descontados: r.consumed.length }, done: `Anotado: ${fmtNumber(qty)} ${lk.unit(p.unitId)} de ${p.name}` };
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

