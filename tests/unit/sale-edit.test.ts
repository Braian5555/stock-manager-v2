import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { balances, saveAccount } from '../../src/services/accountService';
import { closeCash, openCash, summarize } from '../../src/services/cashService';
import { chargeTicket } from '../../src/services/fiscalService';
import { editChargePayments, editSaleInfo, reopenSale, voidSale } from '../../src/services/saleEditService';
import { addLine, addNumberedTables, closeTicket, openTicket, saveMenuItem, sendToKitchen } from '../../src/services/salonService';
import { updateSettings } from '../../src/services/settingsService';
import { applyMovement } from '../../src/services/stockService';
import { ROLE_PERMISSIONS } from '../../src/services/userService';

beforeEach(async () => {
  await updateSettings({ fiscal: { enabled: false, serviceUrl: '', ambiente: 'homologacion', cuit: '', razonSocial: '', domicilio: '', condicionIva: 'RI', ptoVta: 1, concepto: 1, ivaDefault: 21, letraA: 'A' } });
});

async function sale(price = 5000) {
  if (!(await db.diningTables.count())) await addNumberedTables(1, 6, 'Salón');
  const all = await db.diningTables.orderBy('order').toArray();
  const busy = new Set((await db.tickets.where('status').anyOf('abierta', 'cuenta').toArray()).map((t) => t.tableId));
  const harina = await db.products.add({ id: crypto.randomUUID(), name: `Harina ${price}`, stock: 0, minStock: 0, maxStock: 0, active: true, purchaseFactor: 1, alternativeSupplierIds: [] } as never) as string;
  await applyMovement({ productId: harina, type: 'ingreso', delta: 10, reason: 'Compra', origin: 'manual' });
  const item = await saveMenuItem({ name: `Pizza ${price}`, section: 'Platos', price, kitchen: false, recipe: { yield: 1, items: [{ productId: harina, quantity: 2 }] } });
  const t = await openTicket(all.find((x) => !busy.has(x.id))!.id);
  await addLine(t.id, item, 1);
  await sendToKitchen(t.id);
  await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: price }], invoice: false });
  return { ticket: await closeTicket(t.id), harina };
}

const stockOf = async (id: string) => (await db.products.get(id))!.stock;

describe('editar ventas cerradas (como Fudo)', () => {
  it('cambiar el medio de pago acomoda la caja y la cuenta corriente; queda el motivo', async () => {
    const session = await openCash(0);
    const { ticket } = await sale(5000);
    expect(ticket.status).toBe('cerrada');
    const c = ticket.charges![0];
    await expect(editChargePayments(ticket.id, c.id, [{ method: 'debito', amount: 5000 }], '')).rejects.toThrow(/motivo/);
    await expect(editChargePayments(ticket.id, c.id, [{ method: 'debito', amount: 4000 }], 'era débito')).rejects.toThrow(/sumar/);
    const ok = await editChargePayments(ticket.id, c.id, [{ method: 'debito', amount: 3000 }, { method: 'efectivo', amount: 2000 }], 'Pagó una parte con débito');
    expect(ok.edits![0]).toMatchObject({ action: 'pagos', reason: 'Pagó una parte con débito' });
    expect(ok.edits![0].detail).toMatch(/Efectivo .*→ Débito/);
    const sum = summarize(session, await db.tickets.toArray(), []);
    expect(sum.sales.efectivo).toBe(2000);
    expect(sum.sales.debito).toBe(3000);

    const acct = await saveAccount({ name: 'ALADES' });
    await editChargePayments(ticket.id, c.id, [{ method: 'cuenta_corriente', amount: 5000, accountId: acct.id, accountName: 'ALADES' }], 'Lo paga ALADES');
    expect(balances([acct], await db.tickets.toArray(), [])[0].balance).toBe(5000);

    // Con la caja cerrada ya no se toca.
    await closeCash(session.id, {});
    await expect(editChargePayments(ticket.id, c.id, [{ method: 'efectivo', amount: 5000 }], 'otra vez')).rejects.toThrow(/caja .*cerr/);
    await expect(voidSale(ticket.id, 'error')).rejects.toThrow(/caja/);
  });

  it('datos de la venta: comensales y cliente', async () => {
    const { ticket } = await sale(3000);
    await expect(editSaleInfo(ticket.id, {}, 'nada')).rejects.toThrow(/No cambiaste/);
    const t = await editSaleInfo(ticket.id, { guests: 4, customer: { name: 'Juan' } }, 'Eran 4');
    expect(t.guests).toBe(4);
    expect(t.edits!.at(-1)!.detail).toMatch(/comensales .*4.*cliente .*Juan/);
  });

  it('anular: deja de contar en la caja y el stock vuelve; reabrir: se corrige y se vuelve a cobrar', async () => {
    const session = await openCash(0);
    const a = await sale(7000);
    expect(await stockOf(a.harina)).toBe(8);
    const anulada = await voidSale(a.ticket.id, 'Se cargó dos veces');
    expect(anulada.status).toBe('anulada');
    expect(await stockOf(a.harina)).toBe(10);
    expect(summarize(session, await db.tickets.toArray(), []).totalSales).toBe(0);
    await expect(voidSale(a.ticket.id, 'otra')).rejects.toThrow(/ya está anulada/);

    const b = await sale(4000);
    expect(await stockOf(b.harina)).toBe(8);
    const reabierta = await reopenSale(b.ticket.id, 'Faltó cobrar un postre');
    expect(reabierta.status).toBe('abierta');
    expect(reabierta.charges).toBeUndefined();
    expect(reabierta.edits!.at(-1)!.detail).toMatch(/Se sacaron los cobros/);
    expect(await stockOf(b.harina)).toBe(10);
    // Se vuelve a cobrar: el stock se descuenta otra vez (no queda como repetido).
    await chargeTicket(b.ticket.id, { payments: [{ method: 'qr', amount: 4000 }], invoice: false });
    expect((await closeTicket(b.ticket.id)).status).toBe('cerrada');
    expect(await stockOf(b.harina)).toBe(8);
    expect(summarize(session, await db.tickets.toArray(), []).sales.qr).toBe(4000);
  });

  it('con factura de ARCA no se reabre ni se anula (va nota de crédito)', async () => {
    await openCash(0);
    const { ticket } = await sale(2000);
    const docId = crypto.randomUUID();
    await db.fiscalDocs.add({ id: docId, status: 'autorizada' } as never);
    await db.tickets.update(ticket.id, { fiscalDocId: docId });
    await expect(voidSale(ticket.id, 'error')).rejects.toThrow(/nota de crédito/);
    await expect(reopenSale(ticket.id, 'error')).rejects.toThrow(/nota de crédito/);
    // El medio de pago sí.
    await expect(editChargePayments(ticket.id, ticket.charges![0].id, [{ method: 'debito', amount: 2000 }], 'era débito')).resolves.toBeTruthy();
  });

  it('el encargado tiene los permisos nuevos; el mozo no', () => {
    expect(ROLE_PERMISSIONS.manager).toEqual(expect.arrayContaining(['sales.edit', 'sales.void']));
    expect(ROLE_PERMISSIONS.waiter).not.toContain('sales.edit');
  });
});
