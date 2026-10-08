/**
 * Servicio de nube: inicio de sesión (email y contraseña, o Google), espacios de trabajo compartidos,
 * invitaciones y sincronización. Si no hay configuración, la app sigue 100% local.
 */
import { useSyncExternalStore } from 'react';
import { db, SYNC_TABLES } from '../database/db';
import { createBackup } from '../services/backupService';
import { loadCloudConfig, type CloudConfig } from './config';
import { SyncEngine, type SyncStatus } from './syncEngine';
import type { CloudBackend, CloudImage, CloudUser, Workspace, WorkspaceRole } from './types';

const LINK_KEY = 'cloud.link';
const PRE_JOIN_BACKUP_KEY = 'cloud.preJoinBackup';

interface Link {
  wsId: string;
  uid: string;
}

export interface CloudState {
  phase: 'loading' | 'unconfigured' | 'signed_out' | 'no_workspace' | 'linked';
  provider?: 'firebase' | 'fake';
  user?: CloudUser;
  workspace?: Workspace;
  myWorkspaces: Workspace[];
  invites: Workspace[];
  status: SyncStatus;
  error?: string;
}

let state: CloudState = { phase: 'loading', myWorkspaces: [], invites: [], status: { state: 'idle', pending: 0 } };
const listeners = new Set<() => void>();
let backend: CloudBackend | null = null;
let engine: SyncEngine | null = null;
let currentWsId = '';
let stopWatchWs: (() => void) | null = null;
let started = false;

