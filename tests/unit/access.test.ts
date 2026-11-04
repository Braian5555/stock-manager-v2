import { describe, expect, it } from 'vitest';
import { describeDevice, REOPEN_GAP_MS, shouldRecordOpening } from '../../src/services/accessService';

describe('registro de ingresos', () => {
  it('describe el dispositivo en criollo', () => {
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14; SM-A146M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', true)).toBe('Android · Chrome · app instalada');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', false)).toBe('iPhone · Safari');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0', false)).toBe('Windows · Edge');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 13) SamsungBrowser/25.0 Chrome/121 Mobile Safari/537.36', false)).toBe('Android · Samsung Internet');
  });

  it('abrir la app varias veces seguidas cuenta una sola vez', () => {
    const now = Date.parse('2026-11-04T19:00:00Z');
    expect(shouldRecordOpening(undefined, now)).toBe(true);
    expect(shouldRecordOpening({ at: new Date(now - 5 * 60_000).toISOString() }, now)).toBe(false);
    expect(shouldRecordOpening({ at: new Date(now - REOPEN_GAP_MS).toISOString() }, now)).toBe(true);
  });
});
