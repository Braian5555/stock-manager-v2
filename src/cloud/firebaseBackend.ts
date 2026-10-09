/**
 * Backend real: Firebase Authentication (email y contraseña, o Google) + Cloud Firestore.
 *
 * Estructura en Firestore:
 *   workspaces/{wsId}                  → nombre, miembros, roles, invitaciones
 *   workspaces/{wsId}/{tabla}/{id}     → registros (productos, movimientos, …) o lápidas {_deleted:true}
 *
 * Las reglas de seguridad (firestore.rules) garantizan que sólo los miembros lean o
 * escriban los datos de su espacio. Firestore guarda una copia local y una cola de
 * escrituras: la app funciona sin conexión y sincroniza al volver.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  GoogleAuthProvider, browserLocalPersistence, browserPopupRedirectResolver, createUserWithEmailAndPassword, indexedDBLocalPersistence,
  initializeAuth, onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup,
  signInWithRedirect, signOut, updateProfile, type Auth, type User,
} from 'firebase/auth';
import {
  arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, initializeFirestore, onSnapshot, persistentLocalCache, persistentMultipleTabManager,
  query, setDoc, updateDoc, where, writeBatch, type Firestore,
} from 'firebase/firestore';
import { SYNC_TABLES, type SyncTableName } from '../database/db';
import { effectiveAuthDomain, sameOriginAuth, type FirebaseWebConfig } from './config';
import type { CloudBackend, CloudImage, CloudUser, RemoteChange, RemoteDoc, WatchInfo, Workspace } from './types';
import { nowIso, uuid } from '../utils/id';

const toUser = (u: User): CloudUser => ({
  uid: u.uid,
  email: (u.email ?? '').toLowerCase(),
  name: u.displayName ?? undefined,
  photoURL: u.photoURL ?? undefined,
  emailVerified: u.emailVerified,
});

export class FirebaseBackend implements CloudBackend {
  readonly kind = 'firebase' as const;
  private app: FirebaseApp;
  private auth: Auth;
  private fs: Firestore;

  private preferRedirect: boolean;

  constructor(config: FirebaseWebConfig) {
    this.app = initializeApp({ ...config, authDomain: effectiveAuthDomain(config) });
    // En iPhone/iPad (sobre todo con la app instalada) la ventana emergente no puede
    // devolver la sesión. Si el inicio de sesión está en el mismo dominio, se usa redirección.
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    this.preferRedirect = sameOriginAuth(config) && (ios || standalone);
    this.auth = initializeAuth(this.app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
    this.fs = initializeFirestore(this.app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    });
  }

  onUser(cb: (user: CloudUser | null) => void) {
    return onAuthStateChanged(this.auth, (u) => cb(u ? toUser(u) : null));
  }

  async signIn(): Promise<CloudUser> {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    if (this.preferRedirect) {
      await signInWithRedirect(this.auth, provider);
      return new Promise(() => undefined); // la página se redirige y vuelve con la sesión iniciada
    }
    try {
      return toUser((await signInWithPopup(this.auth, provider)).user);
    } catch (e) {
      const code = (e as { code?: string }).code;
      // Algunos navegadores (o la app instalada en iPhone) bloquean ventanas emergentes.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(this.auth, provider);
        return new Promise(() => undefined); // la página se redirige
      }
      throw e;
    }
  }

  async signInWithPassword(email: string, password: string): Promise<CloudUser> {
    return toUser((await signInWithEmailAndPassword(this.auth, email.trim(), password)).user);
  }

  async signUpWithPassword(email: string, password: string, name: string): Promise<CloudUser> {
    const { user } = await createUserWithEmailAndPassword(this.auth, email.trim(), password);
    if (name.trim()) await updateProfile(user, { displayName: name.trim() });
    // La verificación hace falta para aceptar invitaciones (reglas de Firestore).
    return toUser(user);
  }

  sendPasswordReset(email: string) {
    return sendPasswordResetEmail(this.auth, email.trim());
  }

  async reloadUser(): Promise<CloudUser | null> {
    const u = this.auth.currentUser;
    if (!u) return null;
    await reload(u);
    // Token nuevo: así Firestore ve email_verified = true sin cerrar sesión.
    await u.getIdToken(true);
    return toUser(u);
  }

  async resendVerification() {
    if (this.auth.currentUser) await sendEmailVerification(this.auth.currentUser);
  }

  signOut() {
    return signOut(this.auth);
  }

  private ws(id: string) {
    return doc(this.fs, 'workspaces', id);
  }

  private static toWorkspace(id: string, d: Record<string, unknown>): Workspace {
    return {
      id,
      name: String(d.name ?? 'Espacio'),
      ownerUid: String(d.ownerUid ?? ''),
      memberUids: (d.memberUids as string[]) ?? [],
      roles: (d.roles as Workspace['roles']) ?? {},
      memberInfo: (d.memberInfo as Workspace['memberInfo']) ?? {},
      inviteEmails: (d.inviteEmails as string[]) ?? [],
      createdAt: String(d.createdAt ?? ''),
    };
  }

  async myWorkspaces(user: CloudUser) {
    const snap = await getDocs(query(collection(this.fs, 'workspaces'), where('memberUids', 'array-contains', user.uid)));
    return snap.docs.map((d) => FirebaseBackend.toWorkspace(d.id, d.data()));
  }

  async myInvites(user: CloudUser) {
    if (!user.email) return [];
    const snap = await getDocs(query(collection(this.fs, 'workspaces'), where('inviteEmails', 'array-contains', user.email)));
    return snap.docs.map((d) => FirebaseBackend.toWorkspace(d.id, d.data()));
  }

  async createWorkspace(user: CloudUser, name: string): Promise<Workspace> {
    const ws: Workspace = {
      id: uuid(),
      name,
      ownerUid: user.uid,
      memberUids: [user.uid],
      roles: { [user.uid]: 'owner' },
      memberInfo: { [user.uid]: { email: user.email, name: user.name } },
      inviteEmails: [],
      createdAt: nowIso(),
    };
    const { id, ...data } = ws;
    await setDoc(this.ws(id), data);
    return ws;
  }

  async joinWorkspace(user: CloudUser, ws: Workspace) {
    await updateDoc(this.ws(ws.id), {
      memberUids: arrayUnion(user.uid),
      [`roles.${user.uid}`]: 'member',
      [`memberInfo.${user.uid}`]: { email: user.email, name: user.name ?? null },
      inviteEmails: ws.inviteEmails.filter((e) => e !== user.email),
    });
  }

  async updateWorkspace(ws: Workspace, patch: Partial<Workspace>) {
    await updateDoc(this.ws(ws.id), patch as Record<string, unknown>);
  }

  async deleteWorkspace(ws: Workspace) {
    // Firestore no borra subcolecciones al borrar el documento: se borran primero, de a lotes.
    for (const table of [...SYNC_TABLES, 'invoiceImages']) {
      const snap = await getDocs(collection(this.fs, 'workspaces', ws.id, table));
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = writeBatch(this.fs);
        for (const d of snap.docs.slice(i, i + 400)) batch.delete(d.ref);
        await batch.commit();
      }
    }
    await deleteDoc(this.ws(ws.id));
  }

  watchWorkspace(id: string, cb: (ws: Workspace | null, gone: boolean) => void) {
    return onSnapshot(
      this.ws(id),
      { includeMetadataChanges: true },
      (s) => (s.exists() ? cb(FirebaseBackend.toWorkspace(s.id, s.data()), false) : cb(null, !s.metadata.fromCache)),
      // Un espacio borrado tampoco se puede leer (las reglas exigen ser miembro): también cuenta como "ya no está".
      (e) => cb(null, (e as { code?: string }).code === 'permission-denied'),
    );
  }

  put(wsId: string, table: SyncTableName, d: RemoteDoc) {
    return setDoc(doc(this.fs, 'workspaces', wsId, table, d.id), d);
  }

  watch(wsId: string, table: SyncTableName, cb: (changes: RemoteChange[], info: WatchInfo) => void, onError: (e: unknown) => void) {
    let first = true;
    let confirmed = false;
    return onSnapshot(
      collection(this.fs, 'workspaces', wsId, table),
      { includeMetadataChanges: true },
      (snap) => {
        const changes = snap.docChanges()
          .filter((c) => c.type !== 'removed')
          .map((c) => ({ doc: { ...c.doc.data(), id: c.doc.id } as RemoteDoc, pending: c.doc.metadata.hasPendingWrites }));
        const serverIds = !confirmed && !snap.metadata.fromCache ? snap.docs.map((d) => d.id) : undefined;
        if (serverIds) confirmed = true;
        if (!changes.length && !first && !serverIds) return; // sólo cambió metadata
        cb(changes, { initial: first, serverIds });
        first = false;
      },
      onError,
    );
  }

  private img(wsId: string, id: string) {
    return doc(this.fs, 'workspaces', wsId, 'invoiceImages', id);
  }

  async putImage(wsId: string, img: CloudImage) {
    await setDoc(this.img(wsId, img.id), { invoiceId: img.invoiceId, type: img.type, data: img.data, updatedAt: nowIso() });
  }

  async getImage(wsId: string, id: string): Promise<CloudImage | null> {
    const s = await getDoc(this.img(wsId, id));
    if (!s.exists()) return null;
    const d = s.data();
    return { id, invoiceId: String(d.invoiceId ?? ''), type: String(d.type ?? 'image/jpeg'), data: String(d.data ?? '') };
  }

  async deleteImage(wsId: string, id: string) {
    await deleteDoc(this.img(wsId, id));
  }
}
