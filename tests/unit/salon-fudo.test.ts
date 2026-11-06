import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { addMovement, closeCash, differences, openCash, summarize } from '../../src/services/cashService';
import { CONSUMIDOR_FINAL, chargeTicket, noteFor, transport } from '../../src/services/fiscalService';
import {
  addCustomLine, addLine, addNumberedTables, closeTicket, openCounterTicket, openTicket, placeTable, remainingAmount, saveMenuItem, sendToKitchen, setComp, setDiscount, ticketLabel,
} from '../../src/services/salonService';
import { updateSettings } from '../../src/services/settingsService';
import { consult, emit, lastAuthorized } from '../../workers/arca/worker.js';
import { CUIT, fakeArca, kv, makeCert } from './arca-fixtures';

let arca: ReturnType<typeof fakeArca>;
function wire() {
  arca = fakeArca();
  const env = { ARCA_CUIT: CUIT, ARCA_HOMO_CERT: makeCert().cert, ARCA_HOMO_KEY: makeCert().pkcs8, ARCA_WORKSPACE: 'ws', ARCA_TA: kv() };
  transport.call = (async (path: string, body: Record<string, unknown>) => {
    const log: unknown[] = [];
    const b = body as unknown as { ptoVta: number; cbteTipo: number; nro: number; doc: Record<string, unknown> };
    if (path === '/last') return { status: 200, data: { nro: await lastAuthorized(env, 'homologacion', b.ptoVta, b.cbteTipo, arca.f, log), log } };
    if (path === '/consult') return { status: 200, data: { found: await consult(env, 'homologacion', b.ptoVta, b.cbteTipo, b.nro, arca.f, log), log } };
    const r = await emit(env, 'homologacion', b.doc, arca.f, log);
    return { status: r.status === 'invalida' ? 422 : 200, data: { ...r, log } };
  }) as typeof transport.call;
}
const FISCAL = { enabled: true, serviceUrl: 'https://arca.example.workers.dev', ambiente: 'homologacion' as const, cuit: CUIT, razonSocial: 'Epicurae SA', domicilio: 'Av. 123', condicionIva: 'RI' as const, ptoVta: 5, concepto: 1 as const, ivaDefault: 21 as const, letraA: 'A' as const };

async function items() {
  const cafe = await saveMenuItem({ name: 'Café con leche', section: 'Cafetería', price: 3000, kitchen: false, extras: [{ name: 'Leche de almendras', price: 500 }, { name: 'Shot extra', price: 700 }] });
  const desayuno = await saveMenuItem({ name: 'Desayuno americano', section: 'Desayunos', price: 9000, kitchen: true });
  const pan = await saveMenuItem({ name: 'Pan casero', section: 'Panadería', price: 2210, kitchen: false, iva: 10.5 });
  return { cafe, desayuno, pan };
}
async function table() {
  if (!(await db.diningTables.count())) await addNumberedTables(1, 6, 'Salón');
  const all = await db.diningTables.orderBy('order').toArray();
  const busy = new Set((await db.tickets.where('status').anyOf('abierta', 'cuenta').toArray()).map((t) => t.tableId));
  return openTicket(all.find((t) => !busy.has(t.id))!.id);
}

beforeEach(async () => {
  makeCert();
  wire();
  await updateSettings({ fiscal: FISCAL });
});

