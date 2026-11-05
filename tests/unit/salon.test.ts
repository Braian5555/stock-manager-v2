import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import {
  addLine, addNumberedTables, cancelTicket, closeTicket, markDelivered, markLineReady, maxirestPayload, moveTicket, openTicket, requestBill, retireTable,
  saveMenuItem, sendToKitchen, updateLine, voidLine,
} from '../../src/services/salonService';

async function setup() {
  await addNumberedTables(1, 3, 'Salón');
  const tables = await db.diningTables.orderBy('order').toArray();
  const medialunas = await saveMenuItem({ name: 'Desayuno americano', section: 'Desayunos', price: 9500, maxirestCode: '101', kitchen: true });
  const cafe = await saveMenuItem({ name: 'Café con leche', section: 'Cafetería', price: 3200, kitchen: false });
  return { tables, medialunas, cafe };
}

describe('salón: mesas y pedidos', () => {
  it('crea mesas numeradas sin repetir y no deja dos mesas con el mismo nombre', async () => {
    expect(await addNumberedTables(1, 4, 'Salón')).toBe(4);
    expect(await addNumberedTables(3, 6, 'Terraza')).toBe(2);
    const all = await db.diningTables.orderBy('order').toArray();
    expect(all.map((t) => t.name)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(all.at(-1)!.zone).toBe('Terraza');
    await expect(addNumberedTables(5, 2, 'Salón')).rejects.toThrow();
  });

  it('abre la mesa una sola vez y numera los pedidos del día', async () => {
    const { tables } = await setup();
    const a = await openTicket(tables[0].id);
    expect(await openTicket(tables[0].id)).toMatchObject({ id: a.id });
    const b = await openTicket(tables[1].id);
    expect([a.number, b.number]).toEqual([1, 2]);
    expect(a.status).toBe('abierta');
  });

  it('suma platos, manda la comanda (las bebidas salen directo) y calcula el total', async () => {
    const { tables, medialunas, cafe } = await setup();
    const t = await openTicket(tables[0].id);
    await addLine(t.id, medialunas);
    await addLine(t.id, medialunas);
    await addLine(t.id, cafe, 2);
    await addLine(t.id, medialunas, 1, 'sin manteca');
    let k = (await db.tickets.get(t.id))!;
    expect(k.lines.map((l) => [l.name, l.qty, l.notes])).toEqual([
      ['Desayuno americano', 2, undefined], ['Café con leche', 2, undefined], ['Desayuno americano', 1, 'sin manteca'],
    ]);
    expect(k.total).toBe(9500 * 3 + 3200 * 2);

    const { sent } = await sendToKitchen(t.id);
    expect(sent).toBe(5);
    k = (await db.tickets.get(t.id))!;
    expect(k.lines.map((l) => l.status)).toEqual(['cocina', 'entregado', 'cocina']);
    await expect(updateLine(t.id, k.lines[0].id, { qty: 5 })).rejects.toThrow(/anulalo/);

    await markLineReady(t.id, k.lines[0].id);
    await markDelivered(t.id);
    k = (await db.tickets.get(t.id))!;
    expect(k.lines.map((l) => l.status)).toEqual(['entregado', 'entregado', 'cocina']);
  });

  it('anular un plato mandado lo deja en 0 (cocina lo ve tachado) y no se cobra', async () => {
    const { tables, medialunas, cafe } = await setup();
    const t = await openTicket(tables[0].id);
    await addLine(t.id, medialunas);
    await addLine(t.id, cafe);
    await sendToKitchen(t.id);
    const line = (await db.tickets.get(t.id))!.lines[0];
    const k = await voidLine(t.id, line.id);
    expect(k.lines[0].qty).toBe(0);
    expect(k.total).toBe(3200);
  });

  it('no cierra con platos sin mandar; al cerrar queda pendiente para Maxirest y la mesa libre', async () => {
    const { tables, medialunas, cafe } = await setup();
    const t = await openTicket(tables[0].id);
    await addLine(t.id, medialunas);
    await expect(closeTicket(t.id)).rejects.toThrow(/sin mandar/);
    await sendToKitchen(t.id);
    await addLine(t.id, cafe);
    await sendToKitchen(t.id);
    await requestBill(t.id);
    expect((await db.tickets.get(t.id))!.status).toBe('cuenta');
    const closed = await closeTicket(t.id);
    expect(closed).toMatchObject({ status: 'cerrada', maxirest: { status: 'pendiente' } });
    expect(closed.closedAt).toBeTruthy();
    // La mesa queda libre: se abre un pedido nuevo.
    const next = await openTicket(tables[0].id);
    expect(next.id).not.toBe(t.id);
    expect(next.number).toBe(2);

    const items = new Map((await db.menuItems.toArray()).map((m) => [m.id, m]));
    const payload = maxirestPayload(closed, items);
    expect(payload.items).toEqual([
      { codigo: '101', nombre: 'Desayuno americano', cantidad: 1, precio: 9500, nota: undefined },
      { codigo: null, nombre: 'Café con leche', cantidad: 1, precio: 3200, nota: undefined },
    ]);
    expect(payload.sinCodigo).toEqual(['Café con leche']);
    expect(payload.total).toBe(12700);
  });

  it('cambia de mesa sólo a una libre y no da de baja una mesa ocupada', async () => {
    const { tables, cafe } = await setup();
    const a = await openTicket(tables[0].id);
    await openTicket(tables[1].id);
    await addLine(a.id, cafe);
    await expect(moveTicket(a.id, tables[1].id)).rejects.toThrow(/ocupada/);
    const moved = await moveTicket(a.id, tables[2].id);
    expect(moved).toMatchObject({ tableId: tables[2].id, tableName: '3' });
    await expect(retireTable(tables[2].id)).rejects.toThrow(/pedido abierto/);
    await cancelTicket(a.id);
    await retireTable(tables[2].id);
    expect((await db.diningTables.get(tables[2].id))!.active).toBe(false);
  });

  it('valida la carta', async () => {
    await saveMenuItem({ name: 'Tostado', section: 'Cafetería', price: 4000, kitchen: true });
    await expect(saveMenuItem({ name: 'tostado', section: 'X', price: 1, kitchen: true })).rejects.toThrow(/ya está/);
    await expect(saveMenuItem({ name: 'Algo', section: 'X', price: NaN, kitchen: true })).rejects.toThrow(/precio/);
  });
});
