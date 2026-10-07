/**
 * Usuarios internos con PIN.
 *
 * Seguridad: el PIN controla el ACCESO a la app en un dispositivo compartido. Se guarda
 * como hash PBKDF2-SHA256 (100.000 iteraciones, sal aleatoria por usuario) y hay bloqueo
 * por intentos fallidos. Un PIN de 4–6 dígitos no es una contraseña fuerte: la protección
 * de los datos en la nube la siguen dando la cuenta de Google vinculada y las reglas de Firestore.
 */
import { db } from '../database/db';
import { PERMISSIONS, type AppUser, type Permission, type UserRole } from '../models';
import { nowIso, uuid } from '../utils/id';

export const PERMISSION_LABEL: Record<Permission, string> = {
  'stock.view': 'Ver stock e inicio',
  'stock.move': 'Registrar movimientos de stock',
  'count.do': 'Hacer conteos',
  'count.apply': 'Aplicar conteos al stock',
  'orders.manage': 'Crear y editar pedidos',
  'orders.receive': 'Recibir pedidos',
  'catalog.manage': 'Administrar productos, proveedores y catálogos',
  'movements.view': 'Ver historial de movimientos',
  export: 'Exportar datos',
  invoices: 'Cargar, ver y descargar facturas',
  transfers: 'Hacer remitos internos a los puntos y marcarlos en Maxirest',
  admin: 'Administración (usuarios, configuración, integraciones, nube y backups)',
};

export const ROLE_LABEL: Record<UserRole, string> = {
  admin: 'Administrador',
  manager: 'Encargado',
  staff: 'Empleado',
  custom: 'Personalizado',
};

export const ROLE_PERMISSIONS: Record<Exclude<UserRole, 'custom'>, Permission[]> = {
  admin: [...PERMISSIONS],
  manager: ['stock.view', 'stock.move', 'count.do', 'count.apply', 'orders.manage', 'orders.receive', 'catalog.manage', 'movements.view', 'export', 'invoices', 'transfers'],
  staff: ['stock.view', 'count.do', 'orders.receive', 'invoices'],
};

/**
 * Permisos vigentes de un usuario. Los roles fijos toman SIEMPRE la lista actual del rol
 * (así, si una versión nueva agrega un permiso, los usuarios existentes lo reciben);
 * el administrador tiene todos.
 */
export function effectivePermissions(u: Pick<AppUser, 'role' | 'permissions'>): Permission[] {
  if (u.role !== 'custom' && ROLE_PERMISSIONS[u.role]) return ROLE_PERMISSIONS[u.role];
  return u.permissions.includes('admin') ? [...PERMISSIONS] : u.permissions;
}

export const PIN_RE = /^\d{4,6}$/;
const ITERATIONS = 100_000;
const COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#db2777', '#7c3aed', '#dc2626', '#334155'];

const toHex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)));

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt) };
}

/** Comparación en tiempo constante. */
function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyPin(user: AppUser, pin: string): Promise<boolean> {
  const { hash } = await hashPin(pin, user.pinSalt);
  return sameHex(hash, user.pinHash);
}

export const isAdmin = (u: Pick<AppUser, 'permissions'>) => u.permissions.includes('admin');

export interface UserDraft {
  id?: string;
  name: string;
  role: UserRole;
  permissions: Permission[];
  active: boolean;
  pin?: string;
}

async function activeAdmins(excludeId?: string) {
  return (await db.users.toArray()).filter((u) => u.active && isAdmin(u) && u.id !== excludeId);
}

export async function saveUser(d: UserDraft): Promise<AppUser> {
  const name = d.name.trim();
  if (!name) throw new Error('Ingresá el nombre del usuario.');
  if (d.pin !== undefined && !PIN_RE.test(d.pin)) throw new Error('El PIN debe tener entre 4 y 6 números.');
  const permissions = d.role === 'custom' ? [...new Set(d.permissions)] : ROLE_PERMISSIONS[d.role];
  if (!permissions.length) throw new Error('Elegí al menos un permiso.');
  const all = await db.users.toArray();
  if (all.some((u) => u.id !== d.id && u.name.toLocaleLowerCase('es') === name.toLocaleLowerCase('es')))
    throw new Error('Ya existe un usuario con ese nombre.');
  const t = nowIso();
  const prev = d.id ? await db.users.get(d.id) : undefined;
  if (d.id && !prev) throw new Error('El usuario no existe.');
  if (prev && isAdmin(prev) && (!permissions.includes('admin') || !d.active) && !(await activeAdmins(prev.id)).length)
    throw new Error('Tiene que quedar al menos un administrador activo.');
  if (!prev && !d.pin) throw new Error('Definí un PIN para el usuario.');
  const pin = d.pin ? await hashPin(d.pin) : { hash: prev!.pinHash, salt: prev!.pinSalt };
  const user: AppUser = {
    id: prev?.id ?? uuid(),
    createdAt: prev?.createdAt ?? t,
    updatedAt: t,
    name,
    role: d.role,
    permissions,
    pinHash: pin.hash,
    pinSalt: pin.salt,
    active: d.active,
    color: prev?.color ?? COLORS[all.length % COLORS.length],
  };
  await db.users.put(user);
  return user;
}

export async function deleteUser(id: string): Promise<void> {
  const u = await db.users.get(id);
  if (!u) return;
  if (isAdmin(u) && !(await activeAdmins(id)).length) throw new Error('No se puede eliminar al último administrador.');
  await db.users.delete(id);
}

export async function countUsers(): Promise<number> {
  return db.users.count();
}

// ───────────── Usuario actual (para registrar quién hace cada cosa) ─────────────
let actor: { id: string; name: string } | undefined;
export const setCurrentActor = (a: { id: string; name: string } | undefined) => {
  actor = a;
};
export const getCurrentActor = () => actor;
