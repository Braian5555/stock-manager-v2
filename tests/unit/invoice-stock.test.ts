import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import type { InvoiceItem, Product } from '../../src/models';
import { aliasKey, matchLines, needsPackSize, pendingCount, toStockQty } from '../../src/services/invoiceAI';
import { applyInvoiceToStock, createProductFromLine, learnFromInvoice, suggestName, undoInvoiceStock } from '../../src/services/invoiceStock';
import { deleteInvoice, saveInvoice } from '../../src/services/invoiceService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { parseReading } from '../../functions/reader.mjs';
import { base64Bytes } from '../../src/services/imageService';

const t = '2026-10-17T10:00:00.000Z';
async function seedUnits() {
  await db.units.bulkAdd([
    { id: 'u', name: 'Unidad', abbreviation: 'u', createdAt: t, updatedAt: t },
    { id: 'kg', name: 'Kilo', abbreviation: 'kg', createdAt: t, updatedAt: t },
    { id: 'caja', name: 'Caja', abbreviation: 'caja', createdAt: t, updatedAt: t },
  ] as never);
}
const lk = { unit: (id?: string) => ({ u: 'u', kg: 'kg', caja: 'caja' } as Record<string, string>)[id ?? ''] ?? '' };
const img = { data: 'QUJDRA==', type: 'image/jpeg' as const, width: 10, height: 20, bytes: base64Bytes('QUJDRA=='), thumb: 'data:image/jpeg;base64,AA==' };
const line = (description: string, extra: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: `i-${description}`, description, quantity: 1, status: 'ok', ...extra });
const product = (name: string, extra: Partial<Product> = {}) => saveProduct({ ...emptyProduct(), name, unitId: 'u', ...extra });

describe('facturas → stock: cajas y bultos', () => {
  it('lee "1.000 B" como 1 bulto y lo convierte con las unidades por bulto', () => {
    const r = parseReading(JSON.stringify({ lines: [{ description: 'AMARGO OBRERO X 950 CC', quantity: 1, unit: 'bulto', packSize: 6, confidence: 'media' }, { description: 'SODA', quantity: 2, unit: 'u', packSize: 1 }] }), []);
    expect(r.lines[0]).toMatchObject({ quantity: 1, unit: 'bulto', packSize: 6 });
    expect(r.lines[1].packSize).toBeNull();
    const amargo = { id: 'a', name: 'Amargo Obrero 950 cc', unitId: 'u', purchaseFactor: 1, active: true } as Product;
    expect(toStockQty(1, 'B', amargo, lk)).toBe(1); // sin dato: no inventa
    expect(toStockQty(1, 'B', amargo, lk, 6)).toBe(6);
    expect(toStockQty(2, 'bulto', { ...amargo, purchaseFactor: 6 }, lk)).toBe(12); // el del producto manda
    expect(needsPackSize({ unit: 'B', status: 'ok' }, amargo, lk)).toBe(true);
    expect(needsPackSize({ unit: 'B', status: 'ok', packSize: 6 }, amargo, lk)).toBe(false);
    expect(needsPackSize({ unit: 'B', status: 'ok' }, { ...amargo, purchaseFactor: 6 }, lk)).toBe(false);
    expect(needsPackSize({ unit: 'caja', status: 'ok' }, { ...amargo, unitId: 'caja' }, lk)).toBe(false); // se cuenta en cajas
    expect(needsPackSize({ unit: 'u', status: 'ok' }, amargo, lk)).toBe(false);
    expect(pendingCount([{ ...line('x'), productId: 'a', unit: 'B' }], [amargo], lk)).toBe(1);
  });

  it('sugiere un nombre prolijo desde el texto de la factura', () => {
    expect(suggestName('1.000 AMARGO OBRERO X 950 CC')).toBe('Amargo Obrero x 950 cc');
  });
});

