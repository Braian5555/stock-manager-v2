import { db } from '../database/db';
import { summarizeCount } from '../services/countService';
import { fmtDateTime, round3 } from '../utils/format';
import type { Dataset } from './datasets';
import { downloadBlob, safeFilename, stamp } from './download';
import { toXlsx } from './writers';

const STATUS: Record<string, string> = { abierto: 'En curso', finalizado: 'Finalizado', aplicado: 'Aplicado', descartado: 'Descartado' };

/**
 * Detalle auditable de un conteo: cada producto con esperado, contado, diferencia, quién lo
 * contó y cuándo, más una hoja de resumen (quién empezó, finalizó y aplicó).
 */
export async function buildCountReport(countId: string): Promise<{ title: string; datasets: Dataset[]; summary: string[] }> {
  const count = await db.counts.get(countId);
  if (!count) throw new Error('El conteo no existe.');
  const [items, products, categories, locations, units, outlets] = await Promise.all([
    db.countItems.where('countId').equals(countId).toArray(),
    db.products.toArray(), db.categories.toArray(), db.locations.toArray(), db.units.toArray(), db.outlets.toArray(),
  ]);
  const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));
  const prod = byId(products), cat = byId(categories), loc = byId(locations), un = byId(units);
  // Nombre del producto aunque se haya eliminado después: se busca en sus movimientos.
  const movementName = new Map((await db.movements.where('refId').equals(countId).toArray()).map((m) => [m.productId, m.productName]));
  const nameOf = (id: string) => prod.get(id)?.name ?? movementName.get(id) ?? '(producto eliminado)';

  const rows = items
    .map((i) => {
      const p = prod.get(i.productId);
      const diff = i.counted === undefined ? '' : round3(i.counted - i.expected);
      return [
        nameOf(i.productId),
        (p?.categoryId && cat.get(p.categoryId)?.name) || '',
        (p?.locationId && loc.get(p.locationId)?.name) || '',
        (p?.unitId && un.get(p.unitId)?.abbreviation) || '',
        i.expected,
        i.counted ?? 'sin contar',
        diff,
        i.countedBy?.name ?? '',
        i.countedAt ? fmtDateTime(i.countedAt) : '',
      ] as (string | number)[];
    })
    // Primero las diferencias más grandes (en valor absoluto), después sin diferencia y al final sin contar.
    .sort((a, b) => (typeof b[6] === 'number' ? Math.abs(b[6]) : -1) - (typeof a[6] === 'number' ? Math.abs(a[6]) : -1) || String(a[0]).localeCompare(String(b[0]), 'es'));

  const s = summarizeCount(items);
  const place = count.outletId ? outlets.find((o) => o.id === count.outletId)?.name ?? 'Punto' : 'Depósito central';
  const summary = [
    `Conteo: ${count.name}`,
    `Lugar: ${place}${count.locationId ? ` · ${loc.get(count.locationId)?.name ?? ''}` : ''}${count.categoryId ? ` · ${cat.get(count.categoryId)?.name ?? ''}` : ''}`,
    `Estado: ${STATUS[count.status] ?? count.status}`,
    `Empezado: ${fmtDateTime(count.createdAt)}${count.createdBy ? ` por ${count.createdBy.name}` : ''}`,
    `Finalizado: ${count.finishedAt ? fmtDateTime(count.finishedAt) : '—'}${count.finishedBy ? ` por ${count.finishedBy.name}` : ''}`,
    `Aplicado al stock: ${count.appliedAt ? fmtDateTime(count.appliedAt) : 'no'}${count.appliedBy ? ` por ${count.appliedBy.name}` : ''}`,
    `Comparado contra: ${count.baseline === 'local' ? 'stock de la app al empezar' : 'stock informado por Maxirest'}`,
    '',
    `Productos: ${s.total} · contados ${s.counted} · sin contar ${s.uncounted}`,
    `Con diferencia: ${s.increases.length + s.decreases.length} (aumentos ${s.increases.length}, disminuciones ${s.decreases.length}) · sin cambios ${s.unchanged.length}`,
  ];
  return {
    title: count.name,
    summary,
    datasets: [{ title: 'Diferencias', columns: ['Producto', 'Familia', 'Ubicación', 'Unidad', 'Esperado', 'Contado', 'Diferencia', 'Contado por', 'Hora'], rows }],
  };
}

export async function downloadCountReport(countId: string): Promise<void> {
  const r = await buildCountReport(countId);
  const blob = await toXlsx(r.title, r.datasets, [{ name: 'Resumen', lines: r.summary }]);
  downloadBlob(blob, `${safeFilename(`conteo-${r.title}`)}-${stamp()}.xlsx`);
}
