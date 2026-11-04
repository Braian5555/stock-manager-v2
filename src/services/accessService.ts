import { db } from '../database/db';
import type { AccessEntry, AccessKind, AppUser } from '../models';
import { uploadPendingAccess } from '../cloud/cloudService';
import { nowIso, uuid } from '../utils/id';

/**
 * Registro de ingresos: quién entró a la app, cuándo y desde qué dispositivo.
 *  - "ingreso": entró con su PIN o con su cuenta.
 *  - "apertura": abrió la app con la sesión ya abierta (como máximo una vez cada media hora por dispositivo).
 *  - "salida": cerró sesión o bloqueó la app.
 * Se guarda en el dispositivo y se sube a la nube aparte de la sincronización general.
 */

const DEVICE_KEY = 'sm:device-id';
/** Abrir la app varias veces seguidas cuenta como una sola apertura. */
export const REOPEN_GAP_MS = 30 * 60_000;

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = uuid();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return 'sin-id';
  }
}

/** "Android · Chrome · app instalada", "iPhone · Safari", "Windows · Edge"… */
export function describeDevice(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', standalone = isStandalone()): string {
  const os = /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua)) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Tablet Android')
    : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : 'Otro dispositivo';
  const browser = /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari/.test(ua) ? 'Safari'
    : '';
  return [os, browser, standalone ? 'app instalada' : ''].filter(Boolean).join(' · ');
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** ¿Hay que anotar una apertura? No, si la última entrada de esa persona en este dispositivo es reciente. */
export function shouldRecordOpening(last: Pick<AccessEntry, 'at'> | undefined, now = Date.now()): boolean {
  return !last || now - new Date(last.at).getTime() >= REOPEN_GAP_MS;
}

export async function recordAccess(user: Pick<AppUser, 'id' | 'name' | 'email'>, kind: AccessKind): Promise<AccessEntry | null> {
  const dev = deviceId();
  if (kind === 'apertura') {
    const mine = await db.accessLog.where('at').above(new Date(Date.now() - REOPEN_GAP_MS).toISOString())
      .filter((e) => e.userId === user.id && e.deviceId === dev).last();
    if (!shouldRecordOpening(mine)) return null;
  }
  const entry: AccessEntry = {
    id: uuid(), at: nowIso(), kind, userId: user.id, userName: user.name, ...(user.email ? { email: user.email } : {}),
    device: describeDevice(), deviceId: dev, pushed: 0,
  };
  await db.accessLog.add(entry);
  void uploadPendingAccess();
  return entry;
}

/** Ingresos guardados en este dispositivo (sin nube, o para mostrar mientras carga la nube). */
export async function localAccessLog(sinceIso: string): Promise<AccessEntry[]> {
  return db.accessLog.where('at').aboveOrEqual(sinceIso).toArray();
}

export const ACCESS_KIND_LABEL: Record<AccessKind, string> = { ingreso: 'Entró', apertura: 'Abrió la app', salida: 'Salió' };
