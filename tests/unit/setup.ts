import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../../src/database/db';
import { installLocalHooks, resetLocalScopeForTests, setDeviceLocal } from '../../src/services/localScope';
import { defaultSettings } from '../../src/services/settingsService';
import { setNegativeStockAllowed } from '../../src/services/stockService';

installLocalHooks();

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
  // Las pruebas de siempre usan recetas y el Salón (en la app vienen apagados: se prueban aparte, en recipes-off.test y stock-only.test).
  // También dejan el stock en negativo (en la app no baja de 0: se prueba en no-negative.test).
  await db.settings.put({ ...defaultSettings(), recipes: true, salon: true, negativeStock: true });
  setNegativeStockAllowed(true);
  setDeviceLocal(undefined);
  resetLocalScopeForTests();
});
