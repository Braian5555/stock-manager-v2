/**
 * Sesión del usuario de la app.
 *
 * Dispositivo vinculado a la nube: se entra con la cuenta (email y contraseña). El usuario
 * de la app es el que tiene ese email; si no existe se crea solo (dueño/administrador del
 * espacio → Administrador; resto → Empleado). La sesión queda abierta hasta "Cerrar sesión",
 * también sin Internet.
 *
 * Dispositivo sin nube (modo local, nombre + PIN):
 * - Sin usuarios creados → si la nube está configurada, primero se ofrece iniciar sesión;
 *   si no, pantalla para crear el administrador.
 * - Con usuarios → pantalla de bloqueo hasta ingresar el PIN.
 * - La sesión sobrevive a recargas y cierres de la app; se bloquea por inactividad
 *   (Configuración → autoLockMinutes) o con "Bloquear".
 * - Bloqueo progresivo tras PIN incorrectos.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CLOUD_LINK_KEY, db } from '../database/db';
import type { AppUser, Permission } from '../models';
import { effectivePermissions, randomPin, saveUser, setCurrentActor, verifyPin } from '../services/userService';
import { signOutCloud, useCloud, type CloudState } from '../cloud/cloudService';
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

export type SessionStatus =
  | 'loading'
  | 'setup'
  | 'locked'
  | 'unlocked'
  /** Hay que iniciar sesión en la nube (email y contraseña). */
  | 'cloud_login'
  /** Sesión iniciada pero falta elegir/crear el espacio (o verificar el email). */
  | 'cloud_workspace'
  /** La cuenta corresponde a un usuario desactivado. */
  | 'cloud_disabled';

interface SessionApi {
  status: SessionStatus;
  /** Texto para la pantalla de carga (p. ej. "Descargando tus datos…"). */
  loadingText?: string;
  /** true si la sesión la da la cuenta de la nube (no hay PIN). */
  cloudMode: boolean;
  user?: AppUser;
  users: AppUser[];
  can: (p: Permission) => boolean;
  canAny: (ps: Permission[]) => boolean;
  login: (userId: string, pin: string) => Promise<void>;
  lock: () => Promise<void>;
  createFirstAdmin: (name: string, pin: string) => Promise<void>;
  /** Dispositivo nuevo: usar sin nube (crear administrador con PIN). */
  useLocalOnly: () => void;
}


/** Estado de la sesión de un dispositivo vinculado a la nube. */
function cloudStatus(cloud: CloudState, users: AppUser[]): { status: SessionStatus; user?: AppUser; provision?: boolean; text?: string } {
  if (cloud.phase === 'loading') return { status: 'loading' };
  if (cloud.phase === 'signed_out' || cloud.phase === 'unconfigured') return { status: 'cloud_login' };
  if (cloud.phase === 'no_workspace' || !cloud.user) return { status: 'cloud_workspace' };
  const email = cloud.user.email;
  const mine = users.find((u) => u.email === email);
  if (mine) return mine.active ? { status: 'unlocked', user: mine } : { status: 'cloud_disabled' };
  // Esperar la primera descarga antes de decidir que hay que crear el usuario.
  if (!cloud.initialSynced || !cloud.workspace) return { status: 'loading', text: 'Descargando tus datos…' };
  return { status: 'loading', provision: true, text: 'Preparando tu usuario…' };
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
  // null = dispositivo no vinculado a la nube.
  const link = useLiveQuery(async () => (await db.meta.get(CLOUD_LINK_KEY))?.value ?? null, []);
  const cloud = useCloud();
  const [localOnly, setLocalOnly] = useState(false);
  const lastActive = useRef(Date.now());

  const cloudMode = !!link;
  let user: AppUser | undefined;
  let status: SessionStatus = 'loading';
  let loadingText: string | undefined;
  let provision = false;
  if (users !== undefined && stored !== undefined && link !== undefined) {
    if (cloudMode) {
      const c = cloudStatus(cloud, users);
      ({ status, user } = c);
      loadingText = c.text;
      provision = !!c.provision;
    } else if (users.length === 0) {
      const cloudAvailable = !localOnly && cloud.phase !== 'unconfigured';
      if (!cloudAvailable) status = 'setup';
      else if (cloud.phase === 'loading') status = 'loading';
      else status = cloud.phase === 'signed_out' ? 'cloud_login' : 'cloud_workspace';
    } else {
      user = stored ? users.find((u) => u.id === stored.userId && u.active) : undefined;
      const expired = !!stored && settings.autoLockMinutes > 0 && Date.now() - stored.lastActive > settings.autoLockMinutes * 60_000;
      status = user && !expired ? 'unlocked' : 'locked';
    }
  }

  // Primera vez que esta cuenta entra al espacio: se crea (o se asocia) su usuario de la app.
  const provisioning = useRef(false);
  useEffect(() => {
    if (!provision || provisioning.current || !cloud.user || !cloud.workspace || !users) return;
    provisioning.current = true;
    const { uid, email, name } = cloud.user;
    const role = cloud.workspace.roles[uid];
    const manager = role === 'owner' || role === 'admin';
    // El dueño se asocia al administrador que ya existía (creado antes con PIN), si hay uno sin email.
    const legacyAdmin = manager ? users.find((u) => u.active && u.role === 'admin' && !u.email) : undefined;
    const base = name?.trim() || email.split('@')[0];
    const taken = new Set(users.map((u) => u.name.toLocaleLowerCase('es')));
    let display = base;
    for (let i = 2; taken.has(display.toLocaleLowerCase('es')); i++) display = `${base} (${i})`;
    const job = legacyAdmin
      ? saveUser({ id: legacyAdmin.id, name: legacyAdmin.name, role: legacyAdmin.role, permissions: legacyAdmin.permissions, active: true, email })
      : saveUser({ name: display, role: manager ? 'admin' : 'staff', permissions: [], active: true, pin: randomPin(), email });
    job.catch((e: unknown) => console.warn('No se pudo crear el usuario de la nube', e)).finally(() => {
      provisioning.current = false;
    });
  }, [provision, cloud.user, cloud.workspace, users]);

  useEffect(() => {
    setCurrentActor(status === 'unlocked' && user ? { id: user.id, name: user.name } : undefined);
  }, [status, user]);

  const lock = useCallback(async () => {
    await db.meta.delete(SESSION_KEY);
    // Con la nube, "salir" es cerrar la sesión de la cuenta (los datos quedan en el dispositivo).
    if (cloudMode) await signOutCloud();
  }, [cloudMode]);

  // Inactividad: se registra la última interacción y se guarda cada tanto.
  useEffect(() => {
    if (status !== 'unlocked' || !user || cloudMode) return;
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
  }, [status, user, settings.autoLockMinutes, lock, cloudMode]);

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
      loadingText,
      cloudMode,
      user: status === 'unlocked' ? user : undefined,
      users: users ?? [],
      can: (p) => perms.has(p),
      canAny: (ps) => ps.some((p) => perms.has(p)),
      login,
      lock,
      createFirstAdmin,
      useLocalOnly: () => setLocalOnly(true),
    };
  }, [status, loadingText, cloudMode, user, users, login, lock, createFirstAdmin]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession fuera de SessionProvider');
  return v;
}
