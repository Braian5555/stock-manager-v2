import { describe, expect, it } from 'vitest';
import { db } from '../../src/database/db';
import { deleteUser, hashPin, saveUser, setCurrentActor, verifyPin, ROLE_PERMISSIONS } from '../../src/services/userService';
import { applyMovement } from '../../src/services/stockService';
import { emptyProduct, saveProduct } from '../../src/services/productService';
import { lockoutDelay } from '../../src/store/session';
import { createBackup } from '../../src/services/backupService';

describe('usuarios con PIN', () => {
  it('guarda sólo el hash del PIN y lo verifica', async () => {
    const u = await saveUser({ name: 'Ana', pin: '1234', role: 'admin', permissions: [], active: true });
    expect(u.pinHash).toHaveLength(64);
    expect(JSON.stringify(u)).not.toContain('1234');
    expect(await verifyPin(u, '1234')).toBe(true);
    expect(await verifyPin(u, '4321')).toBe(false);
    const again = await hashPin('1234');
    expect(again.hash).not.toBe(u.pinHash); // sal distinta
    expect(JSON.stringify(await createBackup())).not.toContain('"1234"');
  });

  it('aplica los permisos del rol y valida PIN y nombre', async () => {
    const s = await saveUser({ name: 'Juan', pin: '5678', role: 'staff', permissions: ['admin'], active: true });
    expect(s.permissions).toEqual(ROLE_PERMISSIONS.staff);
    const c = await saveUser({ name: 'Eva', pin: '1111', role: 'custom', permissions: ['count.do', 'count.do'], active: true });
    expect(c.permissions).toEqual(['count.do']);
    await expect(saveUser({ name: 'X', pin: '12', role: 'staff', permissions: [], active: true })).rejects.toThrow(/PIN/);
    await expect(saveUser({ name: 'juan', pin: '1234', role: 'staff', permissions: [], active: true })).rejects.toThrow(/nombre/);
  });

  it('siempre queda al menos un administrador activo', async () => {
    const a = await saveUser({ name: 'Admin', pin: '1234', role: 'admin', permissions: [], active: true });
    await expect(deleteUser(a.id)).rejects.toThrow(/último administrador/);
    await expect(saveUser({ id: a.id, name: 'Admin', role: 'staff', permissions: [], active: true })).rejects.toThrow(/administrador/);
    await saveUser({ name: 'Otro', pin: '9999', role: 'admin', permissions: [], active: true });
    await deleteUser(a.id);
    expect(await db.users.count()).toBe(1);
  });

  it('cambiar datos sin PIN conserva el PIN anterior', async () => {
    const u = await saveUser({ name: 'Leo', pin: '2468', role: 'manager', permissions: [], active: true });
    const u2 = await saveUser({ id: u.id, name: 'Leonel', role: 'manager', permissions: [], active: true });
    expect(await verifyPin(u2, '2468')).toBe(true);
  });

  it('cada movimiento registra qué usuario lo hizo', async () => {
    const p = await saveProduct({ ...emptyProduct(), name: 'Agua' }, 5);
    setCurrentActor({ id: 'u1', name: 'Ana' });
    const { movement } = await applyMovement({ productId: p.id, type: 'salida', delta: -1, origin: 'manual' });
    setCurrentActor(undefined);
    expect(movement.performedBy).toEqual({ id: 'u1', name: 'Ana' });
  });

  it('bloqueo progresivo por PIN incorrecto', () => {
    expect(lockoutDelay(4)).toBe(0);
    expect(lockoutDelay(5)).toBe(30_000);
    expect(lockoutDelay(6)).toBe(60_000);
    expect(lockoutDelay(30)).toBe(15 * 60_000);
  });
});
