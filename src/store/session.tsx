/**
 * Sesión del usuario de la app (nombre + PIN).
 * - Sin usuarios creados → pantalla para crear el administrador.
 * - Con usuarios → pantalla de bloqueo hasta ingresar el PIN.
 * - La sesión sobrevive a recargas y cierres de la app; se bloquea por inactividad
 *   (Configuración → autoLockMinutes) o con "Bloquear".
 * - Bloqueo progresivo tras PIN incorrectos.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLOUD_LINK_KEY, db } from '../database/db';
import { useCloud } from '../cloud/cloudService';
import type { AppUser, Permission } from '../models';
import { effectivePermissions, saveUser, setCurrentActor, verifyPin } from '../services/userService';
import { useSettings } from './settings';

const SESSION_KEY = 'session';
const LOCKOUT_KEY = 'pinLockout';
let loginQueue: Promise<unknown> = Promise.resolve();

interface StoredSession {
  userId: string;
  lastActive: number;
}
interface Lockout {
  failures: number;
  until: number;
}

/** waiting: el dispositivo está vinculado a la nube y todavía no llegaron los usuarios. */
export type SessionStatus = 'loading' | 'waiting' | 'setup' | 'locked' | 'unlocked';

interface SessionApi {
  status: SessionStatus;
  user?: AppUser;
  users: AppUser[];
  can: (p: Permission) => boolean;
  canAny: (ps: Permission[]) => boolean;
  login: (userId: string, pin: string) => Promise<void>;
  lock: () => Promise<void>;
  createFirstAdmin: (name: string, pin: string) => Promise<void>;
  /** Deja de esperar a la nube y permite crear un administrador local. */
  skipCloudWait: () => void;
}

const Ctx = createContext<SessionApi | null>(null);

/** Espera progresiva: 5 errores → 30 s, luego se duplica (máx. 15 min). */
export function lockoutDelay(failures: number): number {
  if (failures < 5) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (failures - 5));
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const settings = useSettings();
  const users = useLiveQuery(() => db.users.toArray(), []);
  // null = no hay sesión guardada; undefined = todavía cargando.
  const stored = useLiveQuery(async () => ((await db.meta.get(SESSION_KEY))?.value as StoredSession | undefined) ?? null, []);
  const lastActive = useRef(Date.now());

  const user = users && stored ? users.find((u) => u.id === stored.userId && u.active) : undefined;
  const expired = !!stored && settings.autoLockMinutes > 0 && Date.now() - stored.lastActive > settings.autoLockMinutes * 60_000;

  // Vinculado a la nube y sin usuarios: se espera la primera sincronización antes de ofrecer
  // "Crear administrador" (si no, cualquiera podría crear un administrador en ese hueco).
  const linked = useLiveQuery(async () => !!(await db.meta.get(CLOUD_LINK_KEY)), []);
  const cloud = useCloud();
  const [skipWait, setSkipWait] = useState(false);

  let status: SessionStatus = 'loading';
  if (users !== undefined && stored !== undefined && linked !== undefined) {
    if (users.length === 0) status = linked && !skipWait && !cloud.initialSynced ? 'waiting' : 'setup';
    else status = user && !expired ? 'unlocked' : 'locked';
  }

  useEffect(() => {
    setCurrentActor(status === 'unlocked' && user ? { id: user.id, name: user.name } : undefined);
  }, [status, user]);

  const lock = useCallback(async () => {
    await db.meta.delete(SESSION_KEY);
  }, []);

  // Inactividad: se registra la última interacción y se guarda cada tanto.
  useEffect(() => {
    if (status !== 'unlocked' || !user) return;
    const touch = () => {
      lastActive.current = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const timer = setInterval(() => {
      const idle = Date.now() - lastActive.current;
      if (settings.autoLockMinutes > 0 && idle > settings.autoLockMinutes * 60_000) void lock();
      else void db.meta.put({ key: SESSION_KEY, value: { userId: user.id, lastActive: lastActive.current } satisfies StoredSession });
    }, 20_000);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void db.meta.put({ key: SESSION_KEY, value: { userId: user.id, lastActive: lastActive.current } });
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      events.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [status, user, settings.autoLockMinutes, lock]);

  const login = useCallback((userId: string, pin: string) => {
    // Los intentos se procesan de a uno (si no, varios intentos en paralelo leerían el mismo contador).
    const attempt = loginQueue.then(() => tryLogin(userId, pin));
    loginQueue = attempt.catch(() => undefined);
    return attempt;
  }, []);

  const tryLogin = async (userId: string, pin: string) => {
    // Contador por usuario: entrar con el PIN propio no reinicia los intentos fallidos contra otro usuario.
    const key = `${LOCKOUT_KEY}:${userId}`;
    const lo = ((await db.meta.get(key))?.value as Lockout | undefined) ?? { failures: 0, until: 0 };
    if (lo.until > Date.now()) throw new Error(`Demasiados intentos. Esperá ${Math.ceil((lo.until - Date.now()) / 1000)} segundos.`);
    const u = await db.users.get(userId);
    if (!u || !u.active) throw new Error('El usuario no existe o está desactivado.');
    if (!(await verifyPin(u, pin))) {
      const failures = lo.failures + 1;
      await db.meta.put({ key, value: { failures, until: Date.now() + lockoutDelay(failures) } satisfies Lockout });
      throw new Error(failures >= 5 ? `PIN incorrecto. Esperá ${Math.round(lockoutDelay(failures) / 1000)} segundos para volver a intentar.` : 'PIN incorrecto.');
    }
    await db.meta.delete(key);
    lastActive.current = Date.now();
    await db.meta.put({ key: SESSION_KEY, value: { userId, lastActive: Date.now() } satisfies StoredSession });
  };

  const createFirstAdmin = useCallback(
    async (name: string, pin: string) => {
      if ((await db.users.count()) > 0) throw new Error('Ya hay usuarios creados.');
      const u = await saveUser({ name, pin, role: 'admin', permissions: [], active: true });
      await login(u.id, pin);
    },
    [login],
  );

  const api = useMemo<SessionApi>(() => {
    const perms = new Set(status === 'unlocked' && user ? effectivePermissions(user) : []);
    return {
      status,
      user: status === 'unlocked' ? user : undefined,
      users: users ?? [],
      can: (p) => perms.has(p),
      canAny: (ps) => ps.some((p) => perms.has(p)),
      login,
      lock,
      createFirstAdmin,
      skipCloudWait: () => setSkipWait(true),
    };
  }, [status, user, users, login, lock, createFirstAdmin]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fuera de SessionProvider');
  return v;
}