function set(patch: Partial<CloudState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

async function getLink(): Promise<Link | undefined> {
  return (await db.meta.get(LINK_KEY))?.value as Link | undefined;
}

async function createBackend(cfg: CloudConfig): Promise<CloudBackend | null> {
  if (cfg.provider === 'firebase') {
    const { FirebaseBackend } = await import('./firebaseBackend');
    return new FirebaseBackend(cfg.firebase);
  }
  if (cfg.provider === 'fake') {
    const { FakeBackend } = await import('./fakeBackend');
    return new FakeBackend();
  }
  return null;
}

/** Se llama una vez al abrir la app. No bloquea el uso local. */
export async function initCloud() {
  if (started) return;
  started = true;
  try {
    backend = await createBackend(await loadCloudConfig());
  } catch (e) {
    set({ phase: 'unconfigured', error: friendly(e) });
    return;
  }
  if (!backend) return set({ phase: 'unconfigured' });
  set({ provider: backend.kind });
  backend.onUser((user) => void onUser(user));
}

async function onUser(user: CloudUser | null) {
  if (!user) {
    stopEngine();
    return set({ phase: 'signed_out', user: undefined, workspace: undefined, myWorkspaces: [], invites: [] });
  }
  set({ user });
  const link = await getLink();
  if (link && link.uid === user.uid) {
    await startEngine(link.wsId);
    void refreshLists();
    return;
  }
  set({ phase: 'no_workspace' });
  if (link) {
    // Dispositivo compartido: otra persona del mismo espacio inicia sesión → se sigue con
    // los mismos datos, sin volver a descargarlos.
    await refreshLists();
    if (state.myWorkspaces.some((w) => w.id === link.wsId)) {
      await db.meta.put({ key: LINK_KEY, value: { wsId: link.wsId, uid: user.uid } satisfies Link });
      await startEngine(link.wsId);
      return;
    }
  }
  await refreshLists();
  await autoOpen();
}

/**
 * Dispositivo nuevo (sin usuarios locales): si la cuenta tiene un solo espacio, o una sola
 * invitación, se abre solo y se descargan los datos. No hay nada local que se pueda perder.
 */
async function autoOpen() {
  if (state.phase !== 'no_workspace' || (await db.users.count()) > 0) return;
  const { myWorkspaces, invites } = state;
  const only = myWorkspaces.length === 1 ? myWorkspaces[0] : myWorkspaces.length === 0 && invites.length === 1 ? invites[0] : undefined;
  if (!only) return;
  try {
    await openWorkspace(only);
  } catch (e) {
    set({ error: friendly(e) });
  }
}

export async function refreshLists() {
  if (!backend || !state.user) return;
  try {
    const [myWorkspaces, invites] = await Promise.all([backend.myWorkspaces(state.user), backend.myInvites(state.user)]);
    set({ myWorkspaces, invites, error: undefined });
  } catch (e) {
    set({ error: friendly(e) });
  }
}

async function startEngine(wsId: string, opts: { pushAll?: boolean } = {}) {
  if (!backend) return;
  stopEngine();
  engine = new SyncEngine(backend, wsId);
  currentWsId = wsId;
  engine.onStatus((status) => set({ status }));
  stopWatchWs = backend.watchWorkspace(wsId, (ws) => {
    if (ws) set({ workspace: ws, phase: 'linked' });
    else if (state.phase === 'linked') set({ error: 'No se pudo leer el espacio de trabajo (¿te quitaron el acceso?).' });
  });
  set({ phase: 'linked' });
  await engine.start(opts);
  void uploadPendingImages();
}

// ───────────── Fotos de facturas ─────────────
// Van aparte de la sincronización general: se suben al guardarlas y se bajan sólo al abrirlas.

let uploading = false;
const activeWs = () => (backend && state.phase === 'linked' && engine ? { backend, wsId: currentWsId } : null);

/** Sube las fotos que quedaron pendientes (sin conexión, o creadas antes de vincular la nube). */
export async function uploadPendingImages(): Promise<void> {
  const c = activeWs();
  if (!c || uploading) return;
  uploading = true;
  try {
    for (const img of await db.invoiceImages.where('uploaded').equals(0).toArray()) {
      await c.backend.putImage(c.wsId, { id: img.id, invoiceId: img.invoiceId, type: img.type, data: img.data });
      await db.invoiceImages.update(img.id, { uploaded: 1 });
    }
  } catch {
    // Sin conexión: se reintenta al volver la conexión o al abrir la app.
  } finally {
    uploading = false;
  }
}

/** Trae una foto de la nube (null si no hay nube vinculada o la foto no existe). */
export async function fetchCloudImage(id: string): Promise<CloudImage | null> {
  const c = activeWs();
  if (!c) return null;
  return c.backend.getImage(c.wsId, id);
}

export async function deleteCloudImages(ids: string[]): Promise<void> {
  const c = activeWs();
  if (!c) return;
  await Promise.all(ids.map((id) => c.backend.deleteImage(c.wsId, id).catch(() => undefined)));
}

if (typeof window !== 'undefined') window.addEventListener('online', () => void uploadPendingImages());

function stopEngine() {
  engine?.stop();
  engine = null;
  stopWatchWs?.();
  stopWatchWs = null;
}

function requireUser(): CloudUser {
  if (!backend || !state.user) throw new Error('Iniciá sesión primero.');
  return state.user;
}

export async function signIn() {
  if (!backend) throw new Error('La sincronización con Google no está configurada.');
  try {
    await backend.signIn();
  } catch (e) {
    throw new Error(friendly(e), { cause: e });
  }
}

function requireBackend(): CloudBackend {
  if (!backend) throw new Error('La nube no está configurada.');
  return backend;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signInWithPassword(email: string, password: string) {
  if (!EMAIL_RE.test(email.trim())) throw new Error('Ingresá un email válido.');
  if (!password) throw new Error('Ingresá tu contraseña.');
  try {
    await requireBackend().signInWithPassword(email, password);
  } catch (e) {
    throw new Error(friendly(e), { cause: e });
  }
}

export async function signUpWithPassword(email: string, password: string, name: string) {
  if (!name.trim()) throw new Error('Ingresá tu nombre.');
  if (!EMAIL_RE.test(email.trim())) throw new Error('Ingresá un email válido.');
  if (password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  try {
    await requireBackend().signUpWithPassword(email, password, name);
  } catch (e) {
    throw new Error(friendly(e), { cause: e });
  }
}

export async function sendPasswordReset(email: string) {
  if (!EMAIL_RE.test(email.trim())) throw new Error('Escribí tu email arriba y volvé a tocar “Olvidé mi contraseña”.');
  try {
    await requireBackend().sendPasswordReset(email);
  } catch (e) {
    throw new Error(friendly(e), { cause: e });
  }
}

/** Después de tocar el link del email de verificación. */
export async function recheckVerification() {
  const user = await requireBackend().reloadUser();
  if (!user) return;
  set({ user });
  if (!user.emailVerified) throw new Error('Todavía no figura verificado. Tocá el link del email que te llegó (revisá también spam).');
  await refreshLists();
  await autoOpen();
}

export async function resendVerification() {
  await requireBackend().resendVerification();
}

/** Cierra la sesión. Los datos quedan en este dispositivo. */
export async function signOutCloud() {
  stopEngine();
  await backend?.signOut();
}

/** Crea un espacio nuevo y sube los datos actuales de este dispositivo. */
export async function createWorkspace(name: string) {
  const user = requireUser();
  const ws = await backend!.createWorkspace(user, name.trim() || 'Mi negocio');
  await db.meta.put({ key: LINK_KEY, value: { wsId: ws.id, uid: user.uid } satisfies Link });
  set({ workspace: ws });
  await startEngine(ws.id, { pushAll: true });
  void refreshLists();
}

/**
 * Usa en este dispositivo un espacio existente (propio o por invitación).
 * Los datos locales se REEMPLAZAN por los de la nube (se guarda una copia de seguridad local).
 */
export async function openWorkspace(ws: Workspace) {
  const user = requireUser();
  if (!ws.memberUids.includes(user.uid)) await backend!.joinWorkspace(user, ws);
  await db.meta.put({ key: PRE_JOIN_BACKUP_KEY, value: await createBackup() });
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t)), db.invoiceImages], async () => {
    for (const t of SYNC_TABLES) await db.table(t).clear();
    await db.invoiceImages.clear();
  });
  await db.meta.put({ key: LINK_KEY, value: { wsId: ws.id, uid: user.uid } satisfies Link });
  await startEngine(ws.id);
  void refreshLists();
}

