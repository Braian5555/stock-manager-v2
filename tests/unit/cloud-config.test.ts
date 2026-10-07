import { describe, expect, it } from 'vitest';
import { effectiveAuthDomain } from '../../src/cloud/config';

const cfg = { apiKey: 'k', authDomain: 'p1.firebaseapp.com', projectId: 'p1', appId: 'a' };

describe('dominio de inicio de sesión', () => {
  it('en Firebase Hosting usa el mismo dominio que la app', () => {
    expect(effectiveAuthDomain(cfg, 'p1.web.app')).toBe('p1.web.app');
    expect(effectiveAuthDomain(cfg, 'p1.firebaseapp.com')).toBe('p1.firebaseapp.com');
  });
  it('en otros dominios usa el configurado', () => {
    expect(effectiveAuthDomain(cfg, 'braian5555.github.io')).toBe('p1.firebaseapp.com');
    expect(effectiveAuthDomain(cfg, 'otro.web.app')).toBe('p1.firebaseapp.com');
  });
});
