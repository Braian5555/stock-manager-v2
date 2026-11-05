import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildTRA, certInfo, emit, getTA, handle, signCMS, todayAR, validCuit, validateDoc,
} from '../../workers/arca/worker.js';
import { CUIT, CUIT_CLIENTE, fakeArca, kv, makeCert, withDv } from './arca-fixtures';

let certPem = '';
let keyPkcs8 = '';
let keyPkcs1 = '';
beforeAll(() => {
  const p = makeCert();
  certPem = p.cert;
  keyPkcs8 = p.pkcs8;
  keyPkcs1 = p.pkcs1;
});

const envFor = (extra: Record<string, unknown> = {}) => ({ ARCA_CUIT: CUIT, ARCA_HOMO_CERT: certPem, ARCA_HOMO_KEY: keyPkcs8, ARCA_WORKSPACE: 'ws_123', ARCA_TA: kv(), ...extra });

/** Factura B a consumidor final por $12.100 (IVA 21% incluido). */
const docB = (over: Record<string, unknown> = {}) => ({
  ptoVta: 5, cbteTipo: 6, nro: 1, concepto: 1, fecha: todayAR(), docTipo: 99, docNro: '0', condicionIvaReceptor: 5,
  impTotal: 12100, impNeto: 10000, impIva: 2100, impTotConc: 0, impOpEx: 0, impTrib: 0,
  iva: [{ id: 5, baseImp: 10000, importe: 2100 }], ...over,
});

describe('ARCA · WSAA (autenticación)', () => {
  it('firma el TRA en CMS que OpenSSL verifica con el certificado (PKCS#8 y PKCS#1, con o sin saltos de línea)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cms-'));
    const tra = buildTRA('wsfe', Date.parse('2026-11-05T15:00:00Z'));
    expect(tra).toContain('<service>wsfe</service>');
    expect(tra).toContain('<generationTime>2026-11-05T11:50:00-03:00</generationTime>');
    for (const key of [keyPkcs8, keyPkcs1, keyPkcs1.replace(/\r?\n/g, ' ')]) {
      const b64 = await signCMS(tra, certPem, key);
      writeFileSync(join(dir, 'tra.cms'), Buffer.from(b64, 'base64'));
      writeFileSync(join(dir, 'cert.pem'), certPem);
      const out = execFileSync('openssl', ['cms', '-verify', '-inform', 'DER', '-in', join(dir, 'tra.cms'), '-noverify', '-certfile', join(dir, 'cert.pem'), '-out', join(dir, 'out.xml')], { stdio: 'pipe' });
      void out;
      expect(readFileSync(join(dir, 'out.xml'), 'utf8')).toBe(tra);
    }
  });

  it('lee CUIT y vencimiento del certificado', () => {
    const ci = certInfo(certPem);
    expect(ci.cuit).toBe(CUIT);
    expect(ci.cn).toBe('stockmanager');
    expect(ci.notAfter).toBe('2028-01-01T00:00:00Z');
  });

  it('guarda el Token en KV y no vuelve a pedirlo mientras está vigente', async () => {
    const env = envFor();
    const a = fakeArca();
    const t1 = await getTA(env, 'homologacion', a.f, []);
    const t2 = await getTA(env, 'homologacion', a.f, []);
    expect(t1.token).toBe('TOKEN1');
    expect(t2.token).toBe('TOKEN1');
    expect(a.state.logins).toBe(1);
    expect(env.ARCA_TA.m.size).toBe(1);
  });

  it('explica el "ya posee un TA válido" y el certificado faltante', async () => {
    const a = fakeArca({ mode: { login: 'already' } });
    await expect(getTA(envFor({ ARCA_CUIT: withDv('2099999999') }), 'homologacion', a.f, [])).rejects.toThrow(/ya hay un acceso vigente/);
    await expect(getTA(envFor({ ARCA_HOMO_CERT: '' }), 'homologacion', a.f, [])).rejects.toThrow(/certificado y la clave de homologación/);
    await expect(getTA(envFor(), 'produccion', a.f, [])).rejects.toThrow(/Producción no está habilitada/);
  });

  it('una clave con contraseña se rechaza con un mensaje claro', async () => {
    await expect(signCMS('x', certPem, '-----BEGIN ENCRYPTED PRIVATE KEY-----\nAAAA\n-----END ENCRYPTED PRIVATE KEY-----')).rejects.toThrow(/contraseña/);
  });
});

