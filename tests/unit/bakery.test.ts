import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { bakerySummary, closeDay, closedOn, planOf, savePlan, ymdAdd } from '../../src/services/bakeryService';
import { registerProduction, undoProduction } from '../../src/services/productionService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { revertMovement } from '../../src/services/stockService';
import { localYmd } from '../../src/utils/format';

const today = localYmd();

async function setup() {
  const harina = await saveProduct({ ...emptyProduct(), name: 'Harina' }, 20);
  const medialunas = await saveProduct({ ...emptyProduct(), name: 'Medialunas', recipe: { yield: 24, items: [{ productId: harina.id, quantity: 2 }] } });
  const pan = await saveProduct({ ...emptyProduct(), name: 'Pan' });
  return { harina, medialunas, pan };
}

describe('panadería', () => {
  it('plan del día: guarda por fecha, cambia sólo lo necesario y 0 lo saca', async () => {
    const { medialunas, pan } = await setup();
    const tomorrow = ymdAdd(today, 1);
    expect(await savePlan(today, { [medialunas.id]: 48, [pan.id]: 10 })).toBe(2);
    expect(await savePlan(tomorrow, { [medialunas.id]: 24 })).toBe(1);
    expect(await savePlan(today, { [medialunas.id]: 48, [pan.id]: 10 })).toBe(0); // sin cambios
    let m = (await db.products.get(medialunas.id))!;
    expect([planOf(m, today), planOf(m, tomorrow)]).toEqual([48, 24]);
    await savePlan(today, { [pan.id]: 0 });
    expect((await db.products.get(pan.id))!.productionPlan).toBeUndefined();
    m = (await db.products.get(medialunas.id))!;
    expect(m.stock).toBe(0); // el plan no toca el stock
  });

  it('cierre: merma descuenta, el sobrante queda como stock y no se duplica', async () => {
    const { medialunas } = await setup();
    await registerProduction(medialunas.id, 48);
    const r = await closeDay(today, [{ productId: medialunas.id, merma: 4, sobrante: 10 }]);
    expect(r).toEqual({ applied: 2, duplicates: 0 });
    expect((await db.products.get(medialunas.id))!.stock).toBe(10);
    // Tocar "Guardar cierre" otra vez no registra nada nuevo.
    expect(await closeDay(today, [{ productId: medialunas.id, merma: 4, sobrante: 10 }])).toEqual({ applied: 0, duplicates: 2 });
    const all = await db.movements.toArray();
    expect(closedOn(all, today).get(medialunas.id)).toEqual({ merma: 4, sobrante: 10 });

    // Si se revierte el cierre desde Movimientos, se puede cargar de nuevo.
    for (const m of all.filter((x) => x.idempotencyKey.startsWith('cierre:'))) await revertMovement(m);
    expect(closedOn(await db.movements.toArray(), today).size).toBe(0);
    expect(await closeDay(today, [{ productId: medialunas.id, sobrante: 6 }])).toEqual({ applied: 1, duplicates: 0 });
    expect(closedOn(await db.movements.toArray(), today).get(medialunas.id)).toEqual({ sobrante: 6 });
  });

  it('resumen: planificado, producido, merma, sobrante e insumos (lo deshecho no cuenta)', async () => {
    const { harina, medialunas, pan } = await setup();
    await savePlan(today, { [medialunas.id]: 72, [pan.id]: 5 });
    await registerProduction(medialunas.id, 48);
    const extra = await registerProduction(medialunas.id, 24);
    await registerProduction(medialunas.id, 12);
    await undoProduction(extra.movement);
    await closeDay(today, [{ productId: medialunas.id, merma: 3, sobrante: 7 }]);

    const s = bakerySummary(await db.movements.toArray(), await db.products.toArray(), today, today);
    expect(s.productions).toBe(2);
    expect(s.entries.map((e) => e.quantity).sort((x, y) => x - y)).toEqual([12, 48]); // el detalle tampoco cuenta lo deshecho
    const ml = s.rows.find((r) => r.name === 'Medialunas')!;
    expect(ml).toMatchObject({ planned: 72, produced: 60, merma: 3, sobrante: 7, closedDays: 1 });
    expect(s.rows.find((r) => r.name === 'Pan')).toMatchObject({ planned: 5, produced: 0 });
    // 60 medialunas = 2,5 tandas de 24 → 5 kg de harina
    expect(s.ingredients).toEqual([{ productId: harina.id, name: 'Harina', quantity: 5 }]);

    // Fuera del período no aparece nada
    const yesterday = ymdAdd(today, -1);
    expect(bakerySummary(await db.movements.toArray(), await db.products.toArray(), yesterday, yesterday).rows).toEqual([]);
  });
});
