import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { bakerySummary, closeDay, closedOn, lineFamilyIds, planOf, productionFamilyIds, savePlan, ymdAdd } from '../../src/services/bakeryService';
import { registerProduction, undoProduction } from '../../src/services/productionService';
import { duplicateProduct, emptyProduct, saveProduct } from '../../src/services/productService';
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

describe('panadería: el plan no se pierde por otras ediciones', () => {
  it('editar un producto con un formulario viejo no borra su plan, y la copia no lo hereda', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Medialuna' });
    const stale = (await db.products.get(p.id))!; // formulario abierto antes del plan
    await savePlan(today, { [p.id]: 48 });
    await saveProduct({ ...stale, minStock: 10 });
    const after = (await db.products.get(p.id))!;
    expect(after.minStock).toBe(10);
    expect(planOf(after, today)).toBe(48);
    const copy = await duplicateProduct(p.id);
    expect(copy.productionPlan).toBeUndefined();
  });
});

describe('familias de producción', () => {
  it('por defecto panadería/pastelería; si se eligen, esas más las de pastelería', () => {
    const cats = [{ id: 'a', name: 'Panaderia' }, { id: 'b', name: 'Pastelería' }, { id: 'c', name: 'Bebidas' }, { id: 'd', name: 'Preparaciones' }];
    expect([...productionFamilyIds({}, cats)].sort()).toEqual(['a', 'b']);
    expect([...productionFamilyIds({ productionCategoryIds: ['d', 'x'] }, cats)].sort()).toEqual(['b', 'd']);
    expect(productionFamilyIds({}, [{ id: 'c', name: 'Bebidas' }]).size).toBe(0);
  });
});

describe('líneas de producción: Producción y Pastelería', () => {
  const cats = [
    { id: 'pan', name: 'Panadería' },
    { id: 'pas', name: 'Pastelería' },
    { id: 'rep', name: 'Repostería fina' },
    { id: 'beb', name: 'Bebidas' },
  ];
  it('por defecto toma las familias por nombre, cada una en su línea', () => {
    expect([...lineFamilyIds({}, cats, 'production')]).toEqual(['pan']);
    expect([...lineFamilyIds({}, cats, 'pastry')]).toEqual(['pas', 'rep']);
    expect([...productionFamilyIds({}, cats)].sort()).toEqual(['pan', 'pas', 'rep']);
  });
  it('las elegidas mandan y se ignoran las familias que ya no existen', () => {
    const s = { productionCategoryIds: ['beb'], pastryCategoryIds: ['pan', 'borrada'] };
    expect([...lineFamilyIds(s, cats, 'production')]).toEqual(['beb']);
    expect([...lineFamilyIds(s, cats, 'pastry')]).toEqual(['pan']);
    expect([...lineFamilyIds({ pastryCategoryIds: ['borrada'] }, cats, 'pastry')]).toEqual(['pas', 'rep']);
  });
  it('sin familias de pastelería, la línea queda vacía', () => {
    expect(lineFamilyIds({}, [{ id: 'beb', name: 'Bebidas' }], 'pastry').size).toBe(0);
  });
});
