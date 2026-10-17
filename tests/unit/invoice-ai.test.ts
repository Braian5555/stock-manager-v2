import { describe, expect, it } from 'vitest';
import { buildRequest, parseReading, READING_SCHEMA, validateInput } from '../../functions/reader.mjs';
import { buildCatalog, matchLines, similarity, toStockQty, tokens } from '../../src/services/invoiceAI';
import type { Product } from '../../src/models';

const units: Record<string, string> = { u: 'u', kg: 'kg', g: 'g', l: 'l', caja: 'caja', bolsa: 'bolsa' };
const lk = { unit: (id?: string) => (id ? units[id] ?? '' : '') };
let n = 0;
const prod = (name: string, extra: Partial<Product> = {}): Product =>
  ({ id: `p${++n}`, name, active: true, stock: 0, minStock: 0, purchaseFactor: 1, unitId: 'u', createdAt: '', updatedAt: '', ...extra }) as Product;

describe('lectura de facturas con IA: reconocimiento', () => {
  it('normaliza tamaños y unidades', () => {
    expect(tokens('COCA COLA PET 2,25 LTS x6')).toEqual(['coca', 'cola', 'pet', '2.25l', '6']);
    expect(tokens('Harina 0000 x 25 Kg')).toEqual(['harina', '0000', '25kg']);
  });

  it('el tamaño distinto baja mucho el parecido', () => {
    const a = similarity('COCA COLA PET 2,25 LT', 'Coca-Cola 2,25 L');
    const b = similarity('COCA COLA PET 2,25 LT', 'Coca-Cola 1,5 L');
    expect(a).toBeGreaterThan(0.8);
    expect(b).toBeLessThan(0.5);
    expect(similarity('AGUA S/GAS 1500CC', 'Agua sin gas 1,5 L')).toBeGreaterThan(0.6);
  });

  it('convierte a la unidad de stock (cajas, kilos, docenas)', () => {
    const coca = prod('Coca-Cola 2,25 L', { purchaseUnitId: 'caja', purchaseFactor: 6 });
    const harina = prod('Harina 0000', { unitId: 'kg', purchaseUnitId: 'bolsa', purchaseFactor: 25 });
    const huevos = prod('Huevos');
    const queso = prod('Queso', { unitId: 'g' });
    expect(toStockQty(3, 'CAJA', coca, lk)).toBe(18);
    expect(toStockQty(3, 'u', coca, lk)).toBe(3);
    expect(toStockQty(2, 'bolsa', harina, lk)).toBe(50);
    expect(toStockQty(50, 'kg', harina, lk)).toBe(50);
    expect(toStockQty(5, 'docena', huevos, lk)).toBe(60);
    expect(toStockQty(1.5, 'kg', queso, lk)).toBe(1500);
  });

  it('usa la sugerencia de la IA, el código del proveedor y si no el nombre más parecido', () => {
    const coca = prod('Coca-Cola 2,25 L', { purchaseUnitId: 'caja', purchaseFactor: 6 });
    const sprite = prod('Sprite 2,25 L', { sku: 'SPR225' });
    const harina = prod('Harina 0000', { unitId: 'kg' });
    const vieja = prod('Fernet viejo', { active: false });
    const products = [coca, sprite, harina, vieja];
    const { catalog, byRef } = buildCatalog(products, lk);
    expect(catalog.map((c) => c.name)).toEqual(['Coca-Cola 2,25 L', 'Harina 0000', 'Sprite 2,25 L']);
    expect(catalog[0]).toMatchObject({ unit: 'u', buy: 'caja x6' });
    const refOf = (p: Product) => [...byRef].find(([, id]) => id === p.id)![0];
    const items = matchLines([
      { description: 'COCA COLA PET 2.25', code: null, quantity: 2, unit: 'caja', unitPrice: 9000, lineTotal: 18000, ref: refOf(coca), confidence: 'alta' },
      { description: 'GASEOSA LIMA LIMON', code: 'SPR225', quantity: 4, unit: 'u', unitPrice: null, lineTotal: null, ref: null, confidence: 'ninguna' },
      { description: 'HARINA 0000 X KG', code: null, quantity: 25, unit: 'kg', unitPrice: null, lineTotal: null, ref: null, confidence: 'ninguna' },
      { description: 'SERVILLETAS', code: null, quantity: 1, unit: 'u', unitPrice: null, lineTotal: null, ref: null, confidence: 'ninguna' },
      { description: 'FERNET', code: null, quantity: 1, unit: 'u', unitPrice: null, lineTotal: null, ref: refOf(coca), confidence: 'baja' },
    ], products, lk, byRef);
    expect(items.map((i) => [i.productId, i.status, i.stockQty])).toEqual([
      [coca.id, 'ok', 12],
      [sprite.id, 'ok', 4],
      [harina.id, 'check', 25],
      [undefined, 'none', undefined],
      [coca.id, 'check', 1],
    ]);
  });
});