describe('ARCA · WSFEv1 (pedido de CAE sin duplicar)', () => {
  it('autoriza el siguiente número y manda condición de IVA, alícuotas e importes con 2 decimales', async () => {
    const a = fakeArca({ last: 41 });
    const log: { op: string; request: string }[] = [];
    const r = await emit(envFor(), 'homologacion', docB({ nro: 42 }), a.f, log);
    expect(r).toMatchObject({ status: 'autorizada', nro: 42 });
    expect(r.cae).toMatch(/^\d{14}$/);
    expect(a.state.lastBody).toContain('<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>');
    expect(a.state.lastBody).toContain('<ar:AlicIva><ar:Id>5</ar:Id><ar:BaseImp>10000.00</ar:BaseImp><ar:Importe>2100.00</ar:Importe></ar:AlicIva>');
    expect(a.state.lastBody).toContain('<ar:ImpTotal>12100.00</ar:ImpTotal>');
    // El registro no guarda Token ni Sign.
    expect(JSON.stringify(log)).not.toMatch(/TOKEN1|SIGN1/);
    expect(log.map((l) => l.op)).toEqual(['WSAA.loginCms', 'WSFE.FECompUltimoAutorizado', 'WSFE.FECAESolicitar']);
  });

  it('si el número anotado no es el siguiente, pide renumerar (no salta ni repite números)', async () => {
    const a = fakeArca({ last: 10 });
    expect(await emit(envFor(), 'homologacion', docB({ nro: 5 }), a.f, [])).toMatchObject({ status: 'renumerar', next: 11 });
    expect(await emit(envFor(), 'homologacion', docB({ nro: 13 }), a.f, [])).toMatchObject({ status: 'renumerar', next: 11 });
    expect(a.state.calls).not.toContain('FECAESolicitar');
  });

  it('respuesta perdida después de autorizar → incierta; al reintentar recupera el MISMO CAE sin pedir otro', async () => {
    const a = fakeArca({ mode: { solicitar: 'drop' } });
    const env = envFor();
    const first = await emit(env, 'homologacion', docB(), a.f, []);
    expect(first).toMatchObject({ status: 'incierta', nro: 1 });
    const cae = a.state.docs.get('5-6-1')!.cae;
    a.state.calls.length = 0;
    const retry = await emit(env, 'homologacion', docB(), a.f, []);
    expect(retry).toMatchObject({ status: 'autorizada', recovered: true, nro: 1, cae });
    expect(a.state.calls).toEqual(['FECompUltimoAutorizado', 'FECompConsultar']);
    expect(a.state.docs.size).toBe(1);
  });

  it('corte antes de llegar a ARCA → incierta; al reintentar lo pide (una sola factura en total)', async () => {
    const a = fakeArca({ mode: { solicitar: 'down' } });
    const env = envFor();
    expect(await emit(env, 'homologacion', docB(), a.f, [])).toMatchObject({ status: 'incierta' });
    a.state.mode.solicitar = '';
    expect(await emit(env, 'homologacion', docB(), a.f, [])).toMatchObject({ status: 'autorizada', nro: 1 });
    expect(a.state.docs.size).toBe(1);
  });

  it('si el número lo usó otro comprobante distinto, no lo toma como propio', async () => {
    const a = fakeArca();
    const env = envFor();
    await emit(env, 'homologacion', docB({ impTotal: 6050, impNeto: 5000, impIva: 1050, iva: [{ id: 5, baseImp: 5000, importe: 1050 }] }), a.f, []);
    expect(await emit(env, 'homologacion', docB({ nro: 1 }), a.f, [])).toMatchObject({ status: 'renumerar', next: 2 });
  });

  it('rechazo de ARCA: devuelve las observaciones y no marca autorizada', async () => {
    const a = fakeArca({ mode: { solicitar: 'reject' } });
    const r = await emit(envFor(), 'homologacion', docB(), a.f, []);
    expect(r.status).toBe('rechazada');
    expect(r.obs[0]).toMatchObject({ code: 10013 });
    expect(r.cae).toBeUndefined();
  });

  it('otro dispositivo tomó el número en el medio (10016) → renumerar', async () => {
    const a = fakeArca({ mode: { solicitar: 'race' } });
    expect(await emit(envFor(), 'homologacion', docB(), a.f, [])).toMatchObject({ status: 'renumerar', next: 2 });
  });

  it('ARCA con error interno (501) → incierta, para reintentar con consulta', async () => {
    const a = fakeArca({ mode: { solicitar: 'infra' } });
    expect(await emit(envFor(), 'homologacion', docB(), a.f, [])).toMatchObject({ status: 'incierta' });
  });

  it('token rechazado (600): pide uno nuevo y reintenta una vez', async () => {
    const a = fakeArca({ mode: { token600: '1' } });
    expect(await emit(envFor(), 'homologacion', docB(), a.f, [])).toMatchObject({ status: 'autorizada' });
    expect(a.state.logins).toBe(2);
  });

  it('nota de crédito B asociada a la factura', async () => {
    const a = fakeArca();
    const r = await emit(envFor(), 'homologacion', docB({ cbteTipo: 8, asociado: { cbteTipo: 6, ptoVta: 5, nro: 42, fecha: todayAR() } }), a.f, []);
    expect(r.status).toBe('autorizada');
    expect(a.state.lastBody).toContain(`<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>6</ar:Tipo><ar:PtoVta>5</ar:PtoVta><ar:Nro>42</ar:Nro><ar:Cuit>${CUIT}</ar:Cuit>`);
  });
});

