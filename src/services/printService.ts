/**
 * Impresión en impresoras térmicas de 80 mm (desde el diálogo de impresión del navegador).
 * Tres documentos distintos, bien diferenciados:
 *  - Comprobante fiscal (factura / nota): con CAE, vencimiento y QR de ARCA.
 *  - Pre-cuenta: lo consumido con precios. NO VÁLIDO COMO FACTURA.
 *  - Comanda: para cocina, sin precios. NO VÁLIDO COMO FACTURA.
 */
import QRCode from 'qrcode';
import type { FiscalDoc, TableTicket, TicketLine } from '../models';
import { CBTE_NAME, COND_IVA, DOC_TIPO_LABEL, EMISOR_COND_LABEL, PAYMENT_LABEL, docNumber, fmtCuit, pad, qrUrl, ymdToDate } from './fiscalService';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 3 });
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');
const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '');

const STYLE = `
@page { size: 80mm auto; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #000; }
body { width: 80mm; padding: 3mm 4mm 6mm; font: 12px/1.3 'Courier New', ui-monospace, monospace; }
.c { text-align: center; }
.r { text-align: right; }
.b { font-weight: 700; }
.big { font-size: 15px; font-weight: 700; }
.huge { font-size: 18px; font-weight: 700; letter-spacing: .02em; }
.hr { border-top: 1px dashed #000; margin: 5px 0; }
.row { display: flex; justify-content: space-between; gap: 6px; }
.row > :first-child { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.box { border: 1.5px solid #000; padding: 3px 4px; margin: 4px 0; }
.note { font-size: 11px; }
.warn { border: 2px solid #000; padding: 4px; text-align: center; font-weight: 700; margin: 6px 0; }
.qr { display: block; margin: 6px auto 2px; width: 38mm; height: 38mm; image-rendering: pixelated; }
p { margin: 0; }
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
export async function fiscalTicketHtml(d: FiscalDoc, pie?: string): Promise<string> {
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
    ? `<div class="hr"></div>${d.payments.map((p) => `<div class="row note"><span>${esc(PAYMENT_LABEL[p.method])}</span><span>${money(p.amount)}</span></div>${p.method === 'efectivo' && p.received && p.received > p.amount ? `<div class="row note"><span>Recibido / Vuelto</span><span>${money(p.received)} / ${money(p.received - p.amount)}</span></div>` : ''}`).join('')}`
    : '';
  const asoc = d.asociado ? `<p class="note">Comprobante asociado: ${esc(CBTE_NAME[d.asociado.cbteTipo] ?? '')} ${pad(d.asociado.ptoVta, 5)}-${pad(d.asociado.nro, 8)}${d.asociado.fecha ? ` del ${ymdToDate(d.asociado.fecha)}` : ''}</p>` : '';
  const body = `
    ${homo ? '<div class="warn">HOMOLOGACIÓN — COMPROBANTE DE PRUEBA SIN VALIDEZ FISCAL</div>' : ''}
    ${e.nombreFantasia ? `<p class="c big">${esc(e.nombreFantasia)}</p>` : ''}
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
    ${d.tableName ? `<p class="note">Mesa ${esc(d.tableName)}</p>` : ''}
    <div class="hr"></div>
    ${lines}
    <div class="hr"></div>
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
  const body = `
    <p class="c big">${esc(business)}</p>
    <div class="warn">PRE-CUENTA<br>NO VÁLIDO COMO FACTURA</div>
    <div class="row"><span>Mesa ${esc(t.tableName)} · #${t.number}</span><span>${dateTime(new Date().toISOString())}</span></div>
    ${t.guests ? `<p>${t.guests} comensales</p>` : ''}
    <div class="hr"></div>
    ${live.map((l) => `<div class="row"><span>${qtyFmt(l.qty)} ${esc(l.name)}</span><span>${money(l.qty * l.price)}</span></div>`).join('')}
    <div class="hr"></div>
    <div class="row big"><span>TOTAL</span><span>$ ${money(t.total)}</span></div>`;
  return page(`Pre-cuenta mesa ${t.tableName}`, body);
}

/** Comanda para cocina: sin precios. */
export function comandaHtml(t: TableTicket, lines: TicketLine[]): string {
  const body = `
    <div class="warn">COMANDA — NO VÁLIDO COMO FACTURA</div>
    <p class="huge">MESA ${esc(t.tableName)}</p>
    <div class="row"><span>#${t.number}${t.openedBy ? ` · ${esc(t.openedBy.name)}` : ''}</span><span>${time(new Date().toISOString())}</span></div>
    <div class="hr"></div>
    ${lines.map((l) => `<p class="big">${l.qty === 0 ? 'ANULADO ' : `${qtyFmt(l.qty)} x `}${esc(l.name)}</p>${l.notes ? `<p>&nbsp;&nbsp;» ${esc(l.notes)}</p>` : ''}`).join('')}
    <div class="hr"></div>`;
  return page(`Comanda mesa ${t.tableName}`, body);
}
