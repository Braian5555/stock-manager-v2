import { db } from '../../database/db';
import type { Category, ExternalEntityType, ExternalReference, ExternalSystemId, Location, Product, Unit } from '../../models';
import { normalize } from '../../utils/format';
import { nowIso, uuid } from '../../utils/id';

type Linkable = Product | Category | Unit | Location;

function withoutSystem(systems: Linkable['externalSystems'], system: ExternalSystemId): Linkable['externalSystems'] {
  const copy = { ...systems };
  delete copy[system];
  return copy;
}

function tableFor(type: ExternalEntityType) {
  return { product: db.products, category: db.categories, unit: db.units, location: db.locations }[type];
}

/**
 * Vincula una entidad local con un registro externo. Garantiza que un registro
 * externo quede vinculado a UNA sola entidad local (evita duplicados).
 */
export async function link(type: ExternalEntityType, localId: string, ref: Pick<ExternalReference, 'externalId' | 'code'>, system: ExternalSystemId = 'maxirest') {
  const table = tableFor(type);
  await db.transaction('rw', table, async () => {
    const all = (await table.toArray()) as Linkable[];
    for (const e of all)
      if (e.id !== localId && e.externalSystems?.[system]?.id === ref.externalId) {
        await table.update(e.id, { externalSystems: withoutSystem(e.externalSystems, system), updatedAt: nowIso() });
      }
    const target = all.find((e) => e.id === localId);
    if (!target) throw new Error('El elemento local no existe.');
    await table.update(localId, {
      externalSystems: { ...target.externalSystems, [system]: { id: ref.externalId, code: ref.code, lastSyncedAt: nowIso() } },
      updatedAt: nowIso(),
    });
  });
}

export async function unlink(type: ExternalEntityType, localId: string, system: ExternalSystemId = 'maxirest') {
  const table = tableFor(type);
  const e = (await table.get(localId)) as Linkable | undefined;
  if (!e) return;
  await table.update(localId, { externalSystems: withoutSystem(e.externalSystems, system), updatedAt: nowIso() });
}

/** Sugerencia de vínculo (no se aplica sola): por código = SKU, o por nombre normalizado. */
export function suggestMatch<T extends { id: string; name: string; sku?: string; externalSystems?: Linkable['externalSystems'] }>(
  ref: Pick<ExternalReference, 'code' | 'name'>,
  candidates: T[],
  system: ExternalSystemId = 'maxirest',
): T | undefined {
  const free = candidates.filter((c) => !c.externalSystems?.[system]);
  if (ref.code) {
    const byCode = free.find((c) => c.sku && normalize(c.sku) === normalize(ref.code));
    if (byCode) return byCode;
  }
  return free.find((c) => normalize(c.name) === normalize(ref.name));
}

/** Crea un producto local a partir de un insumo externo. Rechaza si ya está vinculado. */
export async function createProductFromExternal(ref: ExternalReference): Promise<Product> {
  const already = (await db.products.toArray()).find((p) => p.externalSystems?.[ref.system]?.id === ref.externalId);
  if (already) throw new Error(`"${ref.name}" ya está vinculado a "${already.name}".`);
  const [cats, units, locs] = await Promise.all([db.categories.toArray(), db.units.toArray(), db.locations.toArray()]);
  const byExt = <E extends Linkable>(list: E[], name?: string) =>
    name ? list.find((x) => normalize(x.name) === normalize(name)) : undefined;
  const t = nowIso();
  const p: Product = {
    id: uuid(),
    createdAt: t,
    updatedAt: t,
    name: ref.name,
    sku: ref.code,
    categoryId: byExt(cats, ref.categoryName)?.id,
    unitId: byExt(units, ref.unitName)?.id,
    locationId: byExt(locs, ref.locationName)?.id,
    purchaseFactor: 1,
    alternativeSupplierIds: [],
    stock: 0,
    minStock: 0,
    maxStock: 0,
    active: true,
    externalSystems: { [ref.system]: { id: ref.externalId, code: ref.code, lastSyncedAt: t } },
  };
  await db.products.add(p);
  return p;
}

/** Guarda/actualiza la copia local de registros externos (upsert por system+tipo+externalId). */
export async function upsertReferences(
  system: ExternalSystemId,
  entityType: ExternalEntityType,
  rows: Omit<ExternalReference, 'id' | 'createdAt' | 'updatedAt' | 'system' | 'entityType' | 'lastSeenAt'>[],
): Promise<number> {
  const t = nowIso();
  await db.transaction('rw', db.externalReferences, async () => {
    const existing = await db.externalReferences.where({ system, entityType }).toArray();
    const byExt = new Map(existing.map((r) => [r.externalId, r]));
    const put: ExternalReference[] = rows.map((r) => {
      const prev = byExt.get(r.externalId);
      return { ...prev, ...r, id: prev?.id ?? uuid(), createdAt: prev?.createdAt ?? t, updatedAt: t, lastSeenAt: t, system, entityType } as ExternalReference;
    });
    await db.externalReferences.bulkPut(put);
  });
  return rows.length;
}
