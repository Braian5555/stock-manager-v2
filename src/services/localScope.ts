/**
 * Locales (sucursales): cada local tiene sus mesas, carta, ventas, caja y comprobantes, como cada
 * instalación de Maxirest, pero en un solo sistema. Este módulo sabe en qué local trabaja ESTE equipo
 * y separa los datos:
 *
 * - El local del equipo se guarda en el dispositivo (cada compu de caja es de un local).
 * - Lo que se crea en las tablas del Salón queda marcado con ese local (outletId) automáticamente.
 * - Las pantallas filtran con inLocal(): sólo ven lo de su local. Lo creado antes de tener locales
 *   (sin outletId) es del "local de antes" (settings.defaultOutletId, o el primero que se creó).
 * - Sin locales cargados, todo funciona como siempre (un solo local).
 */
import { liveQuery } from 'dexie';
import { useSyncExternalStore } from 'react';
import { db, remoteTransactions } from '../database/db';
import type { ID, Outlet } from '../models';

const KEY = 'orillas:local';
/** Tablas que se separan por local. */
export const LOCAL_TABLES = ['diningTables', 'menuItems', 'tickets', 'cashSessions', 'cashMovements', 'fiscalDocs'] as const;

interface ScopeState { outlets: Outlet[]; deviceId?: ID; defaultId?: ID; current?: Outlet }
let state: ScopeState = { outlets: [], deviceId: readDevice() };
const listeners = new Set<() => void>();

function readDevice(): ID | undefined {
  try { return localStorage.getItem(KEY) ?? undefined; } catch { return undefined; }
}

let all: Outlet[] = [];
let defSetting: ID | undefined;
function recompute(outlets: Outlet[] = all, defaultSetting: ID | undefined = defSetting) {
  all = outlets;
  defSetting = defaultSetting;
  const active = outlets.filter((o) => o.active).sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es'));
  const oldest = [...outlets].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const defaultId = (defaultSetting && outlets.some((o) => o.id === defaultSetting) ? defaultSetting : oldest?.id);
  const current = state.deviceId ? active.find((o) => o.id === state.deviceId) : undefined;
  state = { outlets: active, deviceId: state.deviceId, defaultId, current };
  for (const l of listeners) l();
}

let started = false;
/** Empieza a seguir los locales (se llama al iniciar la app). */
export function startLocalScope() {
  if (started) return;
  started = true;
  installLocalHooks();
  liveQuery(async () => ({ outlets: await db.outlets.toArray(), def: (await db.settings.get('app'))?.defaultOutletId }))
    .subscribe({ next: ({ outlets, def }) => recompute(outlets, def), error: () => undefined });
}

let hooked = false;
/** Lo nuevo de las tablas del Salón queda en el local del equipo (lo que llega de la nube, no). */
export function installLocalHooks() {
  if (hooked) return;
  hooked = true;
  for (const t of LOCAL_TABLES) {
    db.table(t).hook('creating', (_pk, obj: { outletId?: ID }, trans) => {
      const idb = (trans as unknown as { idbtrans?: IDBTransaction }).idbtrans;
      if (idb && remoteTransactions.has(idb)) return;
      if (obj.outletId === undefined && state.current) obj.outletId = state.current.id;
    });
  }
}

/** Local del equipo (undefined: sin locales o todavía sin elegir). */
export const currentOutlet = (): Outlet | undefined => state.current;
export const currentOutletId = (): ID | undefined => state.current?.id;
/** Hay locales cargados: el equipo tiene que trabajar en uno. */
export const hasLocals = (): boolean => state.outlets.length > 0;

/** ¿Este registro es del local del equipo? (sin locales: todo). */
export function inLocal(r: { outletId?: ID }): boolean {
  if (!state.current) return true;
  return (r.outletId ?? state.defaultId) === state.current.id;
}

/** Elige el local de este equipo. */
export function setDeviceLocal(id: ID | undefined) {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  state = { ...state, deviceId: id };
  recompute();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;
/** Para las pantallas: el local actual y la lista; cambia cuando se elige otro local. */
export function useLocalScope() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Para pruebas: vuelve a leer el local del dispositivo. */
export function resetLocalScopeForTests() {
  state = { outlets: [], deviceId: readDevice() };
  all = [];
  defSetting = undefined;
}

/** Para pruebas: aplica ya los locales de la base (sin esperar a la consulta en vivo). */
export async function refreshLocalScope() {
  recompute(await db.outlets.toArray(), (await db.settings.get('app'))?.defaultOutletId);
}
