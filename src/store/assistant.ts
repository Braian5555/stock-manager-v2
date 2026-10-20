import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { db } from '../database/db';
import { AssistantEngine, workerTransport, type ChatSnapshot, type EngineDeps, type Transport } from '../services/assistant/engine';
import { archiveChat, archiveKey, loadCurrent, saveCurrent, takeArchived } from '../services/assistant/chatStore';
import { logError } from '../services/diagnosticsService';
import { effectivePermissions } from '../services/userService';
import { localYmd } from '../utils/format';
import { useSession } from './session';
import { useSettings } from './settings';

/**
 * La conversación se guarda en el dispositivo: se puede ir a otra pantalla, cerrar la app y
 * volver sin perderla. "Nueva conversación" la pasa al historial. Cada usuario ve sólo las suyas.
 */
let engine: AssistantEngine | undefined;
let owner: string | undefined;
let unsubscribe: (() => void) | undefined;
/** Hasta que no se lee lo guardado, no se guarda nada (si no, una pantalla vacía lo pisaría). */
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();

function persist(userId: string, e: AssistantEngine) {
  if (!loaded || engine !== e) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const snap = e.snapshot();
    saving = saving.then(() => saveCurrent(userId, snap)).catch((err) => logError(err));
  }, 300);
}

function attach(userId: string, e: AssistantEngine) {
  unsubscribe?.();
  loaded = false;
  unsubscribe = e.subscribe(() => persist(userId, e));
  void loadCurrent(userId)
    .then((snap) => { if (snap && engine === e && !e.getState().messages.length) e.restore(snap); })
    .catch((err) => logError(err))
    .finally(() => { if (engine === e) loaded = true; });
}

/** Guarda lo pendiente ya (antes de archivar o retomar otra conversación). */
async function flush(userId: string, e: AssistantEngine) {
  clearTimeout(saveTimer);
  await saving;
  await saveCurrent(userId, e.snapshot());
}

/** Pasa la conversación actual al historial y empieza una nueva. */
export async function newConversation(): Promise<void> {
  const e = engine;
  const userId = owner;
  if (!e || !userId) return;
  const snap = e.snapshot();
  await archiveChat(userId, snap);
  e.reset();
  await flush(userId, e);
}

/** Retoma una conversación del historial (la actual pasa al historial). */
export async function openConversation(id: string): Promise<void> {
  const e = engine;
  const userId = owner;
  if (!e || !userId || e.getState().busy) return;
  const chosen = await takeArchived(userId, id);
  if (!chosen) return;
  await archiveChat(userId, e.snapshot());
  e.restore(chosen);
  await flush(userId, e);
}

/** Borra una conversación del historial. */
export async function deleteConversation(id: string): Promise<void> {
  if (owner) await takeArchived(owner, id);
}

/** Conversaciones anteriores del usuario (la más nueva primero). */
export function useAssistantHistory(): ChatSnapshot[] {
  const { user } = useSession();
  const rec = useLiveQuery(() => (user ? db.meta.get(archiveKey(user.id)) : undefined), [user?.id]);
  return Array.isArray(rec?.value) ? (rec.value as ChatSnapshot[]) : NO_CHATS;
}
const NO_CHATS: ChatSnapshot[] = [];

/** Las pruebas automáticas pueden reemplazar el envío a la IA. */
const testTransport = (): Transport | undefined => (globalThis as { __smAssistantTransport?: Transport }).__smAssistantTransport;

export function useAssistant() {
  const { user, can } = useSession();
  const settings = useSettings();
  const deps = useMemo<EngineDeps | undefined>(() => {
    if (!user) return undefined;
    const permissions = effectivePermissions(user);
    const url = settings.aiReaderUrl;
    return {
      user, can, permissions, settings,
      today: () => localYmd(),
      transport: (body) => {
        const t = testTransport() ?? (url ? workerTransport(url) : undefined);
        if (!t) return Promise.reject(new Error('Falta configurar la IA: Configuración → Lectura con IA.'));
        return t(body);
      },
    };
  }, [user, can, settings]);

  if (deps && user && (!engine || owner !== user.id)) {
    engine = new AssistantEngine(deps);
    owner = user.id;
    attach(user.id, engine);
  }
  useEffect(() => { if (deps && engine) engine.setDeps(deps); }, [deps]);

  const e = engine;
  const state = useSyncExternalStore(e?.subscribe ?? noopSubscribe, e?.getState ?? emptyState);
  return { engine: e, state };
}

const EMPTY = { messages: [], busy: false };
const noopSubscribe = () => () => {};
const emptyState = () => EMPTY;

/** true si el asistente se puede usar (hay servidor de IA configurado). */
export function useAssistantAvailable(): boolean {
  const settings = useSettings();
  return !!settings.aiReaderUrl || !!testTransport();
}
