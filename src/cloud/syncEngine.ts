/**
 * Motor de sincronización bidireccional entre IndexedDB (Dexie) y la nube.
 *
 * - La app SIEMPRE lee y escribe la base local: funciona igual sin conexión.
 * - Subida: un middleware de Dexie informa qué registros cambiaron; al confirmarse la
 *   transacción, se envía el registro actual (o una lápida si se eliminó).
 * - Bajada: escucha cada colección; aplica "gana el cambio más reciente" (updatedAt).
 * - Eliminaciones: lápidas {_deleted:true}, así un dispositivo que estuvo desconectado
 *   no "revive" lo que otro borró.
 * - Stock: los movimientos son inmutables y el stock se recalcula a partir de ellos
 *   (recomputeStock), por lo que dos dispositivos pueden mover stock a la vez sin perder datos.
 */
import Dexie from 'dexie';
import { db, setMutationListener, SYNC_TABLES, type SyncTableName } from '../database/db';
import { recomputeStock } from '../services/stockService';
import { nowIso } from '../utils/id';
import type { CloudBackend, RemoteChange, RemoteDoc } from './types';

export type SyncState = 'idle' | 'connecting' | 'synced' | 'pending' | 'offline' | 'error';
export interface SyncStatus {
  state: SyncState;
  pending: number;
  lastSyncAt?: string;
  error?: string;
}

type Listener = (s: SyncStatus) => void;

/** Transacciones abiertas por el propio motor al aplicar datos remotos: no se re-suben. */
const remoteTransactions = new WeakSet<IDBTransaction>();

export class SyncEngine {
  private unsubs: (() => void)[] = [];
  private pendingByTrans = new WeakMap<IDBTransaction, Map<string, { table: SyncTableName; id: string }>>();
  private inFlight = 0;
  private initialLeft = 0;
  private status: SyncStatus = { state: 'idle', pending: 0 };
  private listeners = new Set<Listener>();
  private stopped = false;

  constructor(private backend: CloudBackend, private wsId: string) {}

  // ───────────── estado ─────────────
  getStatus() {
    return this.status;
  }
  onStatus(l: Listener) {
    this.listeners.add(l);
    l(this.status);
    return () => this.listeners.delete(l);
  }
  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    if (this.status.state !== 'error' && this.status.state !== 'connecting') {
      const online = typeof navigator === 'undefined' || navigator.onLine !== false;
      this.status.state = !online ? 'offline' : this.inFlight > 0 ? 'pending' : 'synced';
    }
    this.status.pending = this.inFlight;
    for (const l of this.listeners) l(this.status);
  }

  // ───────────── ciclo de vida ─────────────
  /**
   * Arranca la sincronización. Con `pushAll` sube todos los datos locales (al crear un espacio).
   */
  async start(opts: { pushAll?: boolean } = {}) {
    this.stopped = false;
    this.setStatus({ state: 'connecting', error: undefined });
    setMutationListener((table, ids, trans) => this.track(table, ids, trans));
    if (opts.pushAll) for (const t of SYNC_TABLES) for (const r of await db.table(t).toArray()) this.send(t, r as RemoteDoc);

    this.initialLeft = SYNC_TABLES.length;
    for (const t of SYNC_TABLES) {
      this.unsubs.push(
        this.backend.watch(
          this.wsId,
          t,
          (changes, initial) => void this.applyRemote(t, changes, initial),
          (e) => this.setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) }),
        ),
      );
    }
    if (typeof window !== 'undefined') {
      const onNet = () => this.setStatus({});
      window.addEventListener('online', onNet);
      window.addEventListener('offline', onNet);
      this.unsubs.push(() => {
        window.removeEventListener('online', onNet);
        window.removeEventListener('offline', onNet);
      });
    }
  }

  stop() {
    this.stopped = true;
    setMutationListener(null);
    for (const u of this.unsubs.splice(0)) u();
    this.setStatus({ state: 'idle' });
  }

  // ───────────── subida ─────────────
  private track(table: SyncTableName, ids: string[], trans: IDBTransaction) {
    if (remoteTransactions.has(trans)) return;
    let pending = this.pendingByTrans.get(trans);
    if (!pending) {
      pending = new Map();
      this.pendingByTrans.set(trans, pending);
      const p = pending;
      trans.addEventListener('complete', () => void this.flush(p));
    }
    for (const id of ids) pending.set(`${table}\u0000${id}`, { table, id });
  }

  private async flush(pending: Map<string, { table: SyncTableName; id: string }>) {
    if (this.stopped) return;
    for (const { table, id } of pending.values()) {
      const rec = (await db.table(table).get(id)) as RemoteDoc | undefined;
      this.send(table, rec ?? { id, _deleted: true, updatedAt: nowIso() });
    }
  }

  private send(table: SyncTableName, d: RemoteDoc) {
    this.inFlight++;
    this.setStatus({});
    this.backend
      .put(this.wsId, table, d)
      .then(() => this.setStatus({ state: this.status.state === 'connecting' ? 'connecting' : 'synced', error: undefined, lastSyncAt: nowIso() }))
      .catch((e) => this.setStatus({ state: 'error', error: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        this.inFlight--;
        this.setStatus({});
      });
  }

  // ───────────── bajada ─────────────
  private async applyRemote(table: SyncTableName, changes: RemoteChange[], initial: boolean) {
    const docs = changes.filter((c) => !c.pending).map((c) => c.doc);
    const remoteIds = new Set(docs.map((d) => d.id));
    const affectedProducts = new Set<string>();
    const toPush: RemoteDoc[] = [];

    await db.transaction('rw', [db.table(table), db.products, db.movements, db.invoiceImages], async () => {
      const tx = Dexie.currentTransaction as unknown as { idbtrans: IDBTransaction };
      remoteTransactions.add(tx.idbtrans);
      const t = db.table(table);
      for (const d of docs) {
        const local = (await t.get(d.id)) as RemoteDoc | undefined;
        const remoteAt = d.updatedAt ?? '';
        if (local && (local.updatedAt ?? '') >= remoteAt) {
          // Lo local es igual o más nuevo: si es más nuevo, se vuelve a subir.
          if ((local.updatedAt ?? '') > remoteAt) toPush.push(local);
          continue;
        }
        if (d._deleted) {
          if (local) await t.delete(d.id);
          if (table === 'invoices') await db.invoiceImages.where('invoiceId').equals(d.id).delete();
        } else {
          const clean = { ...d };
          delete clean._deleted;
          if (table === 'movements') {
            const dup = await db.movements.where('idempotencyKey').equals(String(clean.idempotencyKey)).first();
            if (dup && dup.id !== clean.id) continue; // mismo hecho registrado con otro id: no duplicar
          }
          if (table === 'products' && local) clean.stock = (local as unknown as { stock: number }).stock; // el stock se deriva de los movimientos
          await t.put(clean);
        }
        if (table === 'movements' && typeof d.productId === 'string') affectedProducts.add(d.productId);
        if (table === 'products') affectedProducts.add(d.id);
      }
      for (const pid of affectedProducts) await recomputeStock(pid);

      // Primera carga: lo que existe sólo en este dispositivo se sube (p. ej. creado sin sesión).
      if (initial) {
        const all = (await t.toArray()) as RemoteDoc[];
        for (const r of all) if (!remoteIds.has(r.id)) toPush.push(r);
      }
    });

    for (const d of toPush) this.send(table, d);
    if (initial && --this.initialLeft === 0) this.setStatus({ state: 'synced', lastSyncAt: nowIso() });
    else if (!initial) this.setStatus({ lastSyncAt: nowIso() });
  }
}
