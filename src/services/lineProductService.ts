import { db } from '../database/db';
import type { Category, Product } from '../models';
import { normalize } from '../utils/format';
import { lineFamilyIds, type ProductionLine } from './bakeryService';
import { saveEntity } from './entityService';
import { emptyProduct, saveProduct } from './productService';
import { getSettings } from './settingsService';

/**
 * Productos nuevos desde Producción / Pastelería: lo puede hacer quien tiene el permiso de
 * recetas (la panadera, la pastelera), sin tener que administrar todo el catálogo.
 */

export const LINE_FAMILY_NAME: Record<ProductionLine, string> = { production: 'Panadería', pastry: 'Pastelería' };

/** Familia donde va lo que se elabora en esa sección. Si todavía no hay ninguna, se crea ("Pastelería" / "Panadería"). */
export async function lineFamilyId(line: ProductionLine): Promise<string> {
  const settings = await getSettings();
  const cats = await db.categories.toArray();
  const first = [...lineFamilyIds(settings, cats, line)][0];
  if (first) return first;
  const same = cats.find((c) => normalize(c.name) === normalize(LINE_FAMILY_NAME[line]));
  if (same) return same.id;
  const c = await saveEntity<Category>(db.categories, { name: LINE_FAMILY_NAME[line] });
  return c.id;
}

export interface QuickProduct {
  name: string;
  unitId?: string;
  /** Lo que se elabora (lleva receta) va a la familia de la sección; un insumo, a la familia elegida. */
  elaborated: boolean;
  line?: ProductionLine;
  categoryId?: string;
}

export async function createQuickProduct(d: QuickProduct): Promise<Product> {
  const name = d.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new Error('Falta el nombre.');
  const dupe = (await db.products.toArray()).find((p) => p.active && normalize(p.name) === normalize(name));
  if (dupe) throw new Error(`Ya existe “${dupe.name}”: buscalo por el nombre.`);
  const categoryId = d.categoryId || (d.elaborated && d.line ? await lineFamilyId(d.line) : undefined);
  return saveProduct({ ...emptyProduct(), name, unitId: d.unitId, categoryId });
}
