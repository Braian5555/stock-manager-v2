/**
 * Backend de nube EN MEMORIA, sólo para pruebas automáticas (provider "fake").
 * Simula Firebase: usuarios, espacios, colecciones y escuchas en tiempo real.
 * Expone `globalThis.__smFakeCloud` para que una prueba actúe como "otro dispositivo".
 */
import type { SyncTableName } from '../database/db';
import type { CloudBackend, CloudImage, CloudUser, RemoteChange, RemoteDoc, WatchInfo, Workspace } from './types';
import { nowIso, uuid } from '../utils/id';

type Listener = (changes: RemoteChange[], info: WatchInfo) => void;

export class FakeCloudStore {
  workspaces = new Map<string, Workspace>();
  data = new Map<string, Map<string, RemoteDoc>>();
  private listeners = new Map<string, Set<Listener>>();
  private wsListeners = new Map<string, Set<(ws: Workspace | null) => void>>();
  online = true;
  /** Cuentas de email y contraseña (sólo pruebas). */
  accounts = new Map<string, { uid: string; password: string; name: string; verified: boolean }>();
  private queue: { path: string; doc: RemoteDoc; resolve: () => void }[] = [];

  coll(path: string) {
    if (!this.data.has(path)) this.data.set(path, new Map());
    return this.data.get(path)!;
  }

  write(path: string, d: RemoteDoc): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ path, doc: structuredClone(d), resolve });
      this.flush();
    });
  }

  /** Simula pérdida/recuperación de conexión con el servidor. */
  setOnline(online: boolean) {
    this.online = online;
    this.flush();
    if (online) for (const [l, path] of this.unconfirmed) l([], { initial: false, serverIds: [...this.coll(path).keys()] });
    if (online) this.unconfirmed.clear();
  }
  /** Escuchas que arrancaron sin conexión: reciben la lista del "servidor" al volver. */
  private unconfirmed = new Map<Listener, string>();

  private flush() {
    if (!this.online) return;
    const q = this.queue.splice(0);
    for (const item of q) {
      this.coll(item.path).set(item.doc.id, item.doc);
      for (const l of this.listeners.get(item.path) ?? []) l([{ doc: structuredClone(item.doc), pending: false }], { initial: false });
      item.resolve();
    }
  }

  listen(path: string, l: Listener) {
    if (!this.listeners.has(path)) this.listeners.set(path, new Set());
    this.listeners.get(path)!.add(l);
    queueMicrotask(() => {
      const docs = [...this.coll(path).values()];
      if (!this.online) this.unconfirmed.set(l, path);
      l(docs.map((d) => ({ doc: structuredClone(d), pending: false })), { initial: true, serverIds: this.online ? docs.map((d) => d.id) : undefined });
    });
    return () => this.listeners.get(path)!.delete(l);
  }

  saveWorkspace(ws: Workspace) {
    this.workspaces.set(ws.id, structuredClone(ws));
    for (const l of this.wsListeners.get(ws.id) ?? []) l(structuredClone(ws));
  }

  listenWorkspace(id: string, l: (ws: Workspace | null) => void) {
    if (!this.wsListeners.has(id)) this.wsListeners.set(id, new Set());
    this.wsListeners.get(id)!.add(l);
    queueMicrotask(() => l(structuredClone(this.workspaces.get(id) ?? null)));
    return () => this.wsListeners.get(id)!.delete(l);
  }
}

export function fakeStore(): FakeCloudStore {
  const g = globalThis as unknown as { __smFakeCloud?: FakeCloudStore };
  g.__smFakeCloud ??= new FakeCloudStore();
  return g.__smFakeCloud;
}

export class FakeBackend implements CloudBackend {
  readonly kind = 'fake' as const;
  private user: CloudUser | null = null;
  private userListeners = new Set<(u: CloudUser | null) => void>();
  constructor(private store = fakeStore(), private identity: CloudUser = { uid: 'u-demo', email: 'demo@ejemplo.com', name: 'Usuario de prueba' }) {}

