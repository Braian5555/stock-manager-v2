import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FiscalDoc, TableTicket } from '../../src/models';
import { comandaHtml, fiscalTicketHtml, precuentaHtml } from '../../src/services/printService';

const base: FiscalDoc = {
  id: 'f1', createdAt: '2026-11-05T18:20:00.000Z', updatedAt: '2026-11-05T18:20:00.000Z',
  kind: 'factura', letra: 'B', cbteTipo: 6, ptoVta: 5, ambiente: 'produccion', concepto: 1,
  emisor: { cuit: '30712345671', razonSocial: 'EPICURAE S.A.', nombreFantasia: 'Complejo Americano', domicilio: 'Av. Siempre Viva 123, CABA', condicionIva: 'RI', iibb: '901-123456-7', inicioActividades: '2020-03-01' },
  receptor: { docTipo: 99, docNro: '0', condicionIva: 5 },
  lines: [
    { name: 'Desayuno americano', qty: 2, unitPrice: 9500, iva: 21, total: 19000 },
    { name: 'Agua mineral 500 ml', qty: 1, unitPrice: 2100, iva: 21, total: 2100 },
  ],
  impTotal: 21100, impNeto: 17438.02, impIva: 3661.98, impTotConc: 0, impOpEx: 0, impTrib: 0,
  iva: [{ id: 5, rate: 21, baseImp: 17438.02, importe: 3661.98 }],
  status: 'autorizada', nro: 42, fecha: '20261105', cae: '76012345678901', caeVto: '20261115', authorizedAt: '2026-11-05T18:20:05.000Z',
  tableName: '2', payments: [{ method: 'efectivo', amount: 21100, received: 25000 }],
};

describe('impresión 80 mm', () => {
  it('ticket fiscal B: emisor, número, CAE, vencimiento, QR y régimen de transparencia', async () => {
    const html = await fiscalTicketHtml(base);
    expect(html).toContain('@page { size: 80mm auto');
    expect(html).toContain('FACTURA B');
    expect(html).toContain('Cód. 006');
    expect(html).toContain('P. de venta 00005');
    expect(html).toContain('Nº 00000042');
    expect(html).toContain('CUIT 30-71234567-1');
    expect(html).toContain('IVA Responsable Inscripto');
    expect(html).toContain('A CONSUMIDOR FINAL');
    expect(html).toContain('76012345678901');
    expect(html).toContain('15/11/2026');
    expect(html).toContain('Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)');
    expect(html).toMatch(/IVA Contenido<\/span><span>\$ 3\.661,98/);
    expect(html).toMatch(/<img class="qr" src="data:image\/png;base64,/);
    expect(html).not.toContain('SIN VALIDEZ FISCAL');
    if (process.env.TICKET_OUT) writeFileSync(`${process.env.TICKET_OUT}/ticket-b.html`, html);
  });

  it('factura A discrimina neto e IVA; homologación lleva la leyenda de prueba', async () => {
    const a = await fiscalTicketHtml({ ...base, letra: 'A', cbteTipo: 1, ambiente: 'homologacion', receptor: { docTipo: 80, docNro: '20333333334', nombre: 'Cliente SA', condicionIva: 1 } });
    expect(a).toContain('FACTURA A');
    expect(a).toContain('Neto gravado 21%');
    expect(a).toContain('Cliente SA');
    expect(a).toContain('CUIT 20-33333333-4');
    expect(a).not.toContain('Ley 27.743');
    expect(a).toContain('SIN VALIDEZ FISCAL');
    if (process.env.TICKET_OUT) writeFileSync(`${process.env.TICKET_OUT}/ticket-a.html`, a);
  });

  it('no imprime un comprobante sin CAE', async () => {
    await expect(fiscalTicketHtml({ ...base, status: 'incierta', cae: undefined })).rejects.toThrow(/autorizado/);
  });

  it('pre-cuenta y comanda dicen claramente que no son factura', () => {
    const t = { id: 't', tableName: '2', number: 7, total: 21100, lines: [{ id: 'l', menuItemId: 'm', name: 'Desayuno americano', price: 9500, qty: 2, kitchen: true, status: 'cocina', notes: 'sin manteca' }] } as unknown as TableTicket;
    const pre = precuentaHtml(t, 'Complejo Americano');
    expect(pre).toContain('PRE-CUENTA<br>NO VÁLIDO COMO FACTURA');
    const com = comandaHtml(t, t.lines);
    expect(com).toContain('COMANDA — NO VÁLIDO COMO FACTURA');
    expect(com).toContain('sin manteca');
    expect(com).not.toContain('9.500');
  });
});
