import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AssistantEngine, workerTransport, type EngineDeps, type Transport } from '../services/assistant/engine';
import { effectivePermissions } from '../services/userService';
import { localYmd } from '../utils/format';
import { useSession } from './session';
import { useSettings } from './settings';

/**
 * La conversación vive mientras la app está abierta: se puede ir a otra pantalla y volver sin
 * perderla. Al cambiar de usuario empieza de cero (cada uno ve sólo la suya).
 */
let engine: AssistantEngine | undefined;
let owner: string | undefined;

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

  if (deps && (!engine || owner !== user?.id)) {
    engine = new AssistantEngine(deps);
    owner = user?.id;
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
