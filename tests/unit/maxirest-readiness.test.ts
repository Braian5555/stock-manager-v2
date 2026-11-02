import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { maxirestReadiness } from '../../src/integrations/maxirest/readiness';
import { emptyProduct, saveProduct } from '../../src/services/productService';

const t = '2026-11-02T10:00:00.000Z';
describe('preparación para Maxirest', () => {
  it('marca productos sin código, códigos repetidos, códigos que no existen en Maxirest y puntos sin depósito', async () => {
    await saveProduct({ ...emptyProduct(), name: 'Harina', sku: '12' });
    await saveProduct({ ...emptyProduct(), name: 'Azúcar', sku: '012' });
    await saveProduct({ ...emptyProduct(), name: 'Sal' });
    await saveProduct({ ...emptyProduct(), name: 'Aceite', sku: '99' });
    await db.externalReferences.bulkAdd([
      { id: 'r1', system: 'maxirest', entityType: 'product', externalId: '12', code: '12', name: 'HARINA', source: 'excel', lastSeenAt: t, createdAt: t, updatedAt: t },
      { id: 'r2', system: 'maxirest', entityType: 'product', externalId: 'X', code: '99', name: 'DEMO', source: 'mock', lastSeenAt: t, createdAt: t, updatedAt: t },
    ] as never);
    await db.outlets.bulkAdd([
      { id: 'o1', name: 'Confitería', active: true, maxirestName: 'CONFITERIA', createdAt: t, updatedAt: t },
      { id: 'o2', name: 'Xenote', active: true, createdAt: t, updatedAt: t },
    ] as never);
    const r = await maxirestReadiness();
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(r).toMatchObject({ products: 4, withCode: 3, maxirestItems: 1, ready: false });
    expect(by.codes.products?.map((p) => p.name)).toEqual(['Sal']);
    expect(by.duplicates.groups?.[0].products.map((p) => p.name)).toEqual(['Azúcar', 'Harina']);
    // El código 99 sólo está en datos de la demostración: no cuenta como Maxirest.
    expect(by.notInMaxirest.products?.map((p) => p.name)).toEqual(['Aceite']);
    expect(by.deposits.level).toBe('warn');
    expect(by.transfers.level).toBe('ok');
  });

  it('con todo completo queda lista', async () => {
    await saveProduct({ ...emptyProduct(), name: 'Harina', sku: '12' });
    const r = await maxirestReadiness();
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.id === 'notInMaxirest')?.level).toBe('info');
  });
});