describe('facturas → stock: cargar, deshacer y aprender', () => {
  it('carga una sola vez, se deshace y se puede volver a cargar', async () => {
    await seedUnits();
    const coca = await product('Coca-Cola 2,25 L', { purchaseFactor: 6, purchaseUnitId: 'caja' });
    const harina = await product('Harina 0000', { unitId: 'kg' });
    const inv = await saveInvoice({
      date: '2026-10-17', number: 'A-1', pages: [{ id: 'pg1', image: img }],
      items: [
        line('COCA PET 2250', { productId: coca.id, quantity: 2, unit: 'caja', stockQty: 12 }),
        line('HARINA 0000 X 25', { productId: harina.id, quantity: 25, unit: 'kg', stockQty: 25 }),
        line('FLETE', { status: 'ignored' }),
      ],
    });
    const r = await applyInvoiceToStock(inv.id);
    expect(r.applied).toBe(2);
    expect((await db.products.get(coca.id))?.stock).toBe(12);
    expect((await db.products.get(harina.id))?.stock).toBe(25);
    const loaded = await db.invoices.get(inv.id);
    expect(loaded?.stockAppliedAt).toBeTruthy();
    expect(loaded?.stockMovementIds).toHaveLength(2);
    const mv = await db.movements.get(loaded!.stockMovementIds![0]);
    expect(mv).toMatchObject({ type: 'ingreso', origin: 'factura', refId: inv.id, reason: 'Factura A-1' });

    // Dos toques (o dos celulares): no se suma dos veces.
    await expect(applyInvoiceToStock(inv.id)).rejects.toThrow(/ya se cargó/);
    expect((await db.products.get(coca.id))?.stock).toBe(12);
    // Cargada: no se borra ni se cambian los renglones al editar.
    await expect(deleteInvoice(inv.id)).rejects.toThrow(/Deshacer carga/);
    const edited = await saveInvoice({ id: inv.id, date: '2026-10-17', pages: [{ id: 'pg1', existing: inv.pages[0] }], items: [] });
    expect(edited.items).toHaveLength(3);
    expect(edited.stockAppliedAt).toBe(loaded?.stockAppliedAt);

    expect(await undoInvoiceStock(inv.id)).toBe(2);
    expect((await db.products.get(coca.id))?.stock).toBe(0);
    expect((await db.invoices.get(inv.id))?.stockAppliedAt).toBeUndefined();

    await applyInvoiceToStock(inv.id);
    expect((await db.products.get(coca.id))?.stock).toBe(12);
    expect(await db.movements.where('productId').equals(coca.id).count()).toBe(3); // ingreso, deshacer, ingreso
  });

  it('no carga con renglones sin revisar ni cajas sin unidades', async () => {
    await seedUnits();
    const amargo = await product('Amargo Obrero 950 cc');
    const base = { date: '2026-10-17', pages: [{ id: 'pg2', image: img }] };
    const a = await saveInvoice({ ...base, items: [line('AMARGO', { productId: amargo.id, status: 'check', stockQty: 1 })] });
    await expect(applyInvoiceToStock(a.id)).rejects.toThrow(/revisá 1 renglón/);
    const b = await saveInvoice({ ...base, items: [line('AMARGO', { productId: amargo.id, unit: 'B', stockQty: 1 })] });
    await expect(applyInvoiceToStock(b.id)).rejects.toThrow(/unidades trae cada B/);
    expect((await db.products.get(amargo.id))?.stock).toBe(0);
  });

  it('recuerda cómo figura cada producto y cuántas trae el bulto', async () => {
    await seedUnits();
    const amargo = await product('Amargo Obrero 950 cc');
    await learnFromInvoice([line('AMARGO OBRERO X 950 CC', { productId: amargo.id, unit: 'B', packSize: 6, stockQty: 6 })]);
    const learned = (await db.products.get(amargo.id))!;
    expect(learned.invoiceAliases).toEqual([aliasKey('AMARGO OBRERO X 950 CC')]);
    expect(learned).toMatchObject({ purchaseFactor: 6, purchaseUnitId: 'caja' });

    // La próxima factura lo reconoce sola, aunque la IA no lo sugiera, y ya sabe que el bulto trae 6.
    const [item] = matchLines([{ description: 'AMARGO OBRERO X 950 CC', code: null, quantity: 2, unit: 'bulto', unitPrice: 2400, lineTotal: 4800, ref: null, confidence: 'ninguna' }], [learned], lk, new Map());
    expect(item).toMatchObject({ productId: amargo.id, status: 'ok', stockQty: 12 });

    // Editar el producto con un formulario viejo no borra lo aprendido.
    await saveProduct({ ...amargo, minStock: 3 });
    expect((await db.products.get(amargo.id))?.invoiceAliases).toEqual(learned.invoiceAliases);
  });

  it('crea el producto desde el renglón y lo deja listo para cargar', async () => {
    await seedUnits();
    const item = line('FERNET BRANCA X 750', { status: 'none', unit: 'CJ', quantity: 2 });
    const r = await createProductFromLine(item, { name: 'Fernet Branca 750', unitId: 'u', packSize: 6 }, lk);
    expect(r.product).toMatchObject({ name: 'Fernet Branca 750', purchaseFactor: 6, purchaseUnitId: 'caja', invoiceAliases: [aliasKey('FERNET BRANCA X 750')] });
    expect(r.item).toMatchObject({ productId: r.product.id, status: 'ok', stockQty: 12, packSize: 6 });
    await expect(createProductFromLine(item, { name: 'fernet branca 750' }, lk)).rejects.toThrow(/Ya existe/);
  });
});

describe('pago de la factura', () => {
  it('se guarda aparte, calcula cuándo se cobra el eCheq y no se pierde al editar la factura', async () => {
    const { saveInvoice, setInvoicePayment, paymentDueDate, paymentText } = await import('../../src/services/invoiceService');
    const inv = await saveInvoice({ date: '2026-10-19', pages: [{ id: 'pgp', image: img }], number: 'A-1', total: 1000 });
    await setInvoicePayment(inv.id, { method: 'echeq', days: 30, paid: false });
    let got = (await db.invoices.get(inv.id))!;
    expect(got.payment).toMatchObject({ method: 'echeq', days: 30, paid: false });
    expect(paymentDueDate(got)).toBe('2026-11-18');
    expect(paymentText(got.payment)).toBe('eCheq 30 días');
    await saveInvoice({ id: inv.id, date: '2026-10-19', pages: [{ id: 'pgp', existing: inv.pages[0] }], number: 'A-1', total: 1200 });
    got = (await db.invoices.get(inv.id))!;
    expect(got.total).toBe(1200);
    expect(got.payment?.days).toBe(30);
    await setInvoicePayment(inv.id, { method: 'efectivo', paid: true, paidAt: '2026-10-21' });
    got = (await db.invoices.get(inv.id))!;
    expect(got.payment).toMatchObject({ method: 'efectivo', paid: true, paidAt: '2026-10-21' });
    expect(got.payment?.days).toBeUndefined();
    expect(paymentDueDate(got)).toBeUndefined();
  });
});
