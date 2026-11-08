/**
 * Impresión en impresoras térmicas de 80 mm (desde el diálogo de impresión del navegador).
 * Tres documentos distintos, bien diferenciados:
 *  - Comprobante fiscal (factura / nota): con CAE, vencimiento y QR de ARCA.
 *  - Pre-cuenta: lo consumido con precios. NO VÁLIDO COMO FACTURA.
 *  - Comanda: para cocina, sin precios. NO VÁLIDO COMO FACTURA.
 */
import QRCode from 'qrcode';
import type { DailyClose } from './closingService';
import type { CashSession, FiscalDoc, Outlet, SalePaymentMethod, TableTicket, TicketLine } from '../models';
import type { CashSummary } from './cashService';
import { CBTE_NAME, COND_IVA, DOC_TIPO_LABEL, EMISOR_COND_LABEL, PAYMENT_LABEL, docNumber, docPlace, fmtCuit, pad, qrUrl, ymdToDate } from './fiscalService';
import { discountAmount, ticketLabel } from './salonService';
import { currentOutlet } from './localScope';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

/*
 * Estilo de los tickets de 80 mm. En las térmicas (p. ej. 3nStar RPT008 / POS-80C) el texto de
 * trazo fino sale gris y casi ilegible, y el driver no deja subir la densidad: por eso TODO sale en
 * negrita, con una monoespaciada de trazo grueso (Consolas o Lucida Console en Windows) y en negro
 * puro, sin grises. Si algo no entrara en el ancho, se baja 1px el tamaño, nunca se saca la negrita.
 */