describe('ARCA · validaciones antes de enviar', () => {
  it('controla totales, letra, receptor, IVA, fecha y comprobante asociado', () => {
    expect(validateDoc(docB())).toEqual([]);
    expect(validateDoc(docB({ impTotal: 12000 })).join()).toMatch(/no coincide con neto/);
    expect(validateDoc(docB({ cbteTipo: 1 })).join()).toMatch(/requieren el CUIT/);
    expect(validateDoc(docB({ cbteTipo: 1, docTipo: 80, docNro: CUIT_CLIENTE, condicionIvaReceptor: 1 }))).toEqual([]);
    expect(validateDoc(docB({ docTipo: 80, docNro: '20333333330', condicionIvaReceptor: 6 })).join()).toMatch(/CUIT\/CUIL del receptor no es válido/);
    expect(validateDoc(docB({ condicionIvaReceptor: 1, docTipo: 80, docNro: CUIT_CLIENTE })).join()).toMatch(/corresponde factura A/);
    expect(validateDoc(docB({ condicionIvaReceptor: undefined })).join()).toMatch(/condición frente al IVA/);
    const big = { impTotal: 12100000, impNeto: 10000000, impIva: 2100000, iva: [{ id: 5, baseImp: 10000000, importe: 2100000 }] };
    expect(validateDoc(docB(big)).join()).toMatch(/identificar al consumidor final/);
    expect(validateDoc(docB({ ...big, docTipo: 96, docNro: '30111222' }))).toEqual([]);
    expect(validateDoc(docB({ iva: [{ id: 5, baseImp: 10000, importe: 2000 }], impIva: 2000, impTotal: 12000 })).join()).toMatch(/IVA 21% no coincide/);
    expect(validateDoc(docB({ cbteTipo: 11, impNeto: 12100, impIva: 0, iva: [] }))).toEqual([]);
    expect(validateDoc(docB({ cbteTipo: 11 })).join()).toMatch(/C no discriminan IVA/);
    expect(validateDoc(docB({ cbteTipo: 8 })).join()).toMatch(/comprobante asociado/);
    expect(validateDoc(docB({ fecha: '20200101' })).join()).toMatch(/entre 5 días antes/);
    expect(validateDoc(docB({ impTotal: 12100.005 })).join()).toMatch(/Importe inválido/);
  });

  it('dígito verificador de CUIT', () => {
    expect(validCuit(CUIT)).toBe(true);
    expect(validCuit('20-33333333-0')).toBe(false);
    expect(validCuit('123')).toBe(false);
  });
});

// ───────────── sesión y permisos (rutas del Worker) ─────────────

