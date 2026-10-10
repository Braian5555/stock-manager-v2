import { afterEach, describe, expect, it } from 'vitest';
import { BitArray, Code128Reader } from '@zxing/library';
import { db } from '../../src/database/db';
import { FakeBackend, FakeCloudStore } from '../../src/cloud/fakeBackend';
import { SyncEngine } from '../../src/cloud/syncEngine';
import { planProductImport } from '../../src/importers/productImport';
import { duplicateProduct, emptyProduct, findByCode, saveProduct } from '../../src/services/productService';
import {
  CODE128_PATTERNS, barcodeKeys, code128Svg, code128Widths, gs1CheckDigit, nextInternalCode, normalizeBarcode, sameBarcode, validateBarcode,
} from '../../src/utils/barcode';
import { nowIso, uuid } from '../../src/utils/id';

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

/** Decodifica las barras generadas con el lector Code 128 de ZXing (el mismo que usa la cámara). */
function decode(text: string): string {
  const widths = code128Widths(text);
  const quiet = 12;
  const size = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  const row = new BitArray(size);
  let x = quiet;
  widths.forEach((w, i) => {
    if (i % 2 === 0) for (let k = 0; k < w; k++) row.set(x + k);
    x += w;
  });
  return new Code128Reader().decodeRow(0, row, new Map()).getText();
}

describe('validación de códigos', () => {
  it('dígito verificador GS1', () => {
    expect(gs1CheckDigit('400638133393')).toBe(1); // EAN-13 4006381333931
    expect(gs1CheckDigit('9638507')).toBe(4); // EAN-8 96385074
    expect(gs1CheckDigit('03600029145')).toBe(2); // UPC-A 036000291452
  });

  it('reconoce EAN-13, EAN-8, UPC-A y Code 128', () => {
    expect(validateBarcode('4006381333931')).toMatchObject({ ok: true, format: 'EAN-13' });
    expect(validateBarcode('96385074')).toMatchObject({ ok: true, format: 'EAN-8' });
    expect(validateBarcode('036000291452')).toMatchObject({ ok: true, format: 'UPC-A' });
    expect(validateBarcode('SM000012')).toMatchObject({ ok: true, format: 'CODE-128' });
    expect(validateBarcode(' 4006381333931\n')).toMatchObject({ ok: true, code: '4006381333931' });
  });

  it('avisa si el verificador no coincide y rechaza lo que no se puede imprimir', () => {
    const bad = validateBarcode('4006381333932');
    expect(bad.ok).toBe(true);
    expect(bad.warning).toMatch(/último dígito/);
    expect(validateBarcode('').ok).toBe(false);
    expect(validateBarcode('Ñandú').ok).toBe(false);
    expect(validateBarcode('x'.repeat(49)).ok).toBe(false);
  });

  it('UPC-A y el EAN-13 con 0 adelante son el mismo código', () => {
    expect(barcodeKeys('036000291452')).toContain('0036000291452');
    expect(sameBarcode('036000291452', '0036000291452')).toBe(true);
    expect(sameBarcode('sm000001', 'SM000001')).toBe(true);
    expect(sameBarcode('4006381333931', '96385074')).toBe(false);
    expect(normalizeBarcode('\u0002 7790 001\r')).toBe('7790001');
  });

  it('código interno siguiente', () => {
    expect(nextInternalCode([])).toBe('SM000001');
    expect(nextInternalCode(['SM000009', undefined, '779', 'sm000003'])).toBe('SM000010');
  });
});

describe('etiquetas Code 128', () => {
  it('tabla de símbolos consistente', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => expect([...p].reduce((a, b) => a + Number(b), 0)).toBe(11));
    expect([...CODE128_PATTERNS[106]].reduce((a, b) => a + Number(b), 0)).toBe(13);
  });

  it('lo que se imprime lo lee el escáner', () => {
    for (const text of ['SM000001', '7790001234567', 'Harina-0000', 'a b/c']) expect(decode(text)).toBe(text);
  });

  it('el SVG tiene barras y escapa el texto', () => {
    const svg = code128Svg('A<B');
    expect(svg).toContain('<rect');
    expect(svg).not.toContain('A<B');
    expect(() => code128Svg('Ñ')).toThrow();
  });
});

