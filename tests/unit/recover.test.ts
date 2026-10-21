import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { PRE_JOIN_BACKUP_KEY } from '../../src/cloud/cloudService';
import { dismissRecoverable, recoverableInvoices, recoverInvoices } from '../../src/services/recoverService';
import { emptyProduct, saveProduct } from '../../src/services/productService';

const t = '2026-10-20T10:00:00.000Z';

describe('facturas que quedaron afuera al entrar a la nube', () => {
  it('se traen con la foto, sin cargar al stock y con los productos del catálogo actual', async () => {
    const aceite = await saveProduct({ ...emptyProduct(), name: 'Aceite de girasol 900 ml', sku: '120' });
    await db.suppliers.add({ id: 'sup-actual', name: 'Distribuidora Santarossa', alternativeSupplierIds: [], createdAt: t, updatedAt: t } as never);
    const inv = {
      id: 'inv-nico', createdAt: t, updatedAt: t, date: '2026-10-20', number: '0011-00070001', supplierId: 'sup-viejo', total: 48000,
      pages: [{ id: 'pg-1', width: 10, height: 10, bytes: 6 }],
      items: [
        { id: 'a', description: 'ACEITE 900', quantity: 2, unit: 'caja', productId: 'prod-viejo', stockQty: 24, status: 'ok' },
        { id: 'b', description: 'COSA RARA', quantity: 1, productId: 'prod-sin-par', stockQty: 1, status: 'ok' },
      ],
      stockAppliedAt: t, stockMovementIds: ['m1'],
    };
    await db.meta.put({ key: PRE_JOIN_BACKUP_KEY, value: {
      tables: {
        invoices: [inv, { ...inv, id: 'inv-repetida', number: 'X-1' }],
        suppliers: [{ id: 'sup-viejo', name: 'distribuidora santarossa' }],
        products: [{ id: 'prod-viejo', name: 'Aceite girasol', sku: '120' }, { id: 'prod-sin-par', name: 'Cosa rara' }],
      },
      pendingImages: [{ id: 'pg-1', invoiceId: 'inv-nico', type: 'image/jpeg', data: 'QUJD', uploaded: 1 }],
    } });
    // Una ya está en la nube del negocio (mismo número y fecha): no se ofrece.
    await db.invoices.add({ id: 'otra', createdAt: t, updatedAt: t, date: '2026-10-20', number: 'X-1', pages: [] } as never);

    expect((await recoverableInvoices()).map((i) => i.id)).toEqual(['inv-nico']);
    expect(await recoverInvoices()).toBe(1);
    const got = await db.invoices.get('inv-nico');
    expect(got).toMatchObject({ supplierId: 'sup-actual', stockAppliedAt: undefined, stockMovementIds: undefined });
    expect(got?.items?.map((i) => [i.productId, i.status])).toEqual([[aceite.id, 'check'], [undefined, 'none']]);
    expect(got?.notes).toContain('No está cargada al stock');
    expect(await db.invoiceImages.get('pg-1')).toMatchObject({ invoiceId: 'inv-nico', data: 'QUJD', uploaded: 0 });
    expect(await recoverableInvoices()).toEqual([]);
    expect(await recoverInvoices()).toBe(0);
  });

  it('"No, gracias" deja de ofrecerlas', async () => {
    await db.meta.put({ key: PRE_JOIN_BACKUP_KEY, value: { tables: { invoices: [{ id: 'i1', createdAt: t, updatedAt: t, date: '2026-10-20', pages: [] }] } } });
    expect(await recoverableInvoices()).toHaveLength(1);
    await dismissRecoverable();
    expect(await recoverableInvoices()).toHaveLength(0);
  });
});
