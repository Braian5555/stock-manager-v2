/**
 * Funciones en la nube de Stock Manager.
 *
 * readInvoice: lee la foto de una factura con Claude y devuelve sus renglones.
 * - La clave de Anthropic vive como secreto de Firebase (ANTHROPIC_API_KEY); nunca llega a la app.
 * - Sólo pueden usarla miembros del espacio de trabajo, con un cupo diario por espacio.
 *
 * Configurar una vez (plan Blaze):
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase deploy --only functions
 */
import Anthropic from '@anthropic-ai/sdk';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { buildRequest, MODEL, parseReading, validateInput } from './reader.mjs';

initializeApp();
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
/** Lecturas por espacio y por día (protege la cuenta ante un uso indebido). */
const DAILY_LIMIT = 150;

export const readInvoice = onCall(
  { region: 'southamerica-east1', secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 180, memory: '512MiB', maxInstances: 5 },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Iniciá sesión para leer facturas.');
    let input;
    try {
      input = validateInput(request.data);
    } catch (e) {
      throw new HttpsError('invalid-argument', e.message);
    }
    const db = getFirestore();
    const ws = await db.doc(`workspaces/${input.wsId}`).get();
    if (!ws.exists || !(ws.get('memberUids') ?? []).includes(request.auth.uid)) {
      throw new HttpsError('permission-denied', 'No sos miembro de este espacio de trabajo.');
    }
    const key = ANTHROPIC_API_KEY.value();
    if (!key) throw new HttpsError('failed-precondition', 'La lectura con IA no está activada: falta la clave de Anthropic.');

    // Cupo diario (fecha de Argentina).
    const day = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const usage = db.doc(`aiUsage/${input.wsId}_${day}`);
    await db.runTransaction(async (tx) => {
      const n = (await tx.get(usage)).get('count') ?? 0;
      if (n >= DAILY_LIMIT) throw new HttpsError('resource-exhausted', `Se alcanzó el máximo de ${DAILY_LIMIT} lecturas por día.`);
      tx.set(usage, { count: FieldValue.increment(1), wsId: input.wsId, day, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    const client = new Anthropic({ apiKey: key });
    let response;
    try {
      response = await client.messages.create(buildRequest(input.images, input.catalog));
    } catch (e) {
      const status = e?.status;
      console.error('Anthropic error', status, e?.message);
      if (status === 401 || status === 403) throw new HttpsError('failed-precondition', 'La clave de Anthropic no es válida o no tiene permiso.');
      if (status === 429 || status === 529) throw new HttpsError('unavailable', 'El servicio de IA está ocupado. Probá de nuevo en un minuto.');
      if (status === 400) throw new HttpsError('invalid-argument', 'La IA no pudo procesar estas fotos.');
      throw new HttpsError('internal', 'No se pudo leer la factura. Probá de nuevo.');
    }
    if (response.stop_reason === 'refusal') throw new HttpsError('invalid-argument', 'La IA no procesó estas fotos.');
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let reading;
    try {
      reading = parseReading(text, input.catalog.map((c) => c.ref));
    } catch (e) {
      throw new HttpsError('internal', e.message);
    }
    if (response.stop_reason === 'max_tokens') reading.warnings.push('La factura es muy larga: puede faltar algún renglón al final.');
    await usage.set({ inputTokens: FieldValue.increment(response.usage?.input_tokens ?? 0), outputTokens: FieldValue.increment(response.usage?.output_tokens ?? 0) }, { merge: true });
    return { ...reading, model: MODEL };
  },
);