describe('productos con código de barras', () => {
  it('no permite repetir un código (tampoco en su forma equivalente)', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Gaseosa', barcode: '036000291452' });
    expect(a.barcode).toBe('036000291452');
    await expect(saveProduct({ ...emptyProduct(), name: 'Otra', barcode: '0036000291452' })).rejects.toThrow(/ya es de “Gaseosa”/);
    await expect(saveProduct({ ...emptyProduct(), name: 'Rara', barcode: 'Ñ1' })).rejects.toThrow();
    // Editar el mismo producto con su propio código no es un duplicado.
    await expect(saveProduct({ ...a, name: 'Gaseosa 2 l' })).resolves.toMatchObject({ barcode: '036000291452' });
  });

  it('la copia de un producto queda sin código de barras', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Agua', barcode: '96385074' });
    const copy = await duplicateProduct(a.id);
    expect(copy.barcode).toBeUndefined();
  });

  it('busca por código de barras y, si no hay, por SKU exacto', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Yerba', sku: 'Y-1', barcode: '4006381333931' });
    const b = await saveProduct({ ...emptyProduct(), name: 'Azúcar', sku: 'AZ-9' });
    expect((await findByCode('4006381333931')).map((p) => p.id)).toEqual([a.id]);
    expect((await findByCode(' az-9 ')).map((p) => p.id)).toEqual([b.id]);
    expect(await findByCode('0000000000000')).toEqual([]);
    expect(await findByCode('')).toEqual([]);
  });

  it('un duplicado que llegó por sincronización aparece en la búsqueda y no bloquea otras ediciones', async () => {
    const a = await saveProduct({ ...emptyProduct(), name: 'Leche', barcode: '7790001234567' });
    const t = nowIso();
    // Otro dispositivo cargó el mismo código sin conexión (escritura directa, como la sincronización).
    await db.products.put({ ...emptyProduct(), id: uuid(), name: 'Leche descremada', barcode: '7790001234567', createdAt: t, updatedAt: t });
    expect((await findByCode('7790001234567')).length).toBe(2);
    await expect(saveProduct({ ...a, minStock: 3 })).resolves.toMatchObject({ minStock: 3 });
  });

  it('la importación carga códigos y descarta los repetidos sin cortar el resto', async () => {
    await saveProduct({ ...emptyProduct(), name: 'Existente', barcode: '96385074' });
    const plan = await planProductImport({
      headers: ['Nombre', 'Código de barras', 'Stock'],
      rows: [['Nuevo A', '4006381333931', 1], ['Nuevo B', '96385074', 2], ['Nuevo C', '4006381333931', 3], ['Nuevo D', '', 0]],
    });
    expect(plan.create).toBe(4);
    expect(plan.barcodeConflicts).toBe(2);
    await plan.run();
    const all = await db.products.toArray();
    expect(all.find((p) => p.name === 'Nuevo A')?.barcode).toBe('4006381333931');
    expect(all.find((p) => p.name === 'Nuevo B')?.barcode).toBeUndefined();
    expect(all.find((p) => p.name === 'Nuevo C')?.barcode).toBeUndefined();
    expect(all.find((p) => p.name === 'Nuevo C')?.stock).toBe(3);
  });
});

describe('sincronización del código de barras', () => {
  let engine: SyncEngine | undefined;
  afterEach(() => engine?.stop());

  it('el campo nuevo viaja a la nube, también si se cargó sin conexión', async () => {
    const store = new FakeCloudStore();
    const backend = new FakeBackend(store);
    const user = await backend.signIn();
    const ws = await backend.createWorkspace(user, 'Test');
    engine = new SyncEngine(backend, ws.id);
    await engine.start();
    await tick();
    const remote = () => store.coll(`${ws.id}/products`);

    const p = await saveProduct({ ...emptyProduct(), name: 'Con código', barcode: 'SM000001' });
    await tick();
    expect(remote().get(p.id)?.barcode).toBe('SM000001');

    store.setOnline(false);
    await saveProduct({ ...p, barcode: 'SM000002' });
    await tick();
    expect(remote().get(p.id)?.barcode).toBe('SM000001');
    expect(engine.getStatus().pending).toBeGreaterThan(0);
    store.setOnline(true);
    await tick();
    expect(remote().get(p.id)?.barcode).toBe('SM000002');

    // Y el que viene de otro dispositivo se guarda localmente.
    await store.write(`${ws.id}/products`, { ...remote().get(p.id)!, barcode: '4006381333931', updatedAt: '2999-01-01T00:00:00.000Z' });
    await tick();
    expect((await db.products.get(p.id))?.barcode).toBe('4006381333931');
  });
});
