import { describe, expect, it } from 'vitest';
import { testTicketHtml, ticketBusiness } from '../../src/services/printService';

describe('encabezado de los tickets', () => {
  it('usa los renglones y la sucursal; sin encabezado, el nombre del negocio', () => {
    const b = ticketBusiness({ businessName: 'Orillas', ticketHeader: 'Complejo Americano\nEPICURAE AMERICANO\n\n Camping Americano ', sucursal: 'Parador' });
    expect(b.split('\n')).toEqual(['Complejo Americano', 'EPICURAE AMERICANO', 'Camping Americano', 'Sucursal: Parador']);
    expect(ticketBusiness({ businessName: 'Orillas' })).toBe('Orillas');
    const html = testTicketHtml(b);
    expect(html).toContain('<p class="c big">Complejo Americano</p>');
    expect(html).toContain('<p class="c">Sucursal: Parador</p>');
  });
});
