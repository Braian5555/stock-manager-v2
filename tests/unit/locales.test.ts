import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { openCash, openSession } from '../../src/services/cashService';
import { fiscalForLocal } from '../../src/services/fiscalService';
import { CENTRAL, currentOutlet, inLocal, refreshLocalScope, setCentralView, setDeviceLocal } from '../../src/services/localScope';
import { ticketBusiness } from '../../src/services/printService';
import { addNumberedTables, openTicket, saveMenuItem } from '../../src/services/salonService';
import { getSettings, updateSettings } from '../../src/services/settingsService';
import { saveOutlet } from '../../src/services/transferService';

describe('locales: cada local con lo suyo, sin cruzarse', () => {
  it('lo de antes es del primer local; lo nuevo queda en el local del equipo; caja y punto de venta por local', async () => {
    await getSettings();
    // Antes de tener locales: una mesa y un plato (sin local).
    await addNumberedTables(1, 1, 'Salón');
    const viejo = await saveMenuItem({ name: 'Café', section: 'Cafetería', price: 1000, kitchen: false });
    expect(viejo.outletId).toBeUndefined();

    const xenote = await saveOutlet({ name: 'Xenote', code: '10', ptoVta: 10, active: true, ticketHeader: 'Xenote\nCamping Americano' });
    const kiosco = await saveOutlet({ name: 'Kiosco', code: '8', ptoVta: 8, active: true });
    await expect(saveOutlet({ name: 'Sweet', ptoVta: 8, active: true })).rejects.toThrow(/ya es de Kiosco/);
    await expect(saveOutlet({ name: 'Sweet', code: '8', active: true })).rejects.toThrow(/número 8/);
    expect((await getSettings()).defaultOutletId).toBe(xenote.id);

    // Equipo del Xenote: ve lo de antes y lo suyo; factura con el PV 10; su encabezado.
    setDeviceLocal(xenote.id);
    await refreshLocalScope();
    expect(currentOutlet()?.name).toBe('Xenote');
    expect(inLocal(viejo)).toBe(true);
    const pizza = await saveMenuItem({ name: 'Pizza', section: 'Platos', price: 9000, kitchen: false });
    expect(pizza.outletId).toBe(xenote.id);
    const [mesaX] = await db.diningTables.toArray();
    const tx = await openTicket(mesaX.id);
    expect(tx.outletId).toBe(xenote.id);
    const s = await getSettings();
    expect(fiscalForLocal(s).ptoVta).toBe(10);
    expect(ticketBusiness(s).split('\n')).toEqual(['Xenote', 'Camping Americano', 'Sucursal: Xenote']);
    const cajaX = await openCash(1000);
    expect(cajaX.outletId).toBe(xenote.id);

    // Equipo del Kiosco: no ve nada del Xenote; su propia caja (número 1) y PV 8.
    setDeviceLocal(kiosco.id);
    await refreshLocalScope();
    expect(inLocal(viejo)).toBe(false);
    expect(inLocal(pizza)).toBe(false);
    expect(inLocal(tx)).toBe(false);
    expect(await openSession()).toBeUndefined();
    const cajaK = await openCash(0);
    expect(cajaK.number).toBe(1);
    expect(cajaK.outletId).toBe(kiosco.id);
    expect(fiscalForLocal(await getSettings()).ptoVta).toBe(8);
    expect(ticketBusiness(await getSettings()).split('\n').at(-1)).toBe('Sucursal: Kiosco');

    // La Central: ve todo junto; para cargar algo elige un local.
    setDeviceLocal(CENTRAL);
    await refreshLocalScope();
    expect(currentOutlet()).toBeUndefined();
    expect(inLocal(pizza) && inLocal(tx) && inLocal(cajaK)).toBe(true);
    await expect(saveMenuItem({ name: 'Agua', section: 'Bebidas', price: 1500, kitchen: false })).rejects.toThrow(/Central/);
    setCentralView(kiosco.id);
    expect(currentOutlet()?.name).toBe('Kiosco');
    expect(inLocal(pizza)).toBe(false);
    expect(inLocal(cajaK)).toBe(true);
    expect((await saveMenuItem({ name: 'Agua', section: 'Bebidas', price: 1500, kitchen: false })).outletId).toBe(kiosco.id);
    setCentralView(undefined);

    // Sin local elegido (o sin locales) todo se ve, como antes.
    setDeviceLocal(undefined);
    await refreshLocalScope();
    expect(inLocal(pizza) && inLocal(tx)).toBe(true);
    await updateSettings({ ticketHeader: 'Complejo Americano' });
    expect(ticketBusiness(await getSettings())).toBe('Complejo Americano');
  });
});
