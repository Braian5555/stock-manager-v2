/**
 * Contrato del backend de nube. La implementación real es Firebase (Google);
 * existe una implementación en memoria para pruebas automáticas.
 */
import type { SyncTableName } from '../database/db';

export interface CloudUser {
  uid: string;
  email: string;
  name?: string;
  photoURL?: string;
}

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export interface Workspace {
  id: string;
  name: string;
  ownerUid: string;
  memberUids: string[];
  roles: Record<string, WorkspaceRole>;
  memberInfo: Record<string, { email: string; name?: string }>;
  inviteEmails: string[];
  createdAt: string;
}

/** Documento remoto: un registro de una tabla, o una lápida si fue eliminado. */
export interface RemoteDoc {
  id: string;
  updatedAt?: string;
  _deleted?: boolean;
  [key: string]: unknown;
}

export interface RemoteChange {
  doc: RemoteDoc;
  /** true si el cambio es un eco de una escritura propia todavía no confirmada. */
  pending: boolean;
}

export interface CloudBackend {
  readonly kind: 'firebase' | 'fake';
  onUser(cb: (user: CloudUser | null) => void): () => void;
  signIn(): Promise<CloudUser>;
  signOut(): Promise<void>;

  myWorkspaces(user: CloudUser): Promise<Workspace[]>;
  myInvites(user: CloudUser): Promise<Workspace[]>;
  createWorkspace(user: CloudUser, name: string): Promise<Workspace>;
  joinWorkspace(user: CloudUser, ws: Workspace): Promise<void>;
  updateWorkspace(ws: Workspace, patch: Partial<Pick<Workspace, 'name' | 'inviteEmails' | 'memberUids' | 'roles' | 'memberInfo'>>): Promise<void>;
  watchWorkspace(id: string, cb: (ws: Workspace | null) => void): () => void;

  /** Escritura offline-first: se encola si no hay conexión. Resuelve al confirmarse en el servidor. */
  put(wsId: string, table: SyncTableName, doc: RemoteDoc): Promise<void>;
  /**
   * Escucha una colección. El primer lote (`initial`) trae lo que haya (puede venir de la copia
   * local de Firestore). `serverIds` llega UNA vez, cuando el servidor confirmó la lista completa:
   * recién ahí se puede saber qué registros existen sólo en este dispositivo.
   */
  watch(wsId: string, table: SyncTableName, cb: (changes: RemoteChange[], info: WatchInfo) => void, onError: (e: unknown) => void): () => void;

  /** Fotos de facturas: se suben/bajan de a una, fuera de la sincronización general. */
  putImage(wsId: string, img: CloudImage): Promise<void>;
  /** null si no existe. Lanza error si no hay conexión y no está en la copia local. */
  getImage(wsId: string, id: string): Promise<CloudImage | null>;
  deleteImage(wsId: string, id: string): Promise<void>;
}

export interface WatchInfo {
  initial: boolean;
  serverIds?: string[];
}

export interface CloudImage {
  id: string;
  invoiceId: string;
  type: string;
  /** JPEG en base64 (sin prefijo data:). Máx. ~900 KB por el límite de Firestore. */
  data: string;
}