const ORIGIN = 'https://stock-manager-a7cf7.web.app';
const b64url = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
let jwtKeys: CryptoKeyPair;
let jwk: JsonWebKey & { kid: string };
async function idToken(claims: Record<string, unknown> = {}) {
  if (!jwtKeys) {
    jwtKeys = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey('jwk', jwtKeys.publicKey)), kid: 'k1' };
  }
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
  const p = b64url(JSON.stringify({ aud: 'stock-manager-a7cf7', iss: 'https://securetoken.google.com/stock-manager-a7cf7', sub: 'uid-1', email: 'caja@epicurae.com', iat: now, exp: now + 3600, ...claims }));
  const s = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', jwtKeys.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(s)}`;
}
/** Google + Firestore (espacio y usuario) + ARCA. */
function net(opts: { role?: string; userRole?: string; perms?: string[] } = {}) {
  const arca = fakeArca();
  const f = async (url: string, init?: RequestInit) => {
    if (url.includes('securetoken@system')) return new Response(JSON.stringify({ keys: [jwk] }));
    if (url.endsWith('/workspaces/ws_123')) return new Response(JSON.stringify({ fields: { memberUids: { arrayValue: { values: [{ stringValue: 'uid-1' }] } }, roles: { mapValue: { fields: { 'uid-1': { stringValue: opts.role ?? 'member' } } } } } }));
    if (url.endsWith(':runQuery')) {
      if (!opts.userRole) return new Response('[{}]');
      return new Response(JSON.stringify([{ document: { fields: { name: { stringValue: 'Caja' }, role: { stringValue: opts.userRole }, active: { booleanValue: true }, permissions: { arrayValue: { values: (opts.perms ?? []).map((v) => ({ stringValue: v })) } } } } }]));
    }
    return arca.f(url, init);
  };
  return { f, arca };
}
const req = async (path: string, body: unknown, over: { auth?: string; ws?: string } = {}) => new Request(`https://arca.example${path}`, {
  method: 'POST',
  headers: { Origin: ORIGIN, Authorization: `Bearer ${over.auth ?? (await idToken())}`, 'X-Workspace': over.ws ?? 'ws_123', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('ARCA · quién puede facturar', () => {
  it('sin sesión 401; otro espacio 403; mozo sin permiso 403; encargado puede', async () => {
    const env = envFor();
    expect((await handle(await req('/last', {}, { auth: 'x.y.z' }), env, net().f)).status).toBe(401);
    expect((await handle(await req('/last', {}, { ws: 'otro_ws' }), env, net().f)).status).toBe(403);
    const waiter = await handle(await req('/last', { ambiente: 'homologacion', ptoVta: 5, cbteTipo: 6 }), env, net({ userRole: 'waiter' }).f);
    expect(waiter.status).toBe(403);
    expect((await waiter.json()).message).toMatch(/permiso para facturar/);
    const custom = await handle(await req('/last', { ambiente: 'homologacion', ptoVta: 5, cbteTipo: 6 }), env, net({ userRole: 'custom', perms: ['billing'] }).f);
    expect(custom.status).toBe(200);
    const ok = await handle(await req('/emit', { ambiente: 'homologacion', doc: docB() }), env, net({ userRole: 'manager' }).f);
    const j = await ok.json();
    expect(ok.status).toBe(200);
    expect(j).toMatchObject({ status: 'autorizada', nro: 1, by: 'Caja' });
    expect(JSON.stringify(j)).not.toMatch(/TOKEN1|SIGN1|PRIVATE KEY/);
  });

  it('el dueño del espacio puede; un comprobante inválido vuelve 422 con los problemas', async () => {
    const r = await handle(await req('/emit', { ambiente: 'homologacion', doc: docB({ impTotal: 1 }) }), envFor(), net({ role: 'owner' }).f);
    expect(r.status).toBe(422);
    expect((await r.json()).problems.join()).toMatch(/no coincide/);
  });

  it('/health no expone secretos y /status informa el certificado', async () => {
    const env = envFor();
    const h = await handle(new Request('https://arca.example/health'), env, net().f);
    const txt = await h.text();
    expect(txt).not.toContain(CUIT);
    expect(txt).not.toMatch(/BEGIN/);
    expect(JSON.parse(txt)).toMatchObject({ homologacion: true, produccion: false, kv: true });
    const s = await handle(await req('/status', { ambiente: 'homologacion', probar: true, ptoVta: 5 }), env, net({ role: 'owner' }).f);
    const j = await s.json();
    expect(j.homologacion).toMatchObject({ cert: true, cuit: CUIT, vence: '2028-01-01T00:00:00Z', key: true });
    expect(j).toMatchObject({ autenticacion: 'ok', servidores: { app: 'OK' }, ultimoFB: 0 });
    expect(JSON.stringify(j)).not.toMatch(/BEGIN|TOKEN1/);
  });
});
