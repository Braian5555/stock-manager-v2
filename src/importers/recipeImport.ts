import { db } from '../database/db';
import type { Product, Recipe, RecipeItem } from '../models';
import { normalize, parseNumber, round3 } from '../utils/format';
import { nowIso } from '../utils/id';
import type { Tabular } from './tabular';

/**
 * Importa recetas exportadas de Maxirest ("recetas de insumos" / "recetas de artículos").
 * Columnas: codigo, nombre, porciones, unidad_med, cantidad, cod_ins, nombreins, medidains,
 * neto1, envase1. Cada fila es un insumo de la receta del producto `codigo`.
 * Las cantidades se pasan a la unidad de stock de cada producto (gr → kg, ml → l, envases…).
 */

type Dim = 'mass' | 'vol' | 'count';
const UNIT: Record<string, [Dim, number]> = {
  kg: ['mass', 1000], kilo: ['mass', 1000], kilos: ['mass', 1000], kilogramo: ['mass', 1000], kilogramos: ['mass', 1000],
  g: ['mass', 1], gr: ['mass', 1], grs: ['mass', 1], gramo: ['mass', 1], gramos: ['mass', 1],
  l: ['vol', 1000], lt: ['vol', 1000], lts: ['vol', 1000], litro: ['vol', 1000], litros: ['vol', 1000],
  ml: ['vol', 1], cc: ['vol', 1], mililitro: ['vol', 1], mililitros: ['vol', 1],
  u: ['count', 1], ud: ['count', 1], uds: ['count', 1], un: ['count', 1], unidad: ['count', 1], unidades: ['count', 1],
};
const unitInfo = (s?: string) => UNIT[normalize(s).replace(/\.$/, '')];
const firstWord = (s?: string) => normalize(s).split(/[\s,.(]+/)[0] ?? '';
/** "bolsas" ~ "bolsa", "bot" ~ "botella". */
const sameWord = (a: string, b: string) => !!a && !!b && (a === b || a.startsWith(b) || b.startsWith(a) || a.replace(/e?s$/, '') === b.replace(/e?s$/, ''));

/**
 * Convierte `qty` expresada en `from` a la unidad de stock `to` (abreviatura y nombre).
 * `pack` = contenido de un envase en la unidad `from` (neto1/envase1 de Maxirest).
 */
export function convertQty(qty: number, from: string, to: { abbr: string; name: string }, pack?: { size: number; name: string }): number | undefined {
  const f = unitInfo(from);
  const t = unitInfo(to.abbr) ?? unitInfo(to.name);
  if (f && t && f[0] === t[0]) return round3((qty * f[1]) / t[1]);
  // Unidad de stock = envase (botella, paquete…) y Maxirest informa cuánto trae.
  if (f && !t && pack && pack.size > 0 && (sameWord(firstWord(pack.name), firstWord(to.abbr)) || sameWord(firstWord(pack.name), firstWord(to.name)))) return round3(qty / pack.size);
  // Misma unidad escrita distinto ("bolsas 2,5" ~ "bolsa").
  if (sameWord(firstWord(from), firstWord(to.abbr)) || sameWord(firstWord(from), firstWord(to.name))) return round3(qty);
  return undefined;
}

export interface RecipeIssue { product: string; detail: string }
export interface RecipeImportPlan {
  recipes: { product: Product; recipe: Recipe }[];
  issues: RecipeIssue[];
  replaced: number;
  run: () => Promise<number>;
}

export async function planRecipeImport(tab: Tabular): Promise<RecipeImportPlan> {
  const col = (...names: string[]) => tab.headers.findIndex((h) => names.includes(normalize(h)));
  const c = {
    code: col('codigo'), name: col('nombre'), yield: col('porciones', 'rinde'), yieldUnit: col('unidad_med', 'unidad'),
    qty: col('cantidad'), insCode: col('cod_ins'), insName: col('nombreins'), insUnit: col('medidains'), neto: col('neto1'), envase: col('envase1'),
  };
  if (c.code < 0 && c.name < 0) throw new Error('No se encontró la columna "codigo" ni "nombre" de la receta.');
  if (c.qty < 0 || (c.insCode < 0 && c.insName < 0)) throw new Error('No parece un archivo de recetas: faltan las columnas "cantidad" y "cod_ins"/"nombreins".');

  const [products, units] = await Promise.all([db.products.toArray(), db.units.toArray()]);
  const unitOf = new Map(units.map((u) => [u.id, u]));
  const bySku = new Map(products.filter((p) => p.sku).map((p) => [normalize(p.sku), p]));
  const byName = new Map(products.map((p) => [normalize(p.name), p]));
  const find = (code: unknown, name: unknown) => {
    const k = code === undefined ? '' : normalize(String(code).replace(/\.0+$/, ''));
    return (k && bySku.get(k)) || byName.get(normalize(String(name ?? '')));
  };
  const stockUnit = (p: Product) => {
    const u = p.unitId ? unitOf.get(p.unitId) : undefined;
    return { abbr: u?.abbreviation ?? '', name: u?.name ?? '' };
  };
  const str = (r: unknown[], i: number) => (i < 0 || r[i] === undefined ? '' : String(r[i]).trim());

  const groups = new Map<string, unknown[][]>();
  for (const r of tab.rows) {
    const key = str(r, c.code) || str(r, c.name);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const recipes: { product: Product; recipe: Recipe }[] = [];
  const issues: RecipeIssue[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const name = str(first, c.name) || str(first, c.code);
    const product = find(first[c.code], first[c.name]);
    if (!product) {
      issues.push({ product: name, detail: 'no existe en Stock Manager (se omite la receta)' });
      continue;
    }
    const rawYield = parseNumber(first[c.yield], 1) || 1;
    const yieldConv = str(first, c.yieldUnit) ? convertQty(rawYield, str(first, c.yieldUnit), stockUnit(product)) : rawYield;
    if (yieldConv === undefined) {
      issues.push({ product: product.name, detail: `rinde ${rawYield} ${str(first, c.yieldUnit)} pero el producto se controla en ${stockUnit(product).abbr || 'sin unidad'} (se omite la receta)` });
      continue;
    }
    const items: RecipeItem[] = [];
    let ok = true;
    for (const r of rows) {
      const insName = str(r, c.insName) || str(r, c.insCode);
      const ing = find(r[c.insCode], r[c.insName]);
      if (!ing) {
        issues.push({ product: product.name, detail: `el insumo "${insName}" no existe en Stock Manager` });
        ok = false;
        continue;
      }
      const qty = parseNumber(r[c.qty], 0);
      const pack = c.neto >= 0 ? { size: parseNumber(r[c.neto], 0), name: str(r, c.envase) } : undefined;
      const conv = convertQty(qty, str(r, c.insUnit), stockUnit(ing), pack);
      if (conv === undefined) {
        issues.push({ product: product.name, detail: `"${ing.name}": la receta usa ${str(r, c.insUnit)} y el producto se controla en ${stockUnit(ing).abbr || 'sin unidad'}` });
        ok = false;
        continue;
      }
      const prev = items.find((i) => i.productId === ing.id);
      if (prev) prev.quantity = round3(prev.quantity + conv);
      else if (ing.id !== product.id) items.push({ productId: ing.id, quantity: conv });
    }
    // Una receta incompleta descontaría de menos: se carga sólo si todos sus insumos se resolvieron.
    if (ok && items.length) recipes.push({ product, recipe: { yield: yieldConv, items } });
  }

  return {
    recipes,
    issues,
    replaced: recipes.filter((r) => r.product.recipe).length,
    run: async () => {
      const t = nowIso();
      await db.transaction('rw', db.products, async () => {
        for (const { product, recipe } of recipes) await db.products.update(product.id, { recipe, updatedAt: t });
      });
      return recipes.length;
    },
  };
}
