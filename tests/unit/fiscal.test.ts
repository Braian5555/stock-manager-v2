import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import type { FiscalLine, TableTicket } from '../../src/models';
import {
  CONSUMIDOR_FINAL, chargeTicket, computeAmounts, createDoc, invoiceLater, issue, letterFor, noteFor, qrUrl, receptorProblems, transport,
} from '../../src/services/fiscalService';
import { addLine, addNumberedTables, closeTicket, openTicket, saveMenuItem, sendToKitchen } from '../../src/services/salonService';
import { updateSettings } from '../../src/services/settingsService';
import { consult, emit, lastAuthorized } from '../../workers/arca/worker.js';
import { CUIT, CUIT_CLIENTE, fakeArca, kv, makeCert } from './arca-fixtures';

/** Conecta la app con el Worker real (sus funciones) y una ARCA simulada, sin red. */
let arca: ReturnType<typeof fakeArca>;
let env: Record<string, unknown>;
let down: '' | 'before' | 'always' = '';
function wire() {
  arca = fakeArca();
  env = { ARCA_CUIT: CUIT, ARCA_HOMO_CERT: makeCert().cert, ARCA_HOMO_KEY: makeCert().pkcs8, ARCA_WORKSPACE: 'ws', ARCA_TA: kv() };
  transport.call = (async (path: string, body: Record<string, unknown>) => {
    if (down === 'always') throw new TypeError('Failed to fetch');
    const log: unknown[] = [];
    const b = { ambiente: 'homologacion', ...body } as unknown as { ptoVta: number; cbteTipo: number; nro: number; doc: Record<string, unknown> };
    if (path === '/last') {
      if (down === 'before') throw new TypeError('Failed to fetch');
      return { status: 200, data: { nro: await lastAuthorized(env, 'homologacion', b.ptoVta, b.cbteTipo, arca.f, log), log } };
    }
    if (path === '/consult') return { status: 200, data: { found: await consult(env, 'homologacion', b.ptoVta, b.cbteTipo, b.nro, arca.f, log), log } };
    if (path === '/emit') {
      const r = await emit(env, 'homologacion', b.doc, arca.f, log);
      return { status: r.status === 'invalida' ? 422 : 200, data: { ...r, log } };
    }
    return { status: 404, data: { message: 'no' } };
  }) as typeof transport.call;
}

const FISCAL = { enabled: true, serviceUrl: 'https://arca.example.workers.dev', ambiente: 'homologacion' as const, cuit: CUIT, razonSocial: 'Epicurae SA', domicilio: 'Av. Siempre Viva 123', condicionIva: 'RI' as const, ptoVta: 5, concepto: 1 as const, ivaDefault: 21 as const, letraA: 'A' as const };

async function servedTable(): Promise<TableTicket> {
  if (!(await db.diningTables.count())) await addNumberedTables(1, 4, 'Salón');
  const tables = await db.diningTables.orderBy('order').toArray();
  const busy = new Set((await db.tickets.where('status').anyOf('abierta', 'cuenta').toArray()).map((t) => t.tableId));
  const t = await openTicket(tables.find((x) => !busy.has(x.id))!.id);
  const desayuno = (await db.menuItems.where('name').equals('Desayuno americano').first()) ?? await saveMenuItem({ name: 'Desayuno americano', section: 'Desayunos', price: 9500, kitchen: true });
  const agua = (await db.menuItems.where('name').equals('Agua mineral').first()) ?? await saveMenuItem({ name: 'Agua mineral', section: 'Bebidas', price: 2100, kitchen: false, iva: 21 });
  await addLine(t.id, desayuno, 2);
  await addLine(t.id, agua);
  await sendToKitchen(t.id);
  return (await db.tickets.get(t.id))!;
}

beforeAll(() => { makeCert(); });
beforeEach(async () => {
  down = '';
  wire();
  await updateSettings({ fiscal: FISCAL });
});

