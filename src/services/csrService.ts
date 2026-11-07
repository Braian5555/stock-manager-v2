/**
 * Clave privada y pedido de certificado (CSR) para ARCA, generados EN EL NAVEGADOR con WebCrypto.
 *
 * La clave se crea en la compu de quien la pide y se descarga ahí mismo: no se sube a ningún lado
 * (ni a la nube de la app ni a ningún servidor). El CSR es un PKCS#10 firmado con SHA-256 y RSA,
 * con el sujeto que pide ARCA: C=AR, O=<razón social>, CN=<alias>, serialNumber=CUIT <número>.
 */

// ── DER mínimo ──
function len(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) { out.unshift(n & 0xff); n >>= 8; }
  return [0x80 | out.length, ...out];
}
const tlv = (tag: number, body: Uint8Array): Uint8Array => new Uint8Array([tag, ...len(body.length), ...body]);
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(...parts));
const set = (...parts: Uint8Array[]) => tlv(0x31, concat(...parts));
function oid(dotted: string): Uint8Array {
  const n = dotted.split('.').map(Number);
  const out = [40 * n[0] + n[1]];
  for (const v of n.slice(2)) {
    const bytes = [v & 0x7f];
    let x = v >> 7;
    while (x > 0) { bytes.unshift((x & 0x7f) | 0x80); x >>= 7; }
    out.push(...bytes);
  }
  return tlv(0x06, new Uint8Array(out));
}
const utf8 = (s: string) => tlv(0x0c, new TextEncoder().encode(s));
const printable = (s: string) => tlv(0x13, new TextEncoder().encode(s));
const attr = (o: string, value: Uint8Array) => set(seq(oid(o), value));

/** Texto para el sujeto: sin acentos ni caracteres raros (ARCA y algunos lectores se traban). */
export function plainText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,\-&()/]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Alias (CN) válido para ARCA: letras, números y guiones, sin espacios. */
export function cleanAlias(s: string): string {
  return plainText(s).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
}

const pem = (label: string, der: Uint8Array) => {
  let b64 = '';
  const chunk = 0x8000;
  for (let i = 0; i < der.length; i += chunk) b64 += String.fromCharCode(...der.subarray(i, i + chunk));
  const body = btoa(b64).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
};

export interface CsrInput { cuit: string; razonSocial: string; alias: string }
export interface CsrResult { keyPem: string; csrPem: string; subject: string }

export async function generateKeyAndCsr(input: CsrInput, subtle: SubtleCrypto = crypto.subtle): Promise<CsrResult> {
  const cuit = input.cuit.replace(/\D/g, '');
  if (cuit.length !== 11) throw new Error('El CUIT tiene que tener 11 números.');
  const org = plainText(input.razonSocial);
  if (!org) throw new Error('Falta la razón social.');
  const alias = cleanAlias(input.alias);
  if (!alias) throw new Error('Falta el alias (sin espacios ni acentos).');

  const keys = await subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const spki = new Uint8Array(await subtle.exportKey('spki', keys.publicKey));
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', keys.privateKey));

  const subject = seq(
    attr('2.5.4.6', printable('AR')),
    attr('2.5.4.10', utf8(org)),
    attr('2.5.4.3', utf8(alias)),
    attr('2.5.4.5', printable(`CUIT ${cuit}`)),
  );
  const info = seq(tlv(0x02, new Uint8Array([0])), subject, spki, new Uint8Array([0xa0, 0x00]));
  const sig = new Uint8Array(await subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, info as Uint8Array<ArrayBuffer>));
  const csr = seq(info, seq(oid('1.2.840.113549.1.1.11'), new Uint8Array([0x05, 0x00])), tlv(0x03, concat(new Uint8Array([0]), sig)));
  return { keyPem: pem('PRIVATE KEY', pkcs8), csrPem: pem('CERTIFICATE REQUEST', csr), subject: `C=AR, O=${org}, CN=${alias}, serialNumber=CUIT ${cuit}` };
}
