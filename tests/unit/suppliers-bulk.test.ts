import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { bulkAddSuppliers, parseSupplierLines, saveEntity } from '../../src/services/entityService';

describe('carga masiva de proveedores', () => {
  it('interpreta nombre y nota, ignora vacías y repetidas', () => {
    const lines = parseSupplierLines('Lo de Camilo ; Verdulería\n\n  F & A\tAlmacén \nlo de camilo\nÁbalos | Almacén | 2026');
    expect(lines).toEqual([
      { name: 'Lo de Camilo', notes: 'Verdulería' },
      { name: 'F & A', notes: 'Almacén' },
      { name: 'Ábalos', notes: 'Almacén · 2026' },
    ]);
  });

  it('agrega los nuevos y saltea los que ya existen sin tocarlos', async () => {
    const prev = await saveEntity(db.suppliers, { name: 'Ábalos Distribuidora', phone: '123' });
    const res = await bulkAddSuppliers([{ name: 'abalos distribuidora', notes: 'x' }, { name: 'Triches Luciano', notes: 'Carnes' }]);
    expect(res).toEqual({ added: 1, skipped: ['abalos distribuidora'] });
    expect(await db.suppliers.count()).toBe(2);
    expect((await db.suppliers.get(prev.id))).toMatchObject({ phone: '123' });
    expect((await db.suppliers.where('name').equals('Triches Luciano').first())?.notes).toBe('Carnes');
  });
});