describe('lectura de facturas con IA: función de la nube', () => {
  it('valida lo que manda la app', () => {
    expect(() => validateInput({ wsId: 'ws_123', images: [] })).toThrow('Falta la foto');
    expect(() => validateInput({ wsId: '../x', images: [{ type: 'image/jpeg', data: 'AAAA' }] })).toThrow('Espacio inválido');
    expect(() => validateInput({ wsId: 'ws_123', images: [{ type: 'text/html', data: 'AAAA' }] })).toThrow('Foto inválida');
    const ok = validateInput({ wsId: 'ws_123', images: [{ type: 'image/jpeg', data: 'AAAA' }], catalog: [{ ref: '1', name: '  Coca   Cola ', unit: 'u' }, { ref: '', name: 'x' }] });
    expect(ok.catalog).toEqual([{ ref: '1', name: ' Coca Cola ', unit: 'u', buy: '' }]);
  });

  it('arma el pedido con las fotos, el catálogo y el esquema', () => {
    const r = buildRequest([{ type: 'image/jpeg', data: 'AAAA' }], [{ ref: '1', name: 'Coca', unit: 'u', buy: 'caja x6' }]);
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(r.output_config.format.schema).toBe(READING_SCHEMA);
    expect(r.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/jpeg' } });
    expect(r.messages[0].content[1].text).toContain('1: Coca (u; se compra en caja x6)');
    // structured outputs exige additionalProperties: false en todos los objetos
    const walk = (s: Record<string, unknown>): void => {
      if (s.type === 'object') expect(s.additionalProperties).toBe(false);
      for (const v of Object.values(s)) if (v && typeof v === 'object') walk(v as Record<string, unknown>);
    };
    walk(READING_SCHEMA);
  });

  it('descarta referencias inventadas y renglones sin cantidad', () => {
    const text = JSON.stringify({
      supplier: { name: 'Distribuidora Sur', cuit: '30-1' },
      invoice: { kind: 'factura', number: 'A 0003-00012345', date: '2026-10-14', total: 18000 },
      lines: [
        { description: 'COCA', code: null, quantity: 2, unit: 'caja', unitPrice: 9000, lineTotal: 18000, ref: '1', confidence: 'alta' },
        { description: 'X', code: null, quantity: 1, unit: 'u', unitPrice: null, lineTotal: null, ref: '999', confidence: 'alta' },
        { description: 'BONIF', code: null, quantity: 0, unit: null, unitPrice: null, lineTotal: null, ref: null, confidence: 'ninguna' },
      ],
      warnings: ['Descuento general 5%'],
    });
    const r = parseReading(text, ['1']);
    expect(r.lines.map((l: { ref: string | null; confidence: string }) => [l.ref, l.confidence])).toEqual([['1', 'alta'], [null, 'ninguna']]);
    expect(r.invoice.date).toBe('2026-10-14');
    expect(() => parseReading('no json', [])).toThrow('no devolvió');
  });
});

describe('lectura de facturas con IA: Gemini', () => {
  it('arma el pedido para Gemini (empieza con systemInstruction y pide JSON)', async () => {
    const { buildGeminiRequest } = await import('../../functions/reader.mjs');
    const r = buildGeminiRequest([{ type: 'image/jpeg', data: 'AAAA' }], [{ ref: '1', name: 'Coca', unit: 'u', buy: 'caja x6' }]);
    expect(JSON.stringify(r).startsWith('{"systemInstruction":')).toBe(true);
    expect(r.contents[0].parts[0]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'AAAA' } });
    expect(r.contents[0].parts[1].text).toContain('1: Coca (u; se compra en caja x6)');
    expect(r.generationConfig.responseMimeType).toBe('application/json');
  });

  it('lee la respuesta de Gemini, aunque venga con ```json, y avisa si quedó cortada o bloqueada', async () => {
    const { geminiText, parseReading } = await import('../../functions/reader.mjs');
    const json = JSON.stringify({ supplier: { name: 'Sur', cuit: null }, invoice: { kind: 'factura', number: null, date: '2026-10-17', total: 100 }, lines: [{ description: 'COCA', code: null, quantity: 2, unit: 'caja', unitPrice: 50, lineTotal: 100, ref: '1', confidence: 'alta' }], warnings: [] });
    const { text, truncated } = geminiText({ candidates: [{ content: { parts: [{ text: 'pensando…', thought: true }, { text: '```json\n' + json + '\n```' }] }, finishReason: 'MAX_TOKENS' }] });
    expect(truncated).toBe(true);
    const r = parseReading(text, ['1']);
    expect(r.lines[0]).toMatchObject({ ref: '1', quantity: 2, unit: 'caja' });
    expect(() => geminiText({ promptFeedback: { blockReason: 'SAFETY' } })).toThrow('no procesó');
    expect(() => geminiText({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })).toThrow('no procesó');
  });
});
