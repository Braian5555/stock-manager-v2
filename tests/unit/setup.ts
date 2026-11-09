import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { db } from '../../src/database/db';
import { installLocalHooks, resetLocalScopeForTests, setDeviceLocal } from '../../src/services/localScope';
import { defaultSettings } from '../../src/services/settingsService';

installLocalHooks();

(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = 'test';

beforeEach(async () => {
  db.close();
  await db.delete();
  await db.open();
  // Las pruebas de siempre usan recetas (en la app vienen apagadas: se prueban aparte, en recipes-off.test).
  await db.settings.put({ ...defaultSettings(), recipes: true });
  setDeviceLocal(undefined);
  resetLocalScopeForTests();
});
