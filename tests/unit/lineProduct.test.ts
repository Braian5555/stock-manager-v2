import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { createQuickProduct, lineFamilyId } from '../../src/services/lineProductService';

describe('productos nuevos desde Producción / Pastelería', () => {
  it('lo elaborado en pastelería va a la familia "Pastelería" (se crea si no hay)', async () => {
    const torta = await createQuickProduct({ name: '  Torta   rogel ', elaborated: true, line: 'pastry' });
    const fam = await db.categories.get(torta.categoryId!);
    expect(torta.name).toBe('Torta rogel');
    expect(fam?.name).toBe('Pastelería');
    // La segunda vez usa la misma familia.
    const budin = await createQuickProduct({ name: 'Budín de limón', elaborated: true, line: 'pastry' });
    expect(budin.categoryId).toBe(torta.categoryId);
    expect(await lineFamilyId('pastry')).toBe(torta.categoryId);
    expect((await db.categories.toArray()).filter((c) => c.name === 'Pastelería')).toHaveLength(1);
  });

  it('un insumo va a la familia elegida y no se duplica un nombre', async () => {
    await db.categories.add({ id: 'alm', name: 'Almacén', createdAt: '', updatedAt: '' } as never);
    const ddl = await createQuickProduct({ name: 'Dulce de leche', elaborated: false, line: 'pastry', categoryId: 'alm' });
    expect(ddl.categoryId).toBe('alm');
    await expect(createQuickProduct({ name: 'dulce de LECHE', elaborated: false })).rejects.toThrow(/Ya existe/);
  });
});
