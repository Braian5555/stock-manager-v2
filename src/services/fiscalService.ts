/**
 * Facturación electrónica ARCA desde Stock Manager.
 *
 * La app arma el comprobante (importes, IVA, receptor) y lo manda al servicio de ARCA (Cloudflare
 * Worker), que es el único que tiene el certificado. Reglas que se respetan acá:
 *  - Nunca se marca "autorizada" sin un CAE válido devuelto por ARCA.
 *  - El número a pedir se anota en el comprobante ANTES de enviarlo: si la respuesta se pierde,
 *    el reintento consulta ese número en ARCA en vez de pedir otro (no se duplican facturas).
 *  - Un comprobante autorizado no se modifica: para anularlo se hace una nota de crédito.
 */
import { cloudSession } from '../cloud/cloudService';
import { db } from '../database/db';
import type {
  DocTipo, EmisorCondicion, FiscalDoc, FiscalKind, FiscalLetter, FiscalLine, FiscalLogEntry, FiscalReceptor, FiscalSettings, IvaRate, MenuItem, Payment, SalePaymentMethod, TableTicket,
} from '../models';
import { nowIso, uuid } from '../utils/id';
import { getSettings } from './settingsService';
import { getCurrentActor } from './userService';

export const IVA_RATES: IvaRate[] = [21, 10.5, 27, 5, 2.5, 0];
export const IVA_ID: Record<IvaRate, number> = { 0: 3, 2.5: 9, 5: 8, 10.5: 4, 21: 5, 27: 6 };
export const CBTE_TIPO: Record<FiscalLetter, Record<FiscalKind, number>> = {
  A: { factura: 1, nd: 2, nc: 3 },
  B: { factura: 6, nd: 7, nc: 8 },
  C: { factura: 11, nd: 12, nc: 13 },
  M: { factura: 51, nd: 52, nc: 53 },
};
export const CBTE_NAME: Record<number, string> = {
  1: 'Factura A', 2: 'Nota de débito A', 3: 'Nota de crédito A',
  6: 'Factura B', 7: 'Nota de débito B', 8: 'Nota de crédito B',
  11: 'Factura C', 12: 'Nota de débito C', 13: 'Nota de crédito C',
  51: 'Factura M', 52: 'Nota de débito M', 53: 'Nota de crédito M',
};
export const COND_IVA: Record<number, string> = {
  5: 'Consumidor Final', 1: 'IVA Responsable Inscripto', 6: 'Responsable Monotributo', 4: 'IVA Sujeto Exento',
  15: 'IVA No Alcanzado', 13: 'Monotributista Social', 16: 'Monotributo Trabajador Independiente Promovido',
  7: 'Sujeto No Categorizado', 10: 'IVA Liberado – Ley N° 19.640',
};
export const EMISOR_COND_LABEL: Record<EmisorCondicion, string> = { RI: 'IVA Responsable Inscripto', MONO: 'Responsable Monotributo', EXENTO: 'IVA Sujeto Exento' };
export const DOC_TIPO_LABEL: Record<DocTipo, string> = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Sin identificar' };
export const PAYMENT_LABEL: Record<SalePaymentMethod, string> = { efectivo: 'Efectivo', debito: 'Débito', credito: 'Crédito', transferencia: 'Transferencia', qr: 'QR / billetera', otro: 'Otro' };
/** RG 5700/2025: desde este importe hay que identificar al consumidor final. */
export const CF_ID_THRESHOLD = 10_000_000;
export const CONSUMIDOR_FINAL: FiscalReceptor = { docTipo: 99, docNro: '0', condicionIva: 5 };

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function validCuit(c: string): boolean {
  const s = String(c ?? '').replace(/\D/g, '');
  if (!/^\d{11}$/.test(s)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (w.reduce((a, x, i) => a + x * Number(s[i]), 0) % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(s[10]);
}
export const fmtCuit = (c: string) => {
  const s = String(c ?? '').replace(/\D/g, '');
  return s.length === 11 ? `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}` : c;
};
/** Hoy en Argentina, AAAAMMDD. */
export const todayAR = (now = Date.now()) => new Date(now - 3 * 3600_000).toISOString().slice(0, 10).replace(/-/g, '');
export const ymdToDate = (s?: string) => (s && /^\d{8}$/.test(s) ? `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}` : '—');
export const pad = (n: number | undefined, len: number) => String(n ?? 0).padStart(len, '0');
export const docNumber = (d: Pick<FiscalDoc, 'ptoVta' | 'nro'>) => `${pad(d.ptoVta, 5)}-${pad(d.nro, 8)}`;

export const DEFAULT_FISCAL: FiscalSettings = {
  enabled: false, serviceUrl: '', ambiente: 'homologacion', cuit: '', razonSocial: '', domicilio: '', condicionIva: 'RI',
  ptoVta: 0, concepto: 1, ivaDefault: 21, letraA: 'A',
};
export const fiscalOf = (s: { fiscal?: FiscalSettings }): FiscalSettings => ({ ...DEFAULT_FISCAL, ...s.fiscal });

/** ¿Está todo lo necesario para facturar? Devuelve lo que falta. */
export function fiscalMissing(f: FiscalSettings): string[] {
  const m: string[] = [];
  if (!/^https:\/\/\S+$/.test(f.serviceUrl.trim())) m.push('la dirección del servicio de ARCA');
  if (!validCuit(f.cuit)) m.push('el CUIT');
  if (!f.razonSocial.trim()) m.push('la razón social');
  if (!f.domicilio.trim()) m.push('el domicilio fiscal');
  if (!(f.ptoVta >= 1 && f.ptoVta <= 99998)) m.push('el punto de venta');
  return m;
}
export const fiscalReady = (f: FiscalSettings) => f.enabled && fiscalMissing(f).length === 0;

// ───────────── tipo de comprobante e importes ─────────────

/**
 * Letra según emisor y receptor (normativa vigente):
 *  - Emisor Responsable Inscripto: A (o M) a Responsables Inscriptos y Monotributistas; B al resto
 *    (consumidor final, exentos, no alcanzados, no categorizados).
 *  - Emisor Monotributista o Exento: siempre C.
 */
export function letterFor(f: Pick<FiscalSettings, 'condicionIva' | 'letraA'>, condicionReceptor: number): FiscalLetter {
  if (f.condicionIva !== 'RI') return 'C';
  return [1, 6, 13, 16].includes(condicionReceptor) ? f.letraA : 'B';
}

/** Importes del comprobante desde líneas con precio final (IVA incluido), agrupando por alícuota. */
export function computeAmounts(lines: FiscalLine[], letra: FiscalLetter) {
  const live = lines.filter((l) => l.qty > 0);
  const impTotal = round2(live.reduce((s, l) => s + l.total, 0));
  if (letra === 'C') return { impTotal, impNeto: impTotal, impIva: 0, impTotConc: 0, impOpEx: 0, impTrib: 0, iva: [] as FiscalDoc['iva'] };
  const groups = new Map<IvaRate, number>();
  for (const l of live) groups.set(l.iva, round2((groups.get(l.iva) ?? 0) + l.total));
  const iva = [...groups.entries()].sort((a, b) => b[0] - a[0]).map(([rate, total]) => {
    const baseImp = round2(total / (1 + rate / 100));
    return { id: IVA_ID[rate], rate, baseImp, importe: round2(total - baseImp) };
  });
  const impNeto = round2(iva.reduce((s, a) => s + a.baseImp, 0));
  const impIva = round2(iva.reduce((s, a) => s + a.importe, 0));
  return { impTotal: round2(impNeto + impIva), impNeto, impIva, impTotConc: 0, impOpEx: 0, impTrib: 0, iva };
}

export function linesFromTicket(t: TableTicket, items: Map<string, MenuItem>, ivaDefault: IvaRate): FiscalLine[] {
  return t.lines.filter((l) => l.qty > 0).map((l) => ({
    name: l.name, qty: l.qty, unitPrice: l.price, iva: items.get(l.menuItemId)?.iva ?? ivaDefault, total: round2(l.qty * l.price),
  }));
}

/** Problemas del receptor para esa letra (vacío = ok). */
export function receptorProblems(r: FiscalReceptor, letra: FiscalLetter, total: number): string[] {
  const p: string[] = [];
  const nro = r.docNro.replace(/\D/g, '');
  if ((letra === 'A' || letra === 'M') && r.docTipo !== 80) p.push('Para factura A hace falta el CUIT del cliente.');
  if ((r.docTipo === 80 || r.docTipo === 86) && !validCuit(nro)) p.push('El CUIT/CUIL no es válido (revisá los números).');
  if (r.docTipo === 96 && !/^\d{6,9}$/.test(nro)) p.push('El DNI no es válido.');
  if (r.docTipo === 99 && total >= CF_ID_THRESHOLD) p.push(`Desde $ ${CF_ID_THRESHOLD.toLocaleString('es-AR')} hay que identificar al cliente (DNI, CUIT o CUIL).`);
  if (r.docTipo !== 99 && r.docTipo !== 96 && !r.nombre?.trim()) p.push('Poné el nombre o razón social del cliente.');
  if (!COND_IVA[r.condicionIva]) p.push('Elegí la condición frente al IVA del cliente.');
  return p;
}

// ───────────── creación de comprobantes ─────────────

const actor = () => {
  const a = getCurrentActor();
  return a ? { id: a.id, name: a.name } : undefined;
};

export async function createDoc(input: {
  kind: FiscalKind; receptor: FiscalReceptor; lines: FiscalLine[]; ticket?: TableTicket; payments?: Payment[];
  asociado?: FiscalDoc['asociado']; letra?: FiscalLetter;
}): Promise<FiscalDoc> {
  const f = fiscalOf(await getSettings());
  const missing = fiscalMissing(f);
  if (!f.enabled) throw new Error('La facturación electrónica no está activada (Configuración → Configuración fiscal).');
  if (missing.length) throw new Error(`Falta completar en Configuración fiscal: ${missing.join(', ')}.`);
  const letra = input.letra ?? letterFor(f, input.receptor.condicionIva);
  const amounts = computeAmounts(input.lines, letra);
  if (!(amounts.impTotal > 0)) throw new Error('El comprobante no tiene importe.');
  const rp = receptorProblems(input.receptor, letra, amounts.impTotal);
  if (rp.length) throw new Error(rp.join(' '));
  const t = nowIso();
  const by = actor();
  const doc: FiscalDoc = {
    id: uuid(), createdAt: t, updatedAt: t,
    kind: input.kind, letra, cbteTipo: CBTE_TIPO[letra][input.kind], ptoVta: f.ptoVta, ambiente: f.ambiente, concepto: f.concepto,
    emisor: { cuit: f.cuit.replace(/\D/g, ''), razonSocial: f.razonSocial.trim(), nombreFantasia: f.nombreFantasia?.trim() || undefined, domicilio: f.domicilio.trim(), condicionIva: f.condicionIva, iibb: f.iibb?.trim() || undefined, inicioActividades: f.inicioActividades || undefined },
    receptor: { ...input.receptor, docNro: input.receptor.docNro.replace(/\D/g, '') || '0', nombre: input.receptor.nombre?.trim() || undefined, domicilio: input.receptor.domicilio?.trim() || undefined },
    lines: input.lines.filter((l) => l.qty > 0),
    ...amounts,
    status: 'borrador',
    ...(input.ticket ? { ticketId: input.ticket.id, tableName: input.ticket.tableName } : {}),
    ...(input.payments?.length ? { payments: input.payments } : {}),
    ...(input.asociado ? { asociado: input.asociado } : {}),
    ...(by ? { createdBy: by } : {}),
  };
  await db.fiscalDocs.add(doc);
  return doc;
}

// ───────────── servicio de ARCA ─────────────

type WorkerLog = { op: string; at: string; ms?: number; status?: number; request?: string; response?: string; error?: string }[];
export interface EmitResult {
  status: 'autorizada' | 'renumerar' | 'incierta' | 'rechazada' | 'invalida' | 'error';
  nro?: number; next?: number; cae?: string; caeVto?: string; fecha?: string; recovered?: boolean;
  obs?: { code?: number; msg?: string }[]; errors?: { code?: number; msg?: string }[]; problems?: string[];
  message?: string; reason?: string; retryable?: boolean; by?: string; log?: WorkerLog;
}

/** Se reemplaza en las pruebas (sin red). */
export const transport = {
  async call<T>(path: string, body: Record<string, unknown>): Promise<{ status: number; data: T & { log?: WorkerLog; message?: string } }> {
    const f = fiscalOf(await getSettings());
    const { token, wsId } = await cloudSession();
    const r = await fetch(`${f.serviceUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Workspace': wsId },
      body: JSON.stringify({ ambiente: f.ambiente, ...body }),
    });
    let data: T & { log?: WorkerLog; message?: string };
    try {
      data = await r.json();
    } catch {
      data = { message: `El servicio de ARCA respondió algo inesperado (HTTP ${r.status}).` } as T & { message: string };
    }
    return { status: r.status, data };
  },
};

const cut = (s?: string) => (s && s.length > 8000 ? `${s.slice(0, 8000)}…` : s);

async function saveLog(log: WorkerLog | undefined, docId: string | undefined, result: string, by?: string) {
  if (!log?.length) return;
  const t = nowIso();
  await db.fiscalLog.bulkAdd(log.map((l) => ({
    id: uuid(), createdAt: t, updatedAt: t, docId, at: l.at, op: l.op, ms: l.ms, status: l.status,
    request: cut(l.request), response: cut(l.response), error: l.error, result, by,
  } satisfies FiscalLogEntry)));
}

async function patch(id: string, p: Partial<FiscalDoc>) {
  const prev = await db.fiscalDocs.get(id);
  if (!prev) throw new Error('El comprobante ya no existe.');
  if (prev.status === 'autorizada') throw new Error('El comprobante ya está autorizado: no se puede modificar.');
  const next = { ...prev, ...p, updatedAt: nowIso() };
  await db.fiscalDocs.put(next);
  return next;
}

const payload = (d: FiscalDoc) => ({
  ptoVta: d.ptoVta, cbteTipo: d.cbteTipo, nro: d.attempt!.nro, concepto: d.concepto, fecha: d.attempt!.fecha,
  docTipo: d.receptor.docTipo, docNro: d.receptor.docNro, condicionIvaReceptor: d.receptor.condicionIva,
  impTotal: d.impTotal, impNeto: d.impNeto, impIva: d.impIva, impTotConc: d.impTotConc, impOpEx: d.impOpEx, impTrib: d.impTrib,
  iva: d.iva.map((a) => ({ id: a.id, baseImp: a.baseImp, importe: a.importe })),
  ...(d.asociado ? { asociado: { cbteTipo: d.asociado.cbteTipo, ptoVta: d.asociado.ptoVta, nro: d.asociado.nro, fecha: d.asociado.fecha } } : {}),
});

/** Otro comprobante local ya tiene ese número autorizado (no puede ser éste). */
async function numberTakenLocally(d: FiscalDoc, nro: number) {
  return (await db.fiscalDocs.where('[cbteTipo+ptoVta+nro]').equals([d.cbteTipo, d.ptoVta, nro]).toArray()).some((x) => x.id !== d.id && x.status === 'autorizada');
}

/**
 * Pide el CAE de un comprobante (o lo recupera si ya se había autorizado). Seguro de reintentar.
 * Devuelve el comprobante actualizado.
 */
export async function issue(docId: string): Promise<FiscalDoc> {
  let d = await db.fiscalDocs.get(docId);
  if (!d) throw new Error('El comprobante no existe.');
  if (d.status === 'autorizada') return d;
  try {
    if (!d.attempt) {
      const last = await transport.call<{ nro: number }>('/last', { ptoVta: d.ptoVta, cbteTipo: d.cbteTipo });
      await saveLog(last.data.log, d.id, last.status === 200 ? 'ultimo' : 'error');
      if (last.status !== 200) return patch(d.id, { status: 'error', message: last.data.message ?? `Error ${last.status} del servicio de ARCA.` });
      d = await patch(d.id, { status: 'enviando', attempt: { nro: last.data.nro + 1, fecha: todayAR(), at: nowIso() }, message: undefined });
    }
    for (let i = 0; i < 4; i++) {
      // La fecha se actualiza en cada intento y se anota ANTES de enviar.
      d = await patch(d.id, { status: 'enviando', attempt: { ...d.attempt!, fecha: todayAR(), at: nowIso() } });
      const r = await transport.call<EmitResult>('/emit', { doc: payload(d) });
      const res = r.data;
      await saveLog(res.log, d.id, res.status ?? `http ${r.status}`, res.by);
      if (r.status !== 200 && r.status !== 422) {
        // El servicio contestó con error antes de pedir el CAE (sesión, permisos, ARCA caída al autenticar).
        return patch(d.id, { status: 'error', message: res.message ?? `Error ${r.status} del servicio de ARCA.` });
      }
      switch (res.status) {
        case 'autorizada': {
          if (!/^\d{14}$/.test(res.cae ?? '') || !res.nro) return patch(d.id, { status: 'incierta', message: 'ARCA respondió sin un CAE válido. Reintentá para consultarlo.' });
          if (res.recovered && (await numberTakenLocally(d, res.nro))) {
            d = await patch(d.id, { attempt: { ...d.attempt!, nro: res.nro + 1 } });
            continue;
          }
          const prev = (await db.fiscalDocs.get(d.id))!;
          const done: FiscalDoc = {
            ...prev, status: 'autorizada', nro: res.nro, fecha: res.fecha ?? d.attempt!.fecha, cae: res.cae, caeVto: res.caeVto,
            authorizedAt: nowIso(), obs: res.obs ?? [], errors: [], message: res.recovered ? 'Recuperado: ya estaba autorizado en ARCA.' : undefined, updatedAt: nowIso(),
          };
          await db.fiscalDocs.put(done);
          return done;
        }
        case 'renumerar':
          d = await patch(d.id, { attempt: { nro: res.next!, fecha: todayAR(), at: nowIso() } });
          continue;
        case 'incierta':
          return patch(d.id, { status: 'incierta', message: res.message ?? 'No se sabe si ARCA lo autorizó. Reintentá: se consulta antes de volver a pedirlo.' });
        case 'rechazada': {
          const all = [...(res.errors ?? []), ...(res.obs ?? [])];
          return patch(d.id, { status: 'rechazada', attempt: undefined, errors: res.errors ?? [], obs: res.obs ?? [], message: all.map((e) => `${e.code}: ${e.msg}`).join(' · ') || 'ARCA rechazó el comprobante.' });
        }
        case 'invalida':
          return patch(d.id, { status: 'error', attempt: undefined, message: (res.problems ?? []).join(' ') });
        default:
          return patch(d.id, { status: 'incierta', message: res.message ?? 'Respuesta inesperada del servicio de ARCA. Reintentá.' });
      }
    }
    return patch(d.id, { status: 'error', message: 'No se pudo conseguir un número libre en ARCA (muchos comprobantes a la vez). Reintentá.' });
  } catch (e) {
    // No se pudo hablar con el servicio: si ya se había anotado el número, puede haber llegado.
    const cur = await db.fiscalDocs.get(docId);
    if (cur?.status === 'autorizada') return cur;
    const msg = e instanceof Error ? e.message : String(e);
    return patch(docId, cur?.status === 'enviando'
      ? { status: 'incierta', message: `Se cortó la conexión (${msg}). Reintentá: se consulta en ARCA antes de volver a pedirlo.` }
      : { status: 'error', message: `No se pudo conectar con el servicio de ARCA (${msg}).` });
  }
}

/** Consulta en ARCA el comprobante autorizado (para verificarlo). */
export async function verifyInArca(doc: FiscalDoc) {
  if (!doc.nro) throw new Error('El comprobante no tiene número.');
  const r = await transport.call<{ found: { cae?: string; impTotal?: number; fecha?: string; resultado?: string } | null }>('/consult', { ptoVta: doc.ptoVta, cbteTipo: doc.cbteTipo, nro: doc.nro });
  await saveLog(r.data.log, doc.id, 'consulta');
  if (r.status !== 200) throw new Error(r.data.message ?? `Error ${r.status}`);
  const f = r.data.found;
  return { exists: !!f, matches: !!f && f.cae === doc.cae && Math.abs((f.impTotal ?? 0) - doc.impTotal) < 0.005, found: f };
}

export async function serviceStatus(probar: boolean) {
  const f = fiscalOf(await getSettings());
  const r = await transport.call<Record<string, unknown>>('/status', { probar, ptoVta: f.ptoVta || undefined });
  await saveLog(r.data.log, undefined, probar ? 'prueba' : 'estado');
  if (r.status !== 200) throw new Error(r.data.message ?? `Error ${r.status}`);
  return r.data;
}

// ───────────── cobro de la mesa ─────────────

/** Cobra la mesa (medios de pago) y, si se pide, arma la factura y la manda a ARCA. */
export async function chargeTicket(ticketId: string, opts: { payments: Payment[]; invoice: false | { receptor: FiscalReceptor } }): Promise<{ ticket: TableTicket; doc?: FiscalDoc }> {
  const ticket = await db.tickets.get(ticketId);
  if (!ticket) throw new Error('El pedido no existe.');
  if (ticket.status !== 'abierta' && ticket.status !== 'cuenta') throw new Error('Esa mesa ya está cerrada.');
  if (ticket.lines.some((l) => l.status === 'nuevo')) throw new Error('Hay platos sin mandar: mandalos a cocina o sacalos antes de cobrar.');
  if (ticket.paidAt) throw new Error('Esa mesa ya se cobró.');
  const paid = round2(opts.payments.reduce((s, p) => s + p.amount, 0));
  if (Math.abs(paid - ticket.total) > 0.009) throw new Error(`Los pagos (${paid.toLocaleString('es-AR')}) no suman el total (${ticket.total.toLocaleString('es-AR')}).`);
  let doc: FiscalDoc | undefined;
  if (opts.invoice) {
    if (ticket.fiscalDocId) {
      const prev = await db.fiscalDocs.get(ticket.fiscalDocId);
      if (prev && prev.status !== 'rechazada' && prev.status !== 'error') throw new Error('Esta mesa ya tiene un comprobante.');
    }
    const s = await getSettings();
    const items = new Map((await db.menuItems.toArray()).map((m) => [m.id, m]));
    doc = await createDoc({ kind: 'factura', receptor: opts.invoice.receptor, lines: linesFromTicket(ticket, items, fiscalOf(s).ivaDefault), ticket, payments: opts.payments });
    if (Math.abs(doc.impTotal - ticket.total) > 0.009) throw new Error('El total de la factura no coincide con el de la mesa.');
  }
  const t = nowIso();
  // Sin factura acá: si Stock Manager factura, queda para facturar después; si no, factura Maxirest.
  const billingHere = fiscalOf(await getSettings()).enabled;
  const next: TableTicket = { ...ticket, payments: opts.payments, paidAt: t, updatedAt: t, ...(doc ? { fiscalDocId: doc.id, fiscalPending: false } : { fiscalPending: billingHere && !ticket.fiscalDocId }) };
  await db.tickets.put(next);
  if (doc) doc = await issue(doc.id);
  return { ticket: next, doc };
}

/** Factura después una mesa ya cobrada (p. ej. si ARCA estaba caída al cerrar). */
export async function invoiceLater(ticketId: string, receptor: FiscalReceptor): Promise<FiscalDoc> {
  const ticket = await db.tickets.get(ticketId);
  if (!ticket) throw new Error('El pedido no existe.');
  if (ticket.fiscalDocId) {
    const prev = await db.fiscalDocs.get(ticket.fiscalDocId);
    if (prev && prev.status !== 'rechazada' && prev.status !== 'error') return issue(prev.id);
  }
  const s = await getSettings();
  const items = new Map((await db.menuItems.toArray()).map((m) => [m.id, m]));
  const doc = await createDoc({ kind: 'factura', receptor, lines: linesFromTicket(ticket, items, fiscalOf(s).ivaDefault), ticket, payments: ticket.payments });
  await db.tickets.put({ ...ticket, fiscalDocId: doc.id, fiscalPending: false, updatedAt: nowIso() });
  return issue(doc.id);
}

/** Nota de crédito (total o por líneas) o de débito asociada a un comprobante autorizado. */
export async function noteFor(original: FiscalDoc, kind: 'nc' | 'nd', lines?: FiscalLine[]): Promise<FiscalDoc> {
  if (original.status !== 'autorizada' || !original.nro) throw new Error('Sólo se puede hacer una nota sobre un comprobante autorizado.');
  if (original.kind !== 'factura') throw new Error('La nota se hace sobre la factura original.');
  const use = lines ?? original.lines;
  if (kind === 'nc') {
    const credited = (await db.fiscalDocs.filter((x) => x.asociado?.docId === original.id && x.kind === 'nc' && x.status === 'autorizada').toArray()).reduce((s, x) => s + x.impTotal, 0);
    const total = round2(use.reduce((s, l) => s + l.total, 0));
    if (round2(credited + total) - original.impTotal > 0.009) throw new Error(`La nota de crédito supera lo que queda de la factura (${round2(original.impTotal - credited).toLocaleString('es-AR')}).`);
  }
  const doc = await createDoc({
    kind, receptor: original.receptor, lines: use, letra: original.letra,
    asociado: { docId: original.id, cbteTipo: original.cbteTipo, ptoVta: original.ptoVta, nro: original.nro, fecha: original.fecha },
  });
  return issue(doc.id);
}

/** Últimos receptores usados (para elegir rápido un cliente con CUIT). */
export async function recentReceptors(limit = 30): Promise<FiscalReceptor[]> {
  const docs = await db.fiscalDocs.orderBy('createdAt').reverse().limit(400).toArray();
  const seen = new Map<string, FiscalReceptor>();
  for (const d of docs) if (d.receptor.docTipo !== 99 && !seen.has(d.receptor.docNro)) seen.set(d.receptor.docNro, d.receptor);
  return [...seen.values()].slice(0, limit);
}

// ───────────── QR fiscal ─────────────

/** Texto del QR oficial: https://www.arca.gob.ar/fe/qr/?p=<JSON en base64>. */
export function qrUrl(d: FiscalDoc): string {
  const f = d.fecha ?? '';
  const data = {
    ver: 1,
    fecha: `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`,
    cuit: Number(d.emisor.cuit),
    ptoVta: d.ptoVta,
    tipoCmp: d.cbteTipo,
    nroCmp: d.nro,
    importe: d.impTotal,
    moneda: 'PES',
    ctz: 1,
    ...(d.receptor.docTipo !== 99 ? { tipoDocRec: d.receptor.docTipo, nroDocRec: Number(d.receptor.docNro) } : { tipoDocRec: 99, nroDocRec: 0 }),
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  };
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(data))));
  return `https://www.arca.gob.ar/fe/qr/?p=${b64}`;
}
