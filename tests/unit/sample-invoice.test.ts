import { describe, expect, it } from 'vitest';
import { fiscalOf } from '../../src/services/fiscalService';
import { sampleInvoiceHtml } from '../../src/services/printService';

describe('Factura B de muestra (sin ARCA)', () => {
  it('sale con el diseño de la factura pero marcada como muestra, sin CAE ni QR de ARCA', () => {
    const f = { ...fiscalOf({}), cuit: '30718737652', razonSocial: 'EPICURAE AMERICANOSERV SA', domicilio: 'Ruta 11', ptoVta: 1 };
    const html = sampleInvoiceHtml(f, '¡Gracias por venir!', 'Complejo Americano\nEPICURAE AMERICANO');
    expect(html).toContain('FACTURA B');
    expect(html).toContain('MUESTRA DE IMPRESIÓN');
    expect(html).toContain('NO VÁLIDO COMO FACTURA');
    expect(html).toContain('A CONSUMIDOR FINAL');
    expect(html).toContain('10.200,00');
    expect(html).toContain('Régimen de Transparencia Fiscal');
    expect(html).toContain('30-71873765-2');
    expect(html).not.toContain('autorizado por ARCA');
    expect(html).not.toContain('<img class="qr"');
    expect(html).not.toMatch(/Nº 0000/);
  });
});