describe('facturación: tipo de comprobante e importes', () => {
  it('letra según emisor y receptor', () => {
    expect(letterFor(FISCAL, 5)).toBe('B');
    expect(letterFor(FISCAL, 1)).toBe('A');
    expect(letterFor(FISCAL, 6)).toBe('A'); // monotributista recibe A
    expect(letterFor(FISCAL, 4)).toBe('B');
    expect(letterFor({ ...FISCAL, letraA: 'M' }, 1)).toBe('M');
    expect(letterFor({ ...FISCAL, condicionIva: 'MONO' }, 1)).toBe('C');
  });

  it('separa neto e IVA por alícuota desde precios con IVA incluido; la C no discrimina', () => {
    const lines: FiscalLine[] = [
      { name: 'Desayuno', qty: 2, unitPrice: 9500, iva: 21, total: 19000 },
      { name: 'Pan', qty: 1, unitPrice: 1105, iva: 10.5, total: 1105 },
    ];
    const a = computeAmounts(lines, 'B');
    expect(a.impTotal).toBe(20105);
    expect(a.iva).toEqual([{ id: 5, rate: 21, baseImp: 15702.48, importe: 3297.52 }, { id: 4, rate: 10.5, baseImp: 1000, importe: 105 }]);
    expect(a.impNeto + a.impIva).toBeCloseTo(a.impTotal, 2);
    expect(computeAmounts(lines, 'C')).toMatchObject({ impTotal: 20105, impNeto: 20105, impIva: 0, iva: [] });
  });

  it('valida los datos del cliente', () => {
    expect(receptorProblems(CONSUMIDOR_FINAL, 'B', 5000)).toEqual([]);
    expect(receptorProblems(CONSUMIDOR_FINAL, 'A', 5000).join()).toMatch(/CUIT del cliente/);
    expect(receptorProblems(CONSUMIDOR_FINAL, 'B', 10_000_000).join()).toMatch(/identificar al cliente/);
    expect(receptorProblems({ docTipo: 80, docNro: '20-33333333-0', nombre: 'X', condicionIva: 1 }, 'A', 5000).join()).toMatch(/no es válido/);
    expect(receptorProblems({ docTipo: 80, docNro: CUIT_CLIENTE, nombre: 'Cliente SA', condicionIva: 1 }, 'A', 5000)).toEqual([]);
  });
});

