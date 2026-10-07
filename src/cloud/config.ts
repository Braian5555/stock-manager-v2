import { db } from '../database/db';

/**
 * Configuración de la nube. Vive en public/firebase-config.json (se edita desde GitHub,
 * sin tocar código). Los valores de configuración web de Firebase son PÚBLICOS por diseño:
 * la seguridad la dan las reglas de Firestore y el inicio de sesión con Google.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

export type CloudConfig = { provider: 'firebase'; firebase: FirebaseWebConfig } | { provider: 'fake' } | { provider: 'none' };

const META_KEY = 'cloud.config';

function parse(raw: unknown): CloudConfig {
  if (!raw || typeof raw !== 'object') return { provider: 'none' };
  const o = raw as Record<string, unknown>;
  if (o.provider === 'fake') return { provider: 'fake' };
  const fb = (o.firebase && typeof o.firebase === 'object' ? o.firebase : o) as Partial<FirebaseWebConfig>;
  if (typeof fb.apiKey === 'string' && fb.apiKey && typeof fb.projectId === 'string' && fb.projectId && typeof fb.appId === 'string' && fb.appId) {
    return {
      provider: 'firebase',
      firebase: { apiKey: fb.apiKey, projectId: fb.projectId, appId: fb.appId, authDomain: fb.authDomain || `${fb.projectId}.firebaseapp.com`, storageBucket: fb.storageBucket, messagingSenderId: fb.messagingSenderId },
    };
  }
  return { provider: 'none' };
}

/**
 * Si la app se sirve desde Firebase Hosting (*.web.app / *.firebaseapp.com del mismo
 * proyecto), el inicio de sesión usa el MISMO dominio que la app. Así funciona también
 * en la app instalada en iPhone, que bloquea el inicio de sesión entre dominios distintos.
 */
export function effectiveAuthDomain(cfg: FirebaseWebConfig, hostname = globalThis.location?.hostname ?? ''): string {
  const own = [`${cfg.projectId}.web.app`, `${cfg.projectId}.firebaseapp.com`];
  return own.includes(hostname) ? hostname : cfg.authDomain;
}

/** true cuando el inicio de sesión ocurre en el mismo dominio que la app. */
export const sameOriginAuth = (cfg: FirebaseWebConfig) => effectiveAuthDomain(cfg) === globalThis.location?.hostname;

/** Lee la configuración publicada; sin conexión usa la última conocida. */
export async function loadCloudConfig(): Promise<CloudConfig> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}firebase-config.json`, { cache: 'no-store' });
    if (res.ok) {
      const cfg = parse(await res.json());
      await db.meta.put({ key: META_KEY, value: cfg });
      return cfg;
    }
    if (res.status === 404) return { provider: 'none' };
  } catch {
    /* sin conexión */
  }
  const cached = await db.meta.get(META_KEY);
  return (cached?.value as CloudConfig | undefined) ?? { provider: 'none' };
}
