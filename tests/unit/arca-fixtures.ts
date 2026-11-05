/* Fixtures de ARCA para las pruebas: certificado de prueba y ARCA simulada (WSAA + WSFEv1). */
import forge from 'node-forge';
import { tag } from '../../workers/arca/worker.js';

// ───────────── certificado de prueba (como el que da ARCA: CN + serialNumber "CUIT …") ─────────────

export const withDv = (base: string) => {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (w.reduce((a, x, i) => a + x * Number(base[i]), 0) % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return `${base}${dv}`;
};
export const CUIT = withDv('3071234567');
export const CUIT_CLIENTE = withDv('2033333333');

export const pems = { cert: '', pkcs8: '', pkcs1: '' };
export function makeCert() {
  if (pems.cert) return pems;
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '0a1b2c3d4e5f';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
  const subject = [{ name: 'commonName', value: 'stockmanager' }, { type: '2.5.4.5', value: `CUIT ${CUIT}` }];
  cert.setSubject(subject);
  cert.setIssuer([{ name: 'commonName', value: 'Computadores Test' }, { name: 'organizationName', value: 'ARCA' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  pems.cert = forge.pki.certificateToPem(cert);
  pems.pkcs1 = forge.pki.privateKeyToPem(keys.privateKey);
  pems.pkcs8 = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)));
  return pems;
}

// ───────────── ARCA simulada ─────────────

interface Doc { nro: number; fecha: string; docTipo: number; docNro: string; impTotal: number; cae: string }
export function fakeArca(opts: { mode?: Record<string, string>; last?: number } = {}) {
  const state = {
    last: new Map<string, number>(),
    docs: new Map<string, Doc>(),
    calls: [] as string[],
    logins: 0,
    mode: opts.mode ?? ({} as Record<string, string>),
    caeSeq: 76000000000000,
    lastBody: '',
  };
  const key = (pv: number, t: number) => `${pv}-${t}`;
  if (opts.last) state.last.set(key(5, 6), opts.last);
  const xml = (inner: string) => new Response(`<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${inner}</soap:Body></soap:Envelope>`, { headers: { 'Content-Type': 'text/xml' } });
  const f = async (url: string, init?: RequestInit) => {
    const body = String(init?.body ?? '');
    const action = String(new Headers(init?.headers).get('SOAPAction') ?? '').replace(/"/g, '');
    if (url.includes('LoginCms')) {
      state.calls.push('loginCms');
      if (state.mode.login === 'already') return xml('<soapenv:Fault><faultcode>ns1:coe.alreadyAuthenticated</faultcode><faultstring>El CEE ya posee un TA valido para el acceso al WSN solicitado</faultstring></soapenv:Fault>');
      state.logins++;
      const ta = `<?xml version="1.0" encoding="UTF-8"?><loginTicketResponse version="1.0"><header><expirationTime>2099-01-01T00:00:00.000-03:00</expirationTime></header><credentials><token>TOKEN${state.logins}</token><sign>SIGN${state.logins}</sign></credentials></loginTicketResponse>`;
      const esc = ta.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return xml(`<loginCmsResponse><loginCmsReturn>${esc}</loginCmsReturn></loginCmsResponse>`);
    }
    const op = action.split('/').pop()!;
    state.calls.push(op);
    if (op !== 'FEDummy' && state.mode.token600 && !body.includes('TOKEN2')) return xml(`<${op}Response><${op}Result><Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No validaron las firmas digitales</Msg></Err></Errors></${op}Result></${op}Response>`);
    const pv = Number(tag(body, 'PtoVta'));
    const t = Number(tag(body, 'CbteTipo'));
    if (op === 'FEDummy') return xml('<FEDummyResponse><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>');
    if (op === 'FECompUltimoAutorizado') return xml(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>${pv}</PtoVta><CbteTipo>${t}</CbteTipo><CbteNro>${state.last.get(key(pv, t)) ?? 0}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`);
    if (op === 'FECompConsultar') {
      const nro = Number(tag(body, 'CbteNro'));
      const d = state.docs.get(`${key(pv, t)}-${nro}`);
      if (!d) return xml('<FECompConsultarResponse><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>');
      return xml(`<FECompConsultarResponse><FECompConsultarResult><ResultGet><Concepto>1</Concepto><DocTipo>${d.docTipo}</DocTipo><DocNro>${d.docNro}</DocNro><CbteDesde>${d.nro}</CbteDesde><CbteHasta>${d.nro}</CbteHasta><CbteFch>${d.fecha}</CbteFch><ImpTotal>${d.impTotal}</ImpTotal><Resultado>A</Resultado><CodAutorizacion>${d.cae}</CodAutorizacion><EmisionTipo>CAE</EmisionTipo><FchVto>20991231</FchVto></ResultGet></FECompConsultarResult></FECompConsultarResponse>`);
    }
    if (op === 'FECAESolicitar') {
      state.lastBody = body;
      if (state.mode.solicitar === 'down') throw new TypeError('fetch failed'); // no llegó a ARCA
      if (state.mode.solicitar === 'infra') return xml('<FECAESolicitarResponse><FECAESolicitarResult><Errors><Err><Code>501</Code><Msg>Error interno de base de datos</Msg></Err></Errors></FECAESolicitarResult></FECAESolicitarResponse>');
      const nro = Number(tag(body, 'CbteDesde'));
      const last = state.last.get(key(pv, t)) ?? 0;
      const det = (res: string, extra: string) => xml(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Cuit>${CUIT}</Cuit><PtoVta>${pv}</PtoVta><CbteTipo>${t}</CbteTipo><Resultado>${res}</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>1</Concepto><CbteDesde>${nro}</CbteDesde><CbteHasta>${nro}</CbteHasta><Resultado>${res}</Resultado>${extra}</FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`);
      if (state.mode.solicitar === 'reject') return det('R', '<Observaciones><Obs><Code>10013</Code><Msg>Para comprobantes clase A el campo DocTipo debe ser 80 (CUIT)</Msg></Obs></Observaciones><CAE></CAE>');
      if (state.mode.solicitar === 'race') {
        state.last.set(key(pv, t), last + 1); // otro dispositivo lo usó justo antes
        return det('R', '<Observaciones><Obs><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar</Msg></Obs></Observaciones>');
      }
      if (nro !== last + 1) return det('R', '<Observaciones><Obs><Code>10016</Code><Msg>no correlativo</Msg></Obs></Observaciones>');
      const cae = String(++state.caeSeq);
      state.last.set(key(pv, t), nro);
      state.docs.set(`${key(pv, t)}-${nro}`, { nro, fecha: tag(body, 'CbteFch')!, docTipo: Number(tag(body, 'DocTipo')), docNro: tag(body, 'DocNro')!, impTotal: Number(tag(body, 'ImpTotal')), cae });
      if (state.mode.solicitar === 'drop') { state.mode.solicitar = ''; throw new TypeError('connection reset'); } // ARCA lo autorizó pero la respuesta se perdió
      return det('A', `<CAE>${cae}</CAE><CAEFchVto>20991231</CAEFchVto><CbteFch>${tag(body, 'CbteFch')}</CbteFch>`);
    }
    return new Response('?', { status: 404 });
  };
  return { f, state };
}

export const kv = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => (m.has(k) ? JSON.parse(m.get(k)!) : null), put: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } };
};
