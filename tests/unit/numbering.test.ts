import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { fixDuplicateNumbers } from '../../src/services/numberingService';
import type { Transfer } from '../../src/models';

const tr = (id: string, number: number, createdAt: string): Transfer => ({
  id, number, createdAt, updatedAt: createdAt, date: '2026-10-08', outletId: 'o1', items: [], status: 'enviado', maxirest: 'pendiente',
});

describe('números repetidos (creados sin conexión en dos dispositivos)', () => {
  it('conserva el número el más antiguo y pasa los demás al siguiente libre, dejando nota', async () => {
    await db.transfers.bulkAdd([
      tr('a', 1, '2026-10-08T10:00:00Z'),
      tr('b', 2, '2026-10-08T11:00:00Z'),
      tr('c', 2, '2026-10-08T11:05:00Z'), // mismo número que b, creado después en otro dispositivo
      tr('d', 3, '2026-10-08T12:00:00Z'),
    ]);
    expect(await fixDuplicateNumbers('transfers')).toBe(1);
    const all = await db.transfers.orderBy('number').toArray();
    expect(all.map((t) => [t.id, t.number])).toEqual([['a', 1], ['b', 2], ['d', 3], ['c', 4]]);
    expect((await db.transfers.get('c'))!.notes).toMatch(/R-0002 a R-0004/);
    // Idempotente: una segunda pasada no cambia nada.
    expect(await fixDuplicateNumbers('transfers')).toBe(0);
  });

  it('dos dispositivos llegan al mismo resultado sin importar el orden de llegada', async () => {
    const rows = [tr('x', 5, '2026-10-08T09:00:00Z'), tr('y', 5, '2026-10-08T09:00:00Z')];
    await db.transfers.bulkAdd([...rows].reverse());
    await fixDuplicateNumbers('transfers');
    expect((await db.transfers.get('x'))!.number).toBe(5); // empate por fecha: decide el id
    expect((await db.transfers.get('y'))!.number).toBe(6);
  });

  it('también corrige pedidos', async () => {
    const base = { date: '2026-10-08T10:00:00Z', status: 'pendiente' as const };
    await db.orders.bulkAdd([
      { ...base, id: 'p1', number: 7, createdAt: '2026-10-08T10:00:00Z', updatedAt: '2026-10-08T10:00:00Z' },
      { ...base, id: 'p2', number: 7, createdAt: '2026-10-08T10:01:00Z', updatedAt: '2026-10-08T10:01:00Z' },
    ]);
    expect(await fixDuplicateNumbers('orders')).toBe(1);
    expect((await db.orders.get('p2'))!.number).toBe(8);
    expect((await db.orders.get('p2'))!.notes).toMatch(/#7 a #8/);
  });
});