const STYLE = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
*, *::before, *::after { color: #000 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  width: 80mm; padding: 3mm 4mm 6mm;
  font-family: 'Consolas', 'Lucida Console', 'Courier New', ui-monospace, monospace;
  font-size: 12px; line-height: 1.3; font-weight: 700;
  -webkit-font-smoothing: none; text-rendering: optimizeLegibility;
}
.c { text-align: center; }
.r { text-align: right; }
.b { font-weight: 700; }
.big { font-size: 15px; font-weight: 700; }
.huge { font-size: 18px; font-weight: 700; letter-spacing: .02em; }
.hr { border-top: 1.5px dashed #000; margin: 5px 0; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row > :first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.row > :last-child:not(:first-child) { flex: none; white-space: nowrap; }
.box { border: 1.5px solid #000; padding: 3px 4px; margin: 4px 0; }
.note { font-size: 11px; font-weight: 700; color: #000; }
.muted { color: #000; font-weight: 700; }
.warn { border: 2px solid #000; padding: 4px; text-align: center; font-weight: 700; margin: 6px 0; }
.qr { display: block; margin: 6px auto 2px; width: 38mm; height: 38mm; image-rendering: pixelated; }
p { margin: 0; overflow-wrap: anywhere; }
`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

/** Abre el diálogo de impresión con el documento (iframe oculto: no sale de la app). */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    const go = () => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
      } finally {
        setTimeout(() => { frame.remove(); resolve(); }, 1500);
      }
    };
    const imgs = [...doc.images];
    if (imgs.every((i) => i.complete)) setTimeout(go, 50);
    else Promise.all(imgs.map((i) => new Promise((r) => { i.onload = r; i.onerror = r; }))).then(() => setTimeout(go, 50));
  });
}

/** Ticket del comprobante fiscal electrónico (80 mm). */
/**
 * Encabezado de los tickets: renglones del encabezado (el primero grande) y la sucursal.
 * Se arma con ticketBusiness(settings); un texto suelto (sin saltos de línea) es sólo el nombre.
 */
export function ticketBusiness(st: { businessName: string; ticketHeader?: string; sucursal?: string }, outlet: Outlet | null | undefined = currentOutlet()): string {
  // Con locales, cada uno puede tener su encabezado; la sucursal es el nombre del local.
  const header = outlet?.ticketHeader?.trim() ? outlet.ticketHeader : st.ticketHeader;
  const sucursal = outlet ? outlet.name : st.sucursal;
  const lines = (header ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const head = lines.length ? lines : [st.businessName];
  return [...head, ...(sucursal?.trim() ? [`Sucursal: ${sucursal.trim()}`] : [])].join('\n');
}
/** Encabezado para la factura: sólo si hay uno propio (general o del local); si no, el nombre de fantasía. */
export function fiscalHeader(st: { businessName: string; ticketHeader?: string; sucursal?: string }): string | undefined {
  const o = currentOutlet();
  return st.ticketHeader?.trim() || o ? ticketBusiness(st, o) : undefined;
}
function headerHtml(business: string): string {
  const [first, ...rest] = business.split('\n');
  return `<p class="c big">${esc(first)}</p>${rest.map((l) => `<p class="c">${esc(l)}</p>`).join('')}`;
}

export async function fiscalTicketHtml(d: FiscalDoc, pie?: string, header?: string): Promise<string> {
  if (d.status !== 'autorizada' || !d.cae || !d.nro) throw new Error('Sólo se imprime un comprobante autorizado por ARCA.');
  const qr = await QRCode.toDataURL(qrUrl(d), { errorCorrectionLevel: 'M', margin: 1, width: 300 });
  const e = d.emisor;
  const r = d.receptor;
  const name = CBTE_NAME[d.cbteTipo] ?? `Comprobante ${d.cbteTipo}`;
  const homo = d.ambiente === 'homologacion';
  const showIva = d.letra === 'A' || d.letra === 'M';
  const lines = d.lines.map((l) => `
    <div class="row"><span>${qtyFmt(l.qty)} x ${money(l.unitPrice)}${showIva ? ` (${String(l.iva).replace('.', ',')}%)` : ''}</span><span class="r">${money(l.total)}</span></div>
    <p>${esc(l.name)}</p>`).join('');
  const ivaRows = showIva
    ? `${d.iva.map((a) => `<div class="row"><span>Neto gravado ${String(a.rate).replace('.', ',')}%</span><span>${money(a.baseImp)}</span></div><div class="row"><span>IVA ${String(a.rate).replace('.', ',')}%</span><span>${money(a.importe)}</span></div>`).join('')}`
    : '';
  const transparency = d.letra === 'B'
    ? `<div class="hr"></div><p class="b note">Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)</p><div class="row note"><span>IVA Contenido</span><span>$ ${money(d.impIva)}</span></div><div class="row note"><span>Otros Impuestos Nacionales Indirectos</span><span>$ 0,00</span></div>`
    : '';
  const payments = d.payments?.length
    ? `<div class="hr"></div>${d.payments.map((p) => `<div class="row note"><span>${esc(PAYMENT_LABEL[p.method])}${p.accountName ? ` · ${esc(p.accountName)}` : ''}</span><span>${money(p.amount)}</span></div>${p.method === 'efectivo' && p.received && p.received > p.amount ? `<div class="row note"><span>Recibido / Vuelto</span><span>${money(p.received)} / ${money(p.received - p.amount)}</span></div>` : ''}`).join('')}`
    : '';
  const asoc = d.asociado ? `<p class="note">Comprobante asociado: ${esc(CBTE_NAME[d.asociado.cbteTipo] ?? '')} ${pad(d.asociado.ptoVta, 5)}-${pad(d.asociado.nro, 8)}${d.asociado.fecha ? ` del ${ymdToDate(d.asociado.fecha)}` : ''}</p>` : '';
  const body = `
    ${homo ? '<div class="warn">HOMOLOGACIÓN — COMPROBANTE DE PRUEBA SIN VALIDEZ FISCAL</div>' : ''}
    ${header ? headerHtml(header) : e.nombreFantasia ? `<p class="c big">${esc(e.nombreFantasia)}</p>` : ''}
    <p class="c b">${esc(e.razonSocial)}</p>
    <p class="c">CUIT ${esc(fmtCuit(e.cuit))}${e.iibb ? ` · IIBB ${esc(e.iibb)}` : ''}</p>
    <p class="c">${esc(e.domicilio)}</p>
    ${e.inicioActividades ? `<p class="c note">Inicio de actividades: ${esc(e.inicioActividades.split('-').reverse().join('/'))}</p>` : ''}
    <p class="c b">${esc(EMISOR_COND_LABEL[e.condicionIva])}</p>
    <div class="box"><div class="row"><span class="huge">${esc(name.toUpperCase())}</span><span class="b">Cód. ${pad(d.cbteTipo, 3)}</span></div>
    <div class="row"><span>P. de venta ${pad(d.ptoVta, 5)}</span><span class="b">Nº ${pad(d.nro, 8)}</span></div>
    <div class="row"><span>Fecha ${ymdToDate(d.fecha)}</span><span>${time(d.authorizedAt)}</span></div></div>
    ${asoc}
    <p class="b">${r.docTipo === 99 ? 'A CONSUMIDOR FINAL' : esc(r.nombre ?? '')}</p>
    ${r.docTipo !== 99 ? `<p>${esc(DOC_TIPO_LABEL[r.docTipo])} ${esc(r.docTipo === 80 || r.docTipo === 86 ? fmtCuit(r.docNro) : r.docNro)}</p>` : ''}
    <p class="note">${esc(COND_IVA[r.condicionIva] ?? '')}</p>
    ${r.domicilio ? `<p class="note">${esc(r.domicilio)}</p>` : ''}
    ${d.tableName ? `<p class="note">${esc(docPlace(d))}</p>` : ''}
    <div class="hr"></div>
    ${lines}
    <div class="hr"></div>
    ${d.bonif ? `<div class="row"><span>Subtotal</span><span>${money(d.impTotal + d.bonif)}</span></div><div class="row"><span>Bonificación</span><span>−${money(d.bonif)}</span></div>` : ''}
    ${ivaRows}
    <div class="row big"><span>TOTAL</span><span>$ ${money(d.impTotal)}</span></div>
    ${transparency}
    ${payments}
    <div class="hr"></div>
    <div class="row b"><span>CAE</span><span>${esc(d.cae)}</span></div>
    <div class="row"><span>Vto. CAE</span><span>${ymdToDate(d.caeVto)}</span></div>
    <img class="qr" src="${qr}" alt="QR de ARCA">
    <p class="c note">Comprobante autorizado por ARCA</p>
    ${pie ? `<p class="c" style="margin-top:6px">${esc(pie)}</p>` : ''}
    ${homo ? '<div class="warn">SIN VALIDEZ FISCAL (PRUEBA)</div>' : ''}`;
  return page(`${name} ${docNumber(d)}`, body);
}

/** Pre-cuenta: lo consumido con precios. No es un comprobante fiscal. */
export function precuentaHtml(t: TableTicket, business: string): string {
  const live = t.lines.filter((l) => l.qty > 0);
  const disc = discountAmount(t.subtotal ?? t.total, t.discount);
  const paid = (t.charges ?? []).reduce((x, c) => x + c.amount, 0);
  const body = `
    ${headerHtml(business)}
    <div class="warn">PRE-CUENTA<br>NO VÁLIDO COMO FACTURA</div>
    <div class="row"><span>${esc(ticketLabel(t))} · #${t.number}</span><span>${dateTime(new Date().toISOString())}</span></div>
    ${t.guests ? `<p>${t.guests} comensales</p>` : ''}
    <div class="hr"></div>
    ${live.map((l) => `<div class="row"><span>${qtyFmt(l.qty)} ${esc(l.name)}${l.comp ? ' (cortesía)' : ''}</span><span>${l.comp ? '0,00' : money(l.qty * l.price)}</span></div>`).join('')}
    <div class="hr"></div>
    ${disc ? `<div class="row"><span>Subtotal</span><span>${money(t.subtotal ?? t.total)}</span></div><div class="row"><span>Descuento${t.discount?.kind === 'pct' ? ` ${t.discount.value}%` : ''}</span><span>−${money(disc)}</span></div>` : ''}
    <div class="row big"><span>TOTAL</span><span>$ ${money(t.total)}</span></div>
    ${paid ? `<div class="row"><span>Ya pagado</span><span>−${money(paid)}</span></div><div class="row big"><span>FALTA</span><span>$ ${money(t.total - paid)}</span></div>` : ''}`;
  return page(`Pre-cuenta ${ticketLabel(t)}`, body);
}

/** Comanda para cocina: sin precios. */
export function comandaHtml(t: TableTicket, lines: TicketLine[]): string {
  // Si hay platos de cocina y de barra, sale una comanda por puesto (cada una en su hoja).
  const groups = (['cocina', 'barra'] as const).map((s) => ({ s, lines: lines.filter((l) => (l.station ?? 'cocina') === s) })).filter((g) => g.lines.length);
  if (groups.length > 1) {
    return page(`Comanda ${ticketLabel(t)}`, groups.map((g, i) => `<div${i ? ' style="page-break-before:always;break-before:page"' : ''}>${comandaBody(t, g.lines, g.s === 'barra' ? 'BARRA' : 'COCINA')}</div>`).join(''));
  }
  return page(`Comanda ${ticketLabel(t)}`, comandaBody(t, lines, groups[0]?.s === 'barra' ? 'BARRA' : undefined));
}

function comandaBody(t: TableTicket, lines: TicketLine[], station?: string): string {
  return `
    <div class="warn">COMANDA${station ? ` ${station}` : ''} — NO VÁLIDO COMO FACTURA</div>
    <p class="huge">${esc(ticketLabel(t).toUpperCase())}</p>
    ${t.customer?.address ? `<p>${esc(t.customer.address)}${t.customer.phone ? ` · ${esc(t.customer.phone)}` : ''}</p>` : ''}
    <div class="row"><span>#${t.number}${t.openedBy ? ` · ${esc(t.openedBy.name)}` : ''}</span><span>${time(new Date().toISOString())}</span></div>
    <div class="hr"></div>
    ${lines.map((l) => `<p class="big">${l.qty === 0 ? 'ANULADO ' : `${qtyFmt(l.qty)} x `}${esc(l.name)}</p>${l.notes ? `<p>&nbsp;&nbsp;» ${esc(l.notes)}</p>` : ''}`).join('')}
    <div class="hr"></div>`;
}

/** Arqueo de caja (parcial o al cierre). */
export function arqueoHtml(s: CashSession, sum: CashSummary, business: string, diffs: { method: SalePaymentMethod; expected: number; counted: number; diff: number }[]): string {
  const methods = (Object.keys(sum.expected) as SalePaymentMethod[]).filter((m) => sum.expected[m] || sum.sales[m] || sum.tips[m] || sum.ingresos[m] || sum.egresos[m]);
  const body = `
    ${headerHtml(business)}
    <div class="warn">${s.status === 'cerrada' ? 'ARQUEO DE CAJA' : 'CAJA — RESUMEN PARCIAL'}<br>NO VÁLIDO COMO FACTURA</div>
    <p>${esc(s.register)} #${s.number}</p>
    <p class="note">Abierta ${dateTime(s.openedAt)}${s.openedBy ? ` · ${esc(s.openedBy.name)}` : ''}</p>
    ${s.closedAt ? `<p class="note">Cerrada ${dateTime(s.closedAt)}${s.closedBy ? ` · ${esc(s.closedBy.name)}` : ''}</p>` : ''}
    <div class="hr"></div>
    <div class="row"><span>Efectivo inicial</span><span>${money(s.initialCash)}</span></div>
    <div class="row b"><span>Ventas (${sum.count})</span><span>${money(sum.totalSales)}</span></div>
    <div class="row"><span>Propinas</span><span>${money(sum.totalTips)}</span></div>
    ${sum.onAccount ? `<div class="row"><span>A cuenta corriente</span><span>${money(sum.onAccount)}</span></div>` : ''}
    ${sum.invitations ? `<div class="row"><span>Invitaciones</span><span>${money(sum.invitations)}</span></div>` : ''}
    ${sum.onAccount || sum.invitations ? '<p class="note">(no entran en la caja)</p>' : ''}
    <div class="hr"></div>
    ${methods.map((m) => `<p class="b">${esc(PAYMENT_LABEL[m])}</p>
      <div class="row note"><span>Ventas</span><span>${money(sum.sales[m])}</span></div>
      ${sum.tips[m] ? `<div class="row note"><span>Propinas</span><span>${money(sum.tips[m])}</span></div>` : ''}
      ${sum.ingresos[m] ? `<div class="row note"><span>Ingresos</span><span>${money(sum.ingresos[m])}</span></div>` : ''}
      ${sum.egresos[m] ? `<div class="row note"><span>Egresos</span><span>−${money(sum.egresos[m])}</span></div>` : ''}
      <div class="row"><span>Esperado</span><span>${money(sum.expected[m])}</span></div>`).join('')}
    ${diffs.length ? `<div class="hr"></div><p class="b">Contado</p>${diffs.map((d) => `<div class="row"><span>${esc(PAYMENT_LABEL[d.method])}</span><span>${money(d.counted)} (${d.diff === 0 ? 'justo' : `${d.diff > 0 ? '+' : '−'}${money(Math.abs(d.diff))}`})</span></div>`).join('')}
      <div class="row big"><span>DIFERENCIA</span><span>${money(diffs.reduce((x, d) => x + d.diff, 0))}</span></div>` : ''}
    ${s.note ? `<p class="note">Comentario: ${esc(s.note)}</p>` : ''}
    <div class="hr"></div>
    <p class="note">Impreso ${dateTime(new Date().toISOString())}</p>`;
  return page(`Arqueo ${s.register} #${s.number}`, body);
}

/** Ticket de prueba para ajustar la impresora. */
export function testTicketHtml(business: string): string {
  return page('Ticket de prueba', `
    ${headerHtml(business)}
    <div class="warn">TICKET DE PRUEBA<br>NO VÁLIDO COMO FACTURA</div>
    <p>Si este texto entra completo en el ancho, la impresora está bien configurada.</p>
    <div class="hr"></div>
    <div class="row"><span>1 x Café con leche</span><span>3.000,00</span></div>
    <div class="row"><span>2 x Medialunas</span><span>1.800,00</span></div>
    <div class="hr"></div>
    <div class="row big"><span>TOTAL</span><span>$ 4.800,00</span></div>
    <p class="c note">${dateTime(new Date().toISOString())}</p>`);
}

/** Cierre del día ("Z"): ventas, medios de pago, canales y lo facturado en ARCA. */
export function cierreHtml(z: DailyClose, business: string): string {
  const [y, m, d] = z.date.split('-');
  const s = z.sales;
  const rows = (list: { label: string; total: number; count: number }[], unit = '') => list.map((b) => `<div class="row"><span>${esc(b.label)}${unit ? ` (${b.count}${unit})` : ''}</span><span>${money(b.total)}</span></div>`).join('');
  const body = `
    ${headerHtml(business)}
    <div class="warn">CIERRE DEL DÍA ${d}/${m}/${y}<br>NO VÁLIDO COMO FACTURA</div>
    <p class="note">Impreso ${dateTime(new Date().toISOString())}</p>
    <div class="hr"></div>
    <div class="row big"><span>VENDIDO</span><span>$ ${money(s.sold)}</span></div>
    <div class="row"><span>Pedidos</span><span>${s.orders}</span></div>
    <div class="row"><span>Ticket promedio</span><span>${money(s.avg)}</span></div>
    ${s.guests ? `<div class="row"><span>Comensales</span><span>${s.guests}</span></div>` : ''}
    <div class="row"><span>Descuentos</span><span>${money(s.discounts)}</span></div>
    <div class="row"><span>Cortesías</span><span>${money(s.compValue)}</span></div>
    <div class="row"><span>Propinas</span><span>${money(s.tips)}</span></div>
    ${s.cancelled ? `<div class="row"><span>Pedidos anulados</span><span>${s.cancelled}</span></div>` : ''}
    <div class="hr"></div>
    <p class="b">Medios de pago</p>
    ${rows(s.byPayment) || '<p class="note">Sin cobros</p>'}
    <div class="hr"></div>
    <p class="b">Canales</p>
    ${rows(s.byChannel, ' ped.')}
    <div class="hr"></div>
    <p class="b">Facturación electrónica${z.test ? ' (PRUEBA)' : ''}</p>
    ${z.fiscal.length ? z.fiscal.map((f) => `<div class="row"><span>${esc(f.name)} (${f.count})</span><span>${money(f.total)}</span></div>
      <div class="row note"><span>Del ${String(f.first).padStart(8, '0')} al ${String(f.last).padStart(8, '0')}</span><span>IVA ${money(f.iva)}</span></div>`).join('') : '<p class="note">Sin comprobantes</p>'}
    <div class="row b"><span>Total facturado</span><span>${money(z.invoiced)}</span></div>
    <div class="row"><span>Cobrado sin factura</span><span>${money(z.unbilled)}</span></div>
    <div class="hr"></div>
    ${s.items.length ? `<p class="b">Más vendido</p>${s.items.slice(0, 10).map((i) => `<div class="row"><span>${qtyFmt(i.qty)} x ${esc(i.name)}</span><span>${money(i.revenue)}</span></div>`).join('')}<div class="hr"></div>` : ''}`;
  return page(`Cierre del día ${d}/${m}/${y}`, body);
}
