/**
 * Números repetidos de pedidos y remitos.
 *
 * El número se asigna en el dispositivo (último + 1). Si dos dispositivos crean un pedido o
 * remito a la vez sin conexión, al sincronizar quedan dos con el mismo número. Acá se detecta
 * y se corrige de forma determinista: en cada grupo repetido conserva el número el más antiguo
 * (por fecha de creación, y si empatan por id) y los demás pasan al siguiente número libre.
 * Todos los dispositivos llegan al mismo resultado, así que no hay idas y vueltas.
 * En las notas queda registrado el número anterior.
 */
import { db } from '../database/db';
import { nowIso } from '../utils/id';

type Numbered = { id: string; number: number; createdAt: string; notes?: string };

export async function fixDuplicateNumbers(table: 'orders' | 'transfers'): Promise<number> {
  const label = table === 'orders' ? (n: number) => `#${n}` : (n: number) => `R-${String(n).padStart(4, '0')}`;
  return db.transaction('rw', db.table(table), async () => {
    const rows = (await db.table(table).toArray()) as Numbered[];
    const groups = new Map<number, Numbered[]>();
    for (const r of rows) groups.set(r.number, [...(groups.get(r.number) ?? []), r]);
    const dups = [...groups.values()].filter((g) => g.length > 1);
    if (!dups.length) return 0;
    let next = Math.max(...rows.map((r) => r.number)) + 1;
    let changed = 0;
    const t = nowIso();
    for (const g of dups) {
      g.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      for (const r of g.slice(1)) {
        const note = `Número cambiado de ${label(r.number)} a ${label(next)}: estaba repetido (creado sin conexión en dos dispositivos).`;
        await db.table(table).update(r.id, { number: next, notes: r.notes ? `${r.notes}\n${note}` : note, updatedAt: t });
        next++;
        changed++;
      }
    }
    return changed;
  });
}
