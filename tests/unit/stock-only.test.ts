import { describe, expect, it } from 'vitest';
import { moduleOn, visibleModules } from '../../src/layouts/modules';
import { defaultSettings, salonOn } from '../../src/services/settingsService';
import { isChunkLoadError } from '../../src/utils/chunkReload';

describe('app sólo de stock (Salón apagado)', () => {
  it('el Salón viene apagado y sus módulos no se ven; prendido vuelven', () => {
    const off = defaultSettings();
    expect(salonOn(off)).toBe(false);
    const all = () => true;
    const visibleOff = visibleModules(off, all);
    for (const k of ['salon', 'kitchen', 'fiscal', 'salonConfig'] as const) {
      expect(moduleOn(off, k)).toBe(false);
      expect(visibleOff).not.toContain(k);
    }
    expect(visibleOff).toEqual(expect.arrayContaining(['dashboard', 'stock', 'count', 'production', 'showcase', 'movements']));

    const on = { ...off, salon: true };
    expect(salonOn(on)).toBe(true);
    expect(visibleModules(on, all)).toEqual(expect.arrayContaining(['salon', 'kitchen', 'fiscal', 'salonConfig', 'stock']));
    // Los retirados siguen retirados aunque el Salón esté prendido.
    expect(moduleOn(on, 'transfers')).toBe(false);
  });

  it('reconoce el error de un archivo de una versión anterior', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/firebaseBackend-DY5e4l_2.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Permiso denegado'))).toBe(false);
  });
});
