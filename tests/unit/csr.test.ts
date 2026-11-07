import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanAlias, generateKeyAndCsr } from '../../src/services/csrService';

describe('clave y CSR para ARCA (en el navegador)', () => {
  it('genera un PKCS#10 válido (OpenSSL lo verifica) con el sujeto que pide ARCA', async () => {
    const r = await generateKeyAndCsr({ cuit: '30-71234567-1', razonSocial: 'EPICURAE S.A.', alias: 'Orillas Caja 1' });
    expect(r.keyPem).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(r.csrPem).toMatch(/^-----BEGIN CERTIFICATE REQUEST-----\n/);
    const dir = mkdtempSync(join(tmpdir(), 'csr-'));
    writeFileSync(join(dir, 'a.csr'), r.csrPem);
    writeFileSync(join(dir, 'a.key'), r.keyPem);
    const out = execFileSync('openssl', ['req', '-in', join(dir, 'a.csr'), '-noout', '-verify', '-subject', '-nameopt', 'RFC2253'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(out).toMatch(/serialNumber=CUIT 30712345671,CN=orillascaja1,O=EPICURAE S\.A\.,C=AR/);
    // La clave corresponde al pedido.
    const pubCsr = execFileSync('openssl', ['req', '-in', join(dir, 'a.csr'), '-noout', '-pubkey'], { encoding: 'utf8' });
    const pubKey = execFileSync('openssl', ['pkey', '-in', join(dir, 'a.key'), '-pubout'], { encoding: 'utf8' });
    expect(pubCsr).toBe(pubKey);
    const text = execFileSync('openssl', ['req', '-in', join(dir, 'a.csr'), '-noout', '-text'], { encoding: 'utf8' });
    expect(text).toContain('sha256WithRSAEncryption');
    expect(text).toMatch(/Public-Key: \(2048 bit\)/);
  });

  it('valida los datos y limpia el alias', async () => {
    await expect(generateKeyAndCsr({ cuit: '123', razonSocial: 'X', alias: 'a' })).rejects.toThrow(/11 números/);
    await expect(generateKeyAndCsr({ cuit: '30712345671', razonSocial: '', alias: 'a' })).rejects.toThrow(/razón social/);
    expect(cleanAlias('Orillas Caja Ñandú 2')).toBe('orillascajanandu2');
  });
});
