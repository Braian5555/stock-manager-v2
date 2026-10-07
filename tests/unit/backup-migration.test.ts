import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { db, SCHEMA_V1, StockDatabase } from '../../src/database/db';
import { createBackup, restoreBackup, stripSecrets, validateBackup } from '../../src/services/backupService';
import { ensureBaseData, loadDemoData } from '../../src/services/seedService';

describe('backup', () => {
  it('exporta, valida y restaura reemplazando los datos', async () => {
    await ensureBaseData();
    await loadDemoData();
    const backup = await createBackup();
    expect(validateBackup(backup).ok).toBe(true);
    const nProducts = await db.products.count();
    await db.products.clear();
    await db.suppliers.clear();
    await restoreBackup(JSON.parse(JSON.stringify(backup)));
    expect(await db.products.count()).toBe(nProducts);
    expect(await db.suppliers.count()).toBe(5);
  });

  it('rechaza archivos inválidos sin tocar la base', async () => {
    await ensureBaseData();
    expect(validateBackup({ hola: 1 }).ok).toBe(false);
    expect(validateBackup({ format: 'stock-manager-backup', tables: { products: [{ nombre: 'sin id' }] } }).ok).toBe(false);
    expect(validateBackup({ format: 'stock-manager-backup', dbVersion: 99, tables: { products: [] } }).ok).toBe(false);
    await expect(restoreBackup({ format: 'x' } as never)).rejects.toThrow();
    expect(await db.settings.count()).toBe(1);
  });

  it('nunca incluye secretos', async () => {
    const dirty = { id: '1', gatewayUrl: 'https://gw.example', apiKey: 'X', nested: { password: 'p', accessToken: 't', ok: 1 } };
    expect(stripSecrets(dirty)).toEqual({ id: '1', gatewayUrl: 'https://gw.example', nested: { ok: 1 } });
    await ensureBaseData();
    await db.integrations.update('maxirest', { ['apiToken' as never]: 'secreto' } as never);
    const json = JSON.stringify(await createBackup());
    expect(json).not.toContain('secreto');
  });
});

describe('migraciones', () => {
  it('v1 → v2 conserva productos y completa campos nuevos', async () => {
    db.close();
    await Dexie.delete('migration-test');
    const v1 = new Dexie('migration-test');
    v1.version(1).stores(SCHEMA_V1);
    await v1.open();
    await v1.table('products').add({ id: 'p1', name: 'Viejo', stock: 4, minStock: 1, maxStock: 9, createdAt: 'x', updatedAt: 'x' });
    v1.close();
    const v2 = new StockDatabase('migration-test');
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.products.get('p1')).toMatchObject({ name: 'Viejo', stock: 4, purchaseFactor: 1, alternativeSupplierIds: [], active: true });
    expect(await v2.syncJobs.count()).toBe(0);
    v2.close();
    await db.open();
  });
});
