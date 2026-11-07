import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { balances, ledger, recordAccountPayment, saveAccount } from '../../src/services/accountService';
import { openCash, summarize } from '../../src/services/cashService';
import { CONSUMIDOR_FINAL, chargeTicket } from '../../src/services/fiscalService';
import { addLine, addNumberedTables, closeTicket, openTicket, saveMenuItem, sendToKitchen } from '../../src/services/salonService';
import { updateSettings } from '../../src/services/settingsService';

async function ticketOf(total: number) {
  if (!(await db.diningTables.count())) await addNumberedTables(1, 6, 'Salón');
  const all = await db.diningTables.orderBy('order').toArray();
  const busy = new Set((await db.tickets.where('status').anyOf('abierta', 'cuenta').toArray()).map((t) => t.tableId));
  const item = await saveMenuItem({ name: `Plato ${total}`, section: 'Platos', price: total, kitchen: false });
  const t = await openTicket(all.find((x) => !busy.has(x.id))!.id);
  const r = await addLine(t.id, item, 1);
  await sendToKitchen(t.id);
  return r;
}

beforeEach(async () => {
  await updateSettings({ fiscal: { enabled: false, serviceUrl: '', ambiente: 'homologacion', cuit: '', razonSocial: '', domicilio: '', condicionIva: 'RI', ptoVta: 1, concepto: 1, ivaDefault: 21, letraA: 'A' } });
});

describe('cuenta corriente e invitaciones', () => {
  it('lo cargado a cuenta corriente cierra la mesa pero no entra en la caja; el pago sí', async () => {
    const session = await openCash(1000);
    const alades = await saveAccount({ name: 'ALADES' });
    await expect(saveAccount({ name: 'alades' })).rejects.toThrow(/Ya hay/);

    // Mesa 1: 10.000, 4.000 en efectivo + 6.000 a cuenta de ALADES.
    const t1 = await ticketOf(10000);
    await expect(chargeTicket(t1.id, { payments: [{ method: 'cuenta_corriente', amount: 10000 }], invoice: false })).rejects.toThrow(/cliente/);
    const r1 = await chargeTicket(t1.id, { payments: [{ method: 'efectivo', amount: 4000 }, { method: 'cuenta_corriente', amount: 6000, accountId: alades.id, accountName: 'ALADES' }], invoice: false });
    expect(r1.remaining).toBe(0);
    await closeTicket(t1.id);
    expect((await db.tickets.get(t1.id))!.status).toBe('cerrada');

    // Mesa 2: invitación, con motivo obligatorio y sin factura.
    const t2 = await ticketOf(2500);
    await expect(chargeTicket(t2.id, { payments: [{ method: 'invitacion', amount: 2500 }], invoice: false })).rejects.toThrow(/motivo/);
    await expect(chargeTicket(t2.id, { payments: [{ method: 'invitacion', amount: 2500, note: 'De la casa' }], invoice: { receptor: CONSUMIDOR_FINAL } })).rejects.toThrow(/no se facturan/);
    await chargeTicket(t2.id, { payments: [{ method: 'invitacion', amount: 2500, note: 'De la casa' }], invoice: false });
    // La propina no puede ir a cuenta corriente.
    const t3 = await ticketOf(1000);
    await expect(chargeTicket(t3.id, { payments: [{ method: 'efectivo', amount: 1000 }], invoice: false, tip: { amount: 100, method: 'cuenta_corriente' } })).rejects.toThrow(/propina/);

    const tickets = await db.tickets.toArray();
    let sum = summarize(session, tickets, await db.cashMovements.toArray());
    expect(sum.expected.efectivo).toBe(5000);
    expect(sum.totalSales).toBe(4000);
    expect(sum.onAccount).toBe(6000);
    expect(sum.invitations).toBe(2500);

    const accounts = await db.accounts.toArray();
    expect(balances(accounts, tickets, await db.cashMovements.toArray())[0]).toMatchObject({ charged: 6000, paid: 0, balance: 6000 });

    // ALADES paga 5.000 por transferencia: entra en la caja como ingreso.
    await expect(recordAccountPayment(alades.id, 5000, 'cuenta_corriente')).rejects.toThrow(/plata/);
    await recordAccountPayment(alades.id, 5000, 'transferencia', 'parcial');
    const movements = await db.cashMovements.toArray();
    sum = summarize(session, tickets, movements);
    expect(sum.expected.transferencia).toBe(5000);
    expect(balances(accounts, tickets, movements)[0]).toMatchObject({ charged: 6000, paid: 5000, balance: 1000 });
    expect(ledger(alades.id, tickets, movements).map((e) => [e.kind, e.amount, e.balance])).toEqual([['cargo', 6000, 6000], ['pago', 5000, 1000]]);
  });
});
