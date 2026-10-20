/**
 * Conversaciones del asistente guardadas en el dispositivo (tabla `meta`, no se sincroniza):
 * la actual se retoma al volver a abrir la app y las anteriores quedan en el historial.
 * Cada usuario ve sólo las suyas.
 */
import { db } from '../../database/db';
import type { ChatSnapshot } from './engine';

/** Cuántas conversaciones anteriores se guardan por usuario. */
export const MAX_ARCHIVED = 40;

const currentKey = (userId: string) => `assistant.current:${userId}`;
export const archiveKey = (userId: string) => `assistant.archive:${userId}`;

const isSnapshot = (v: unknown): v is ChatSnapshot => !!v && typeof v === 'object' && (v as ChatSnapshot).v === 1 && Array.isArray((v as ChatSnapshot).messages);

export async function loadCurrent(userId: string): Promise<ChatSnapshot | undefined> {
  const r = await db.meta.get(currentKey(userId));
  return isSnapshot(r?.value) ? r.value : undefined;
}

export async function saveCurrent(userId: string, chat: ChatSnapshot | undefined): Promise<void> {
  if (chat && chat.messages.length) await db.meta.put({ key: currentKey(userId), value: chat });
  else await db.meta.delete(currentKey(userId));
}

export async function loadArchive(userId: string): Promise<ChatSnapshot[]> {
  const r = await db.meta.get(archiveKey(userId));
  return Array.isArray(r?.value) ? (r.value as unknown[]).filter(isSnapshot) : [];
}

/** Guarda una conversación en el historial (la más nueva primero, sin repetir). */
export async function archiveChat(userId: string, chat: ChatSnapshot): Promise<void> {
  if (!chat.messages.length) return;
  await db.transaction('rw', db.meta, async () => {
    const list = (await loadArchive(userId)).filter((c) => c.id !== chat.id);
    await db.meta.put({ key: archiveKey(userId), value: [chat, ...list].slice(0, MAX_ARCHIVED) });
  });
}

/** Saca una conversación del historial y la devuelve (para retomarla o borrarla). */
export async function takeArchived(userId: string, id: string): Promise<ChatSnapshot | undefined> {
  return db.transaction('rw', db.meta, async () => {
    const list = await loadArchive(userId);
    const found = list.find((c) => c.id === id);
    if (found) await db.meta.put({ key: archiveKey(userId), value: list.filter((c) => c.id !== id) });
    return found;
  });
}
