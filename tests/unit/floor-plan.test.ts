import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import {
  addFixture, applyLayout, deleteLayout, getFloorPlan, gridSpots, matchesLayout, removeFixture, saveLayout, setPlanLocked, setZoneFloor, updateFixture,
} from '../../src/services/floorPlanService';
import { refreshLocalScope, setDeviceLocal } from '../../src/services/localScope';
import { addNumberedTables, placeTable } from '../../src/services/salonService';
import { saveOutlet } from '../../src/services/transferService';

const zoneTables = async () => (await db.diningTables.toArray()).filter((t) => t.zone === 'Salón').sort((a, b) => a.order - b.order);

describe('plano del salón: armados, piso, elementos y candado', () => {
  it('guarda armados, cambia de uno a otro y respeta el candado', async () => {
    await addNumberedTables(1, 4, 'Salón');
    let tables = await zoneTables();
    // Armado "Día": filas parejas, piso de arena, barra y mar.
    const grid = gridSpots(tables);
    for (const t of tables) await placeTable(t.id, grid[t.id]);
    await setZoneFloor('Salón', 'arena');
    const barra = await addFixture('Salón', 'barra');
    await addFixture('Salón', 'mar');
    await updateFixture('Salón', barra.id, { x: 150, y: 20, vertical: true, size: 3 });
    tables = await zoneTables();
    const dia = await saveLayout('Salón', '  Día ', tables);
    expect(dia.name).toBe('Día');
    let plan = (await getFloorPlan()).zones!['Salón'];
    expect(plan.fixtures!.find((f) => f.id === barra.id)).toMatchObject({ x: 97, y: 20, vertical: true, size: 3 });
    expect(matchesLayout(dia, plan, tables)).toBe(true);

    // Armado "Noche": mesa 1 a un costado, sin el mar, piso de madera.
    await placeTable(tables[0].id, { x: 10, y: 10, shape: 'redonda' });
    await removeFixture('Salón', plan.fixtures!.find((f) => f.kind === 'mar')!.id);
    await setZoneFloor('Salón', 'madera');
    tables = await zoneTables();
    plan = (await getFloorPlan()).zones!['Salón'];
    expect(matchesLayout(dia, plan, tables)).toBe(false);
    const noche = await saveLayout('Salón', 'Noche', tables);

    // Volver al de día: todo como estaba.
    await applyLayout('Salón', dia.id);
    tables = await zoneTables();
    plan = (await getFloorPlan()).zones!['Salón'];
    expect(tables[0]).toMatchObject({ x: grid[tables[0].id].x, y: grid[tables[0].id].y, shape: 'cuadrada' });
    expect(plan.floor).toBe('arena');
    expect(plan.fixtures!.map((f) => f.kind).sort()).toEqual(['barra', 'mar']);
    expect(plan.layoutId).toBe(dia.id);

    // Con el mismo nombre se actualiza (no se duplica).
    await saveLayout('Salón', 'noche', tables);
    expect((await getFloorPlan()).zones!['Salón'].layouts!.map((l) => l.name)).toEqual(['Día', 'noche']);
    await expect(saveLayout('Salón', '   ', tables)).rejects.toThrow(/nombre/);

    // Candado: nada se mueve ni cambia de armado; guardar y desbloquear sí.
    await setPlanLocked(true, 'Braian');
    expect((await getFloorPlan()).locked?.by).toBe('Braian');
    await expect(placeTable(tables[1].id, { x: 50, y: 50 })).rejects.toThrow(/bloqueado/);
    await expect(applyLayout('Salón', noche.id)).rejects.toThrow(/bloqueado/);
    await expect(addFixture('Salón', 'planta')).rejects.toThrow(/bloqueado/);
    await expect(setZoneFloor('Salón', 'liso')).rejects.toThrow(/bloqueado/);
    await setPlanLocked(false);
    await placeTable(tables[0].id, { x: 10, y: 10, shape: 'redonda' });
    await applyLayout('Salón', noche.id);
    // "noche" se volvió a guardar como el de día: vuelve la forma cuadrada también.
    expect((await zoneTables())[0]).toMatchObject({ x: grid[tables[0].id].x, y: grid[tables[0].id].y, shape: 'cuadrada' });
    await deleteLayout('Salón', noche.id);
    expect((await getFloorPlan()).zones!['Salón'].layoutId).toBeUndefined();
  });

  it('cada local tiene su plano (y su candado)', async () => {
    const a = await saveOutlet({ name: 'Parador', ptoVta: 2, active: true });
    const b = await saveOutlet({ name: 'Xenote', ptoVta: 10, active: true });
    setDeviceLocal(a.id);
    await refreshLocalScope();
    await setZoneFloor('Salón', 'arena');
    await setPlanLocked(true);
    setDeviceLocal(b.id);
    await refreshLocalScope();
    expect(await getFloorPlan()).toEqual({});
    await setZoneFloor('Salón', 'baldosas');
    // Editar el local no borra su plano.
    await saveOutlet({ id: a.id, name: 'Parador Playa', ptoVta: 2, active: true });
    expect((await db.outlets.get(a.id))?.floorPlan).toMatchObject({ locked: {}, zones: { Salón: { floor: 'arena' } } });
    expect((await db.outlets.get(b.id))?.floorPlan?.zones?.['Salón'].floor).toBe('baldosas');
  });
});