describe('salón tipo Fudo: pedido', () => {
  it('adicionales suman al precio y separan líneas; cortesía y descuento bajan el total', async () => {
    const { cafe, desayuno } = await items();
    let t = await table();
    t = await addLine(t.id, cafe, 1, undefined, [cafe.extras![0]]);
    t = await addLine(t.id, cafe, 1, undefined, [cafe.extras![0]]);
    t = await addLine(t.id, cafe);
    t = await addLine(t.id, desayuno, 2);
    expect(t.lines.map((l) => [l.name, l.qty, l.price])).toEqual([
      ['Café con leche + Leche de almendras', 2, 3500], ['Café con leche', 1, 3000], ['Desayuno americano', 2, 9000],
    ]);
    expect(t.total).toBe(28000);
    t = await setComp(t.id, t.lines[1].id, true);
    expect(t.total).toBe(25000);
    t = await setDiscount(t.id, { kind: 'pct', value: 10, reason: 'Cliente habitual' });
    expect([t.subtotal, t.total]).toEqual([25000, 22500]);
    t = await setDiscount(t.id, { kind: 'monto', value: 1000 });
    expect(t.total).toBe(24000);
    await expect(setDiscount(t.id, { kind: 'pct', value: 120 })).rejects.toThrow(/100%/);
    t = await setDiscount(t.id, null);
    expect(t.total).toBe(25000);
  });

  it('mostrador, para llevar y delivery: sin mesa, con cliente y envío', async () => {
    await expect(openCounterTicket('delivery', { name: 'Ana' })).rejects.toThrow(/dirección/);
    const d = await openCounterTicket('delivery', { name: 'Ana', phone: '11 5555', address: 'Mitre 123' }, 1500);
    expect(ticketLabel(d)).toBe('Delivery · Ana');
    expect(d.lines).toMatchObject([{ name: 'Envío', price: 1500, custom: true, status: 'entregado' }]);
    expect(d.total).toBe(1500);
    const m = await openCounterTicket('mostrador');
    expect(ticketLabel(m)).toBe(`Mostrador · #${m.number}`);
    expect(m.number).toBe(d.number + 1);
    const t = await addCustomLine(m.id, 'Varios', 800);
    expect(t.total).toBe(800);
  });

  it('el plano guarda posición, forma y tamaño', async () => {
    await addNumberedTables(1, 2, 'Terraza');
    const [a] = await db.diningTables.orderBy('order').toArray();
    const p = await placeTable(a.id, { x: 130, y: -5, shape: 'redonda', size: 3 });
    expect(p).toMatchObject({ x: 100, y: 0, shape: 'redonda', size: 3 });
  });
});

describe('salón tipo Fudo: dividir la cuenta', () => {
  it('3 partes iguales, cada una con su factura; la última cubre el resto exacto', async () => {
    const { desayuno } = await items();
    let t = await table();
    t = await addLine(t.id, desayuno, 1);
    t = await addLine(t.id, (await db.menuItems.where('name').equals('Café con leche').first())!, 1);
    await sendToKitchen(t.id);
    expect(t.total).toBe(12000);
    const parts: number[] = [];
    for (let i = 1; i <= 3; i++) {
      const cur = (await db.tickets.get(t.id))!;
      const amount = i < 3 ? Math.round((cur.total / 3) * 100) / 100 : remainingAmount(cur);
      const r = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount }], invoice: { receptor: CONSUMIDOR_FINAL }, part: i < 3 ? { kind: 'equal', amount, label: `${i} de 3` } : { kind: 'rest' } });
      expect(r.doc).toMatchObject({ status: 'autorizada', impTotal: amount, nro: i });
      expect(r.doc!.bonif).toBeUndefined();
      parts.push(r.doc!.impTotal);
      if (i < 3) expect(r.ticket.paidAt).toBeUndefined();
      else expect(r.remaining).toBe(0);
    }
    expect(parts.reduce((a, b) => a + b, 0)).toBe(12000);
    const done = await closeTicket(t.id, { maxirest: false });
    expect(done.charges!.map((c) => c.label)).toEqual(['1 de 3', '2 de 3', 'Resto']);
    expect(arca.state.docs.size).toBe(3);
  });

  it('por ítems: cada uno paga lo suyo (con el descuento aplicado)', async () => {
    const { desayuno, pan } = await items();
    let t = await table();
    t = await addLine(t.id, desayuno, 2);
    t = await addLine(t.id, pan, 1);
    await sendToKitchen(t.id);
    t = await setDiscount(t.id, { kind: 'pct', value: 10 });
    expect(t.total).toBe(18189);
    const des = t.lines.find((l) => l.name === 'Desayuno americano')!;
    const r1 = await chargeTicket(t.id, { payments: [{ method: 'debito', amount: 8100 }], invoice: { receptor: CONSUMIDOR_FINAL }, part: { kind: 'items', items: [{ lineId: des.id, qty: 1 }] } });
    expect(r1.doc).toMatchObject({ status: 'autorizada', impTotal: 8100, bonif: 900 });
    expect(r1.remaining).toBe(10089);
    await expect(chargeTicket(t.id, { payments: [{ method: 'debito', amount: 1 }], invoice: false, part: { kind: 'items', items: [{ lineId: des.id, qty: 2 }] } })).rejects.toThrow(/quedan 1/);
    const rest = t.lines.map((l) => ({ lineId: l.id, qty: l.name === 'Desayuno americano' ? 1 : 1 }));
    const r2 = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: 10089 }], invoice: { receptor: CONSUMIDOR_FINAL }, part: { kind: 'items', items: rest } });
    expect(r2.remaining).toBe(0);
    expect(r2.doc!.impTotal).toBe(10089);
    // Alícuotas mezcladas (21% y 10,5%) prorrateadas: neto + IVA = total.
    expect(r2.doc!.iva.map((a) => a.rate)).toEqual([21, 10.5]);
    expect(Math.round((r2.doc!.impNeto + r2.doc!.impIva) * 100) / 100).toBe(10089);
  });

  it('factura con descuento: bonificación en la factura y la nota de crédito respeta la proporción', async () => {
    const { desayuno } = await items();
    let t = await table();
    t = await addLine(t.id, desayuno, 2);
    await sendToKitchen(t.id);
    t = await setDiscount(t.id, { kind: 'monto', value: 3000 });
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: 15000 }], invoice: { receptor: CONSUMIDOR_FINAL } });
    expect(doc).toMatchObject({ status: 'autorizada', impTotal: 15000, bonif: 3000 });
    const nc = await noteFor(doc!, 'nc', [{ ...doc!.lines[0], qty: 1, total: 9000 }]);
    expect(nc).toMatchObject({ status: 'autorizada', impTotal: 7500 });
  });
});