/** Deja de sincronizar este dispositivo. No borra nada (ni local ni en la nube). */
export async function unlinkDevice() {
  stopEngine();
  await db.meta.delete(LINK_KEY);
  set({ phase: state.user ? 'no_workspace' : 'signed_out', workspace: undefined, status: { state: 'idle', pending: 0 } });
  void refreshLists();
}

const canManage = () => !!state.user && !!state.workspace && ['owner', 'admin'].includes(state.workspace.roles[state.user.uid] ?? '');

export async function inviteEmail(email: string) {
  const ws = state.workspace;
  const e = email.trim().toLowerCase();
  if (!ws || !canManage()) throw new Error('Sólo el dueño o un administrador puede invitar.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new Error('El email no es válido.');
  if (Object.values(ws.memberInfo).some((m) => m.email === e)) throw new Error('Esa persona ya es miembro.');
  await backend!.updateWorkspace(ws, { inviteEmails: [...new Set([...ws.inviteEmails, e])] });
}

export async function cancelInvite(email: string) {
  const ws = state.workspace;
  if (!ws || !canManage()) return;
  await backend!.updateWorkspace(ws, { inviteEmails: ws.inviteEmails.filter((x) => x !== email) });
}

export async function removeMember(uid: string) {
  const ws = state.workspace;
  if (!ws || !canManage()) throw new Error('Sólo el dueño o un administrador puede quitar miembros.');
  if (uid === ws.ownerUid) throw new Error('No se puede quitar al dueño del espacio.');
  const roles = { ...ws.roles };
  delete roles[uid];
  const memberInfo = { ...ws.memberInfo };
  delete memberInfo[uid];
  await backend!.updateWorkspace(ws, { memberUids: ws.memberUids.filter((x) => x !== uid), roles, memberInfo });
}

export async function setMemberRole(uid: string, role: Exclude<WorkspaceRole, 'owner'>) {
  const ws = state.workspace;
  if (!ws || !canManage() || uid === ws.ownerUid) return;
  await backend!.updateWorkspace(ws, { roles: { ...ws.roles, [uid]: role } });
}

export const ROLE_LABEL: Record<WorkspaceRole, string> = { owner: 'Dueño', admin: 'Administrador', member: 'Miembro' };

/** Mensajes comprensibles para errores de Google/Firebase. */
export function friendly(e: unknown): string {
  const code = (e as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/popup-closed-by-user': 'Se cerró la ventana de Google antes de terminar.',
    'auth/cancelled-popup-request': 'Se canceló el inicio de sesión.',
    'auth/unauthorized-domain': 'Este sitio no está autorizado en Firebase. Agregá el dominio en Authentication → Settings → Authorized domains.',
    'auth/network-request-failed': 'Sin conexión. Probá de nuevo cuando tengas Internet.',
    'auth/operation-not-allowed': 'Ese método de inicio de sesión no está activado en Firebase (Authentication → Sign-in method).',
    'auth/invalid-credential': 'Email o contraseña incorrectos.',
    'auth/wrong-password': 'Email o contraseña incorrectos.',
    'auth/user-not-found': 'Email o contraseña incorrectos.',
    'auth/invalid-email': 'El email no es válido.',
    'auth/email-already-in-use': 'Ya existe una cuenta con ese email. Tocá “Ya tengo cuenta” para entrar.',
    'auth/weak-password': 'La contraseña es muy débil: usá al menos 6 caracteres.',
    'auth/too-many-requests': 'Demasiados intentos. Esperá unos minutos o restablecé la contraseña.',
    'auth/user-disabled': 'Esta cuenta está desactivada.',
    'permission-denied': state.user?.emailVerified === false
      ? 'Primero verificá tu email: tocá el link que te llegó y después “Ya verifiqué mi email”.'
      : 'No tenés permiso para esta acción (revisá las reglas de Firestore o tu invitación).',
    unavailable: 'Sin conexión con la nube. Los cambios se guardan y se envían al volver.',
  };
  if (map[code]) return map[code];
  return e instanceof Error ? e.message : 'Ocurrió un error con la nube.';
}
