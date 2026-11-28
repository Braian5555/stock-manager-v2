/**
 * Salón como Fudo: varias cuentas en una misma mesa, mozo a cargo de cada pedido,
 * autorización para tocar la mesa de otro mozo y detección de comandas nuevas para el sonido.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import {
  addLine, addNumberedTables, closeTicket, moveTicket, needsWaiterPin, openExtraTicket, openTicket, saveMenuItem, sendToKitchen, setTicketTag, setWaiter, ticketLabel,
} from '../../src/services/salonService';
import { newIds } from '../../src/utils/sound';

async function setup() {
  await addNumberedTables(1, 3, 'Salón');
  const tables = await db.diningTables.orderBy('order').toArray();
  const cafe = await saveMenuItem({ name: 'Café', section: 'Cafetería', price: 3000, kitchen: false });
  return { tables, cafe };
}

describe('varias cuentas en una mesa', () => {
  it('abre otra cuenta en la misma mesa y nombra las que ya estaban', async () => {
    const { tables, cafe } = await setup();
    const first = await openTicket(tables[0].id);
    await addLine(first.id, cafe, 2);
    const second = await openExtraTicket(tables[0].id);
    expect(second.tableId).toBe(tables[0].id);
    expect(second.tag).toBe('Cuenta 2');
    expect((await db.tickets.get(first.id))!.tag).toBe('Cuenta 1');
    expect(ticketLabel(second)).toBe('Mesa 1 · Cuenta 2');
    expect(second.number).toBeGreaterThan(first.number);

    // Abrir la mesa sigue llevando a la primera cuenta (no crea otra).
    expect((await openTicket(tables[0].id)).id).toBe(first.id);

    const juan = await openExtraTicket(tables[0].id, 'Juan');
    expect(ticketLabel(juan)).toBe('Mesa 1 · Juan');
    await expect(openExtraTicket(tables[0].id, 'juan')).rejects.toThrow(/Ya hay una/);

    // Cada cuenta se cobra por separado: cerrar una no toca las otras.
    await addLine(second.id, cafe, 1);
    await sendToKitchen(second.id);
    await closeTicket(second.id);
    expect((await db.tickets.get(first.id))!.status).toBe('abierta');
    expect((await db.tickets.get(second.id))!.status).toBe('cerrada');
  });

  it('se le puede cambiar el nombre a la cuenta (o sacarlo)', async () => {
    const { tables } = await setup();
    const t = await openTicket(tables[1].id);
    expect(ticketLabel(await setTicketTag(t.id, '  Cumpleaños '))).toBe('Mesa 2 · Cumpleaños');
    expect(ticketLabel(await setTicketTag(t.id, ''))).toBe('Mesa 2');
  });

  it('no se cambia a una mesa ocupada', async () => {
    const { tables } = await setup();
    const a = await openTicket(tables[0].id);
    await openTicket(tables[1].id);
    await expect(moveTicket(a.id, tables[1].id)).rejects.toThrow(/ocupada/);
  });
});

describe('mozo a cargo', () => {
  it('se cambia el mozo del pedido', async () => {
    const { tables } = await setup();
    const t = await openTicket(tables[0].id);
    const r = await setWaiter(t.id, { id: 'u-ana', name: 'Ana' });
    expect(r.openedBy).toEqual({ id: 'u-ana', name: 'Ana' });
  });

  it('otro mozo necesita autorización; el mismo mozo o quien cobra, no', () => {
    const t = { openedBy: { id: 'u-ana', name: 'Ana' } };
    expect(needsWaiterPin(t, { id: 'u-beto' }, false)).toBe(true);
    expect(needsWaiterPin(t, { id: 'u-ana' }, false)).toBe(false);
    expect(needsWaiterPin(t, { id: 'u-beto' }, true)).toBe(false);
    expect(needsWaiterPin({}, { id: 'u-beto' }, false)).toBe(false); // mesa sin mozo
    expect(needsWaiterPin(t, undefined, false)).toBe(false); // sin usuario (equipo sin sesión)
  });
});

describe('sonido de comandas', () => {
  it('lo que ya estaba al abrir la pantalla no suena; lo que llega después, sí', () => {
    const a = newIds(null, ['1', '2']);
    expect(a.fresh).toEqual([]);
    const b = newIds(a.seen, ['1', '2', '3']);
    expect(b.fresh).toEqual(['3']);
    const c = newIds(b.seen, ['3']);
    expect(c.fresh).toEqual([]);
  });
});