  onUser(cb: (u: CloudUser | null) => void) {
    this.userListeners.add(cb);
    queueMicrotask(() => cb(this.user));
    return () => this.userListeners.delete(cb);
  }
  private emit() {
    for (const l of this.userListeners) l(this.user);
  }
  async signIn() {
    this.user = this.identity;
    this.emit();
    return this.user;
  }
  async signInWithPassword(email: string, password: string) {
    const e = email.trim().toLowerCase();
    const acc = this.store.accounts.get(e);
    if (!acc || acc.password !== password) throw Object.assign(new Error('Credenciales inválidas'), { code: 'auth/invalid-credential' });
    this.user = { uid: acc.uid, email: e, name: acc.name || undefined, emailVerified: acc.verified };
    this.emit();
    return this.user;
  }
  async signUpWithPassword(email: string, password: string, name: string) {
    const e = email.trim().toLowerCase();
    if (this.store.accounts.has(e)) throw Object.assign(new Error('Ya existe'), { code: 'auth/email-already-in-use' });
    if (password.length < 6) throw Object.assign(new Error('Contraseña corta'), { code: 'auth/weak-password' });
    const acc = { uid: `u-${uuid()}`, password, name: name.trim(), verified: false };
    this.store.accounts.set(e, acc);
    this.user = { uid: acc.uid, email: e, name: acc.name || undefined, emailVerified: false };
    this.emit();
    return this.user;
  }
  async sendPasswordReset() {}
  async reloadUser() {
    if (!this.user) return null;
    const acc = this.store.accounts.get(this.user.email);
    if (acc) this.user = { ...this.user, emailVerified: acc.verified };
    this.emit();
    return this.user;
  }
  async resendVerification() {}
  async signOut() {
    this.user = null;
    this.emit();
  }
  async myWorkspaces(u: CloudUser) {
    return [...this.store.workspaces.values()].filter((w) => w.memberUids.includes(u.uid));
  }
  async myInvites(u: CloudUser) {
    return [...this.store.workspaces.values()].filter((w) => w.inviteEmails.includes(u.email));
  }
  async createWorkspace(u: CloudUser, name: string) {
    const ws: Workspace = { id: uuid(), name, ownerUid: u.uid, memberUids: [u.uid], roles: { [u.uid]: 'owner' }, memberInfo: { [u.uid]: { email: u.email, name: u.name } }, inviteEmails: [], createdAt: nowIso() };
    this.store.saveWorkspace(ws);
    return ws;
  }
  async joinWorkspace(u: CloudUser, ws: Workspace) {
    const cur = this.store.workspaces.get(ws.id);
    if (!cur || !cur.inviteEmails.includes(u.email)) throw new Error('No tenés una invitación para este espacio.');
    if (u.emailVerified === false) throw Object.assign(new Error('Email sin verificar'), { code: 'permission-denied' });
    this.store.saveWorkspace({
      ...cur,
      memberUids: [...cur.memberUids, u.uid],
      roles: { ...cur.roles, [u.uid]: 'member' },
      memberInfo: { ...cur.memberInfo, [u.uid]: { email: u.email, name: u.name } },
      inviteEmails: cur.inviteEmails.filter((e) => e !== u.email),
    });
  }
  async updateWorkspace(ws: Workspace, patch: Partial<Workspace>) {
    const cur = this.store.workspaces.get(ws.id);
    if (cur) this.store.saveWorkspace({ ...cur, ...patch });
  }
  watchWorkspace(id: string, cb: (ws: Workspace | null) => void) {
    return this.store.listenWorkspace(id, cb);
  }
  put(wsId: string, table: SyncTableName, d: RemoteDoc) {
    return this.store.write(`${wsId}/${table}`, d);
  }
  watch(wsId: string, table: SyncTableName, cb: Listener) {
    return this.store.listen(`${wsId}/${table}`, cb);
  }
  async putImage(wsId: string, img: CloudImage) {
    if (!this.store.online) throw new Error('Sin conexión');
    this.store.coll(`${wsId}/invoiceImages`).set(img.id, structuredClone(img) as unknown as RemoteDoc);
  }
  async getImage(wsId: string, id: string) {
    if (!this.store.online) throw new Error('Sin conexión');
    const d = this.store.coll(`${wsId}/invoiceImages`).get(id);
    return d ? (structuredClone(d) as unknown as CloudImage) : null;
  }
  async deleteImage(wsId: string, id: string) {
    this.store.coll(`${wsId}/invoiceImages`).delete(id);
  }
}