describe('facturación: cobrar la mesa y pedir el CAE', () => {
  it('cobra, emite Factura B a consumidor final con CAE y la mesa no va a Maxirest', async () => {
    const t = await servedTable();
    expect(t.total).toBe(21100);
    const { ticket, doc } = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: 21100, received: 25000 }], invoice: { receptor: CONSUMIDOR_FINAL } });
    expect(doc).toMatchObject({ status: 'autorizada', letra: 'B', cbteTipo: 6, nro: 1, ptoVta: 5, impTotal: 21100, impNeto: 17438.02, impIva: 3661.98 });
    expect(doc!.cae).toMatch(/^\d{14}$/);
    expect(ticket.fiscalDocId).toBe(doc!.id);
    const closed = await closeTicket(t.id, { maxirest: false });
    expect(closed.maxirest).toBeUndefined();
    expect((await db.fiscalLog.where('docId').equals(doc!.id).toArray()).map((l) => l.op)).toContain('WSFE.FECAESolicitar');
  });

  it('Factura A a un responsable inscripto con CUIT', async () => {
    const t = await servedTable();
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'transferencia', amount: t.total }], invoice: { receptor: { docTipo: 80, docNro: CUIT_CLIENTE, nombre: 'Cliente SA', condicionIva: 1 } } });
    expect(doc).toMatchObject({ status: 'autorizada', letra: 'A', cbteTipo: 1, nro: 1 });
    expect(arca.state.lastBody).toContain(`<ar:DocTipo>80</ar:DocTipo><ar:DocNro>${CUIT_CLIENTE}</ar:DocNro>`);
  });

  it('no cobra si los pagos no suman el total o hay platos sin mandar', async () => {
    const t = await servedTable();
    await expect(chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: 100 }], invoice: false })).rejects.toThrow(/no suman/);
    const item = (await db.menuItems.toArray())[0];
    await addLine(t.id, item);
    await expect(chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: t.total + item.price }], invoice: false })).rejects.toThrow(/sin mandar/);
  });

  it('se pierde la respuesta de ARCA → queda sin confirmar; al reintentar recupera el mismo CAE (una sola factura)', async () => {
    arca.state.mode.solicitar = 'drop';
    const t = await servedTable();
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'debito', amount: t.total }], invoice: { receptor: CONSUMIDOR_FINAL } });
    expect(doc).toMatchObject({ status: 'incierta', attempt: { nro: 1 } });
    expect(doc!.cae).toBeUndefined();
    const again = await issue(doc!.id);
    expect(again).toMatchObject({ status: 'autorizada', nro: 1, cae: arca.state.docs.get('5-6-1')!.cae });
    expect(again.message).toMatch(/Recuperado/);
    expect(arca.state.docs.size).toBe(1);
  });

  it('la app se cerró en medio del envío (quedó "enviando"): reintentar no duplica', async () => {
    const t = await servedTable();
    const d = await createDoc({ kind: 'factura', receptor: CONSUMIDOR_FINAL, lines: [{ name: 'Café', qty: 1, unitPrice: 3200, iva: 21, total: 3200 }], ticket: t });
    await db.fiscalDocs.update(d.id, { status: 'enviando', attempt: { nro: 1, fecha: '20260101', at: new Date().toISOString() } });
    arca.state.mode.solicitar = 'drop';
    expect((await issue(d.id)).status).toBe('incierta');
    expect((await issue(d.id)).status).toBe('autorizada');
    expect((await issue(d.id)).nro).toBe(1);
    expect(arca.state.docs.size).toBe(1);
  });

  it('servicio inaccesible: antes de reservar número queda con error; ya reservado queda sin confirmar', async () => {
    const t = await servedTable();
    down = 'before';
    const a = await createDoc({ kind: 'factura', receptor: CONSUMIDOR_FINAL, lines: [{ name: 'Café', qty: 1, unitPrice: 3200, iva: 21, total: 3200 }], ticket: t });
    expect(await issue(a.id)).toMatchObject({ status: 'error' });
    down = 'always';
    await db.fiscalDocs.update(a.id, { status: 'enviando', attempt: { nro: 1, fecha: '20260101', at: '' } });
    expect(await issue(a.id)).toMatchObject({ status: 'incierta' });
    down = '';
    expect(await issue(a.id)).toMatchObject({ status: 'autorizada', nro: 1 });
  });

  it('rechazo de ARCA: queda rechazada sin número; se puede volver a emitir con otros datos', async () => {
    arca.state.mode.solicitar = 'reject';
    const t = await servedTable();
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'credito', amount: t.total }], invoice: { receptor: CONSUMIDOR_FINAL } });
    expect(doc).toMatchObject({ status: 'rechazada' });
    expect(doc!.attempt).toBeUndefined();
    expect(doc!.message).toMatch(/10013/);
    arca.state.mode.solicitar = '';
    const fixed = await invoiceLater(t.id, CONSUMIDOR_FINAL);
    expect(fixed).toMatchObject({ status: 'autorizada', nro: 1 });
    expect((await db.tickets.get(t.id))!.fiscalDocId).toBe(fixed.id);
  });

  it('dos cajas facturando a la vez: números correlativos sin repetir', async () => {
    const t1 = await servedTable();
    const t2 = await servedTable();
    const [a, b] = await Promise.all([
      chargeTicket(t1.id, { payments: [{ method: 'efectivo', amount: t1.total }], invoice: { receptor: CONSUMIDOR_FINAL } }),
      chargeTicket(t2.id, { payments: [{ method: 'efectivo', amount: t2.total }], invoice: { receptor: CONSUMIDOR_FINAL } }),
    ]);
    expect([a.doc!.status, b.doc!.status]).toEqual(['autorizada', 'autorizada']);
    expect([a.doc!.nro, b.doc!.nro].sort()).toEqual([1, 2]);
    expect(arca.state.docs.size).toBe(2);
  });

  it('nota de crédito total asociada; no se puede acreditar más que la factura', async () => {
    const t = await servedTable();
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: t.total }], invoice: { receptor: CONSUMIDOR_FINAL } });
    const nc = await noteFor(doc!, 'nc');
    expect(nc).toMatchObject({ status: 'autorizada', kind: 'nc', cbteTipo: 8, impTotal: doc!.impTotal, asociado: { cbteTipo: 6, ptoVta: 5, nro: 1, docId: doc!.id } });
    await expect(noteFor(doc!, 'nc')).rejects.toThrow(/supera/);
    // El comprobante autorizado no se modifica.
    expect(await issue(doc!.id)).toMatchObject({ status: 'autorizada', cae: doc!.cae });
  });

  it('el QR lleva los datos oficiales del comprobante', async () => {
    const t = await servedTable();
    const { doc } = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: t.total }], invoice: { receptor: CONSUMIDOR_FINAL } });
    const url = qrUrl(doc!);
    expect(url.startsWith('https://www.arca.gob.ar/fe/qr/?p=')).toBe(true);
    const data = JSON.parse(Buffer.from(url.split('?p=')[1], 'base64').toString('utf8'));
    expect(data).toEqual({ ver: 1, fecha: `${doc!.fecha!.slice(0, 4)}-${doc!.fecha!.slice(4, 6)}-${doc!.fecha!.slice(6)}`, cuit: Number(CUIT), ptoVta: 5, tipoCmp: 6, nroCmp: 1, importe: t.total, moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: Number(doc!.cae) });
  });

  it('sin configuración fiscal completa no se emite', async () => {
    await updateSettings({ fiscal: { ...FISCAL, ptoVta: 0 } });
    const t = await servedTable();
    await expect(chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: t.total }], invoice: { receptor: CONSUMIDOR_FINAL } })).rejects.toThrow(/punto de venta/);
    // Sin factura se puede cobrar igual: queda para facturar después.
    const r = await chargeTicket(t.id, { payments: [{ method: 'efectivo', amount: t.total }], invoice: false });
    expect(r.ticket.fiscalPending).toBe(true);
  });
});

