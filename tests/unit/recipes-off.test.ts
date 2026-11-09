import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { toolsFor } from '../../src/services/assistant/tools';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { registerProduction } from '../../src/services/productionService';
import { addLine, addNumberedTables, closeTicket, openTicket, saveMenuItem, sendToKitchen } from '../../src/services/salonService';
import { defaultSettings, getSettings, recipesOn, updateSettings } from '../../src/services/settingsService';

describe('sin recetas: el stock es sólo de productos', () => {
  it('viene apagado; producir sólo suma lo producido y vender no descuenta insumos', async () => {
    expect(recipesOn(defaultSettings())).toBe(false);
    await updateSettings({ recipes: false });
    expect(recipesOn(await getSettings())).toBe(false);

    const harina = await saveProduct({ ...emptyProduct(), name: 'Harina 000' }, 25);
    const pan = await saveProduct({ ...emptyProduct(), name: 'Pan', recipe: { yield: 10, items: [{ productId: harina.id, quantity: 5 }] } }, 0);
    const r = await registerProduction(pan.id, 20);
    expect(r.consumed).toEqual([]);
    expect((await db.products.get(pan.id))!.stock).toBe(20);
    expect((await db.products.get(harina.id))!.stock).toBe(25);

    const cafe = await saveProduct({ ...emptyProduct(), name: 'Café' }, 10);
    const item = await saveMenuItem({ name: 'Café', section: 'Cafetería', price: 3000, kitchen: false, recipe: { yield: 1, items: [{ productId: cafe.id, quantity: 0.02 }] } });
    await addNumberedTables(1, 1, 'Salón');
    const [mesa] = await db.diningTables.toArray();
    const t = await openTicket(mesa.id);
    await addLine(t.id, item, 3);
    await sendToKitchen(t.id);
    await closeTicket(t.id);
    expect((await db.products.get(cafe.id))!.stock).toBe(10);
    expect(await db.movements.where('type').equals('venta').count()).toBe(0);

    // El asistente no ofrece guardar recetas.
    const can = () => true;
    expect(toolsFor(can, await getSettings()).map((x) => x.name)).not.toContain('guardar_receta');
    expect(toolsFor(can, { ...(await getSettings()), recipes: true }).map((x) => x.name)).toContain('guardar_receta');

    // Prendidas otra vez, la receta guardada vuelve a descontar.
    await updateSettings({ recipes: true });
    await registerProduction(pan.id, 10);
    expect((await db.products.get(harina.id))!.stock).toBe(20);
  });
});