describe('salón tipo Fudo: caja', () => {
  it('abre, anota cobros con propina, egresos, y cierra con arqueo y diferencia', async () => {
    const { desayuno } = await items();
    // Cobro sin caja abierta: entra en la próxima.
    const t0 = await table();
    await addLine(t0.id, desayuno, 1);
    await sendToKitchen(t0.id);
    await chargeTicket(t0.id, { payments: [{ method: 'qr', amount: 9000 }], invoice: false });
    const s = await openCash(10000);
    await expect(openCash(0)).rejects.toThrow(/Ya hay una caja abierta/);
    expect((await db.tickets.get(t0.id))!.charges![0].cashSessionId).toBe(s.id);

    const t = await table();
    await addLine(t.id, desayuno, 2);
    await sendToKitchen(t.id);
    await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: 10000 }, { method: 'credito', amount: 8000 }], invoice: false, tip: { amount: 1800, method: 'efectivo' } });
    await addMovement('egreso', 2500, 'Pago a proveedor');
    await addMovement('ingreso', 1000, 'Cambio');
    await expect(addMovement('egreso', 0, 'x')).rejects.toThrow(/mayor a cero/);

    const tickets = await db.tickets.toArray();
    const sum = summarize(s, tickets, await db.cashMovements.toArray());
    expect(sum.totalSales).toBe(27000);
    expect(sum.totalTips).toBe(1800);
    expect(sum.expected).toMatchObject({ efectivo: 10000 + 10000 + 1800 - 2500 + 1000, credito: 8000, qr: 9000 });

    const closed = await closeCash(s.id, { efectivo: 20000, credito: 8000, qr: 9000 }, 'Faltó el vuelto de una mesa');
    expect(closed.status).toBe('cerrada');
    const diffs = differences(closed);
    expect(diffs.find((d) => d.method === 'efectivo')).toMatchObject({ expected: 20300, counted: 20000, diff: -300 });
    expect(diffs.find((d) => d.method === 'credito')!.diff).toBe(0);
    await expect(closeCash(s.id, {})).rejects.toThrow(/ya está cerrada/);
    await expect(addMovement('egreso', 10, 'x')).rejects.toThrow(/No hay una caja abierta/);
  });
});
