import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TableTicket, TicketLine } from '../../src/models';
import { printComanda, printHtml } from '../../src/services/printService';

afterEach(() => { delete (globalThis as { orillasDesktop?: unknown }).orillasDesktop; });

describe('Orillas para Windows: impresión directa por impresora', () => {
  it('la comanda sale por separado a cocina y a barra; el resto, como ticket', async () => {
    const print = vi.fn(async (_html: string, _kind: string) => ({ ok: true, printer: 'x' }));
    (globalThis as { orillasDesktop?: unknown }).orillasDesktop = { print };
    const line = (id: string, name: string, station?: 'barra'): TicketLine => ({ id, menuItemId: id, name, qty: 1, price: 1000, kitchen: true, status: 'cocina', ...(station ? { station } : {}) } as TicketLine);
    const t = { id: 't', number: 7, tableName: '4', channel: 'mesa', lines: [], openedAt: new Date().toISOString() } as unknown as TableTicket;
    await printComanda(t, [line('a', 'Milanesa'), line('b', 'Café', 'barra'), line('c', 'Papas')]);
    const calls = print.mock.calls;
    expect(calls.map((c) => c[1])).toEqual(['cocina', 'barra']);
    expect(calls[0][0]).toContain('Milanesa');
    expect(calls[0][0]).not.toContain('Café');
    expect(calls[1][0]).toContain('COMANDA BARRA');
    await printHtml('<p>hola</p>');
    expect(print.mock.calls.at(-1)).toEqual(['<p>hola</p>', 'ticket']);
  });
});
