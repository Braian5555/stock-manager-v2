import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../database/db';
import type { DiningTable, FixtureKind, FloorFixture, FloorLayout, FloorPlanConfig, FloorStyle, FloorTableSpot, ID, ZonePlan } from '../models';
import { uuid, nowIso } from '../utils/id';
import { currentOutlet, useLocalScope } from './localScope';
import { getSettings, SETTINGS_ID, updateSettings } from './settingsService';

/**
 * Plano del salón de cada local: armados guardados ("Día", "Noche", "Evento"), piso y elementos fijos
 * de cada sector, y un candado para que nadie mueva las mesas sin querer.
 * Vive en el local (o en la configuración general si todavía no hay locales), así se sincroniza
 * con las otras compus del mismo local.
 */

export const FLOOR_STYLES: { value: FloorStyle; label: string }[] = [
  { value: 'puntos', label: 'Cuadrícula' },
  { value: 'liso', label: 'Liso' },
  { value: 'madera', label: 'Madera' },
  { value: 'baldosas', label: 'Baldosas' },
  { value: 'deck', label: 'Deck' },
  { value: 'arena', label: 'Arena' },
  { value: 'cesped', label: 'Césped' },
];

export const FIXTURE_LABEL: Record<FixtureKind, string> = {
  barra: 'Barra', caja: 'Caja', cocina: 'Cocina', entrada: 'Entrada', bano: 'Baños',
  pared: 'Pared', ventanal: 'Ventanal', planta: 'Planta', sombrilla: 'Sombrilla', mar: 'Mar',
};
/** Elementos largos: se pueden girar. */
export const LONG_FIXTURES: ReadonlySet<FixtureKind> = new Set(['barra', 'pared', 'ventanal', 'mar']);

const LOCKED = 'El plano está bloqueado: pedile a un encargado que lo desbloquee.';
const clampPct = (v: number) => Math.round(Math.min(97, Math.max(3, v)) * 10) / 10;

async function readPlan(): Promise<FloorPlanConfig> {
  const o = currentOutlet();
  if (o) return (await db.outlets.get(o.id))?.floorPlan ?? {};
  return (await getSettings()).floorPlan ?? {};
}

async function writePlan(cfg: FloorPlanConfig): Promise<void> {
  const o = currentOutlet();
  if (o) await db.outlets.update(o.id, { floorPlan: cfg, updatedAt: nowIso() });
  else await updateSettings({ floorPlan: cfg });
}

/** Cambia el plano del local de este equipo (lee y escribe junto, para no pisar cambios). */
async function edit(fn: (cfg: FloorPlanConfig) => FloorPlanConfig | void, opts: { evenIfLocked?: boolean } = {}): Promise<FloorPlanConfig> {
  return db.transaction('rw', [db.outlets, db.settings], async () => {
    const cfg: FloorPlanConfig = structuredClone(await readPlan());
    if (cfg.locked && !opts.evenIfLocked) throw new Error(LOCKED);
    const next = fn(cfg) ?? cfg;
    await writePlan(next);
    return next;
  });
}

const zoneOf = (cfg: FloorPlanConfig, zone: string): ZonePlan => {
  cfg.zones ??= {};
  return (cfg.zones[zone] ??= {});
};

export async function getFloorPlan(): Promise<FloorPlanConfig> {
  return readPlan();
}

/** El plano del local de este equipo, en vivo. */
export function useFloorPlan(): FloorPlanConfig {
  const scope = useLocalScope();
  const id = scope.current?.id;
  return (useLiveQuery(async () => (id ? (await db.outlets.get(id))?.floorPlan : (await db.settings.get(SETTINGS_ID))?.floorPlan) ?? {}, [id]) ?? {}) as FloorPlanConfig;
}

/** Si el plano está bloqueado, no se puede mover nada. */
export async function assertPlanUnlocked(): Promise<void> {
  if ((await readPlan()).locked) throw new Error(LOCKED);
}

export async function setPlanLocked(locked: boolean, by?: string): Promise<void> {
  await edit((cfg) => { if (locked) cfg.locked = { at: nowIso(), ...(by ? { by } : {}) }; else delete cfg.locked; }, { evenIfLocked: true });
}

export async function setZoneFloor(zone: string, floor: FloorStyle): Promise<void> {
  await edit((cfg) => { zoneOf(cfg, zone).floor = floor; });
}

/** Agrega un elemento fijo al sector, cerca del centro (corrido si ya hay otros). */
export async function addFixture(zone: string, kind: FixtureKind): Promise<FloorFixture> {
  let f!: FloorFixture;
  await edit((cfg) => {
    const z = zoneOf(cfg, zone);
    const n = z.fixtures?.length ?? 0;
    f = { id: uuid(), kind, x: clampPct(50 + ((n % 5) - 2) * 6), y: clampPct(kind === 'mar' ? 90 : 50 + (Math.floor(n / 5) % 3) * 8), size: 2 };
    z.fixtures = [...(z.fixtures ?? []), f];
  });
  return f;
}

export async function updateFixture(zone: string, id: string, patch: Partial<Omit<FloorFixture, 'id' | 'kind'>>): Promise<void> {
  await edit((cfg) => {
    const z = zoneOf(cfg, zone);
    z.fixtures = (z.fixtures ?? []).map((f) => (f.id === id ? {
      ...f, ...patch,
      ...(patch.x !== undefined ? { x: clampPct(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: clampPct(patch.y) } : {}),
    } : f));
  });
}

export async function removeFixture(zone: string, id: string): Promise<void> {
  await edit((cfg) => { const z = zoneOf(cfg, zone); z.fixtures = (z.fixtures ?? []).filter((f) => f.id !== id); });
}

/** Cómo está el sector ahora: dónde está cada mesa, el piso y los elementos. */
export interface PlanSnapshot { tables: Record<ID, FloorTableSpot>; fixtures: FloorFixture[]; floor?: FloorStyle }

export function spotsOf(tables: DiningTable[]): Record<ID, FloorTableSpot> {
  const out: Record<ID, FloorTableSpot> = {};
  for (const t of tables) {
    if (t.x === undefined || t.y === undefined) continue;
    out[t.id] = { x: t.x, y: t.y, shape: t.shape ?? 'cuadrada', size: t.size ?? 2 };
  }
  return out;
}

export function snapshotOf(z: ZonePlan, tables: DiningTable[]): PlanSnapshot {
  return { tables: spotsOf(tables), fixtures: structuredClone(z.fixtures ?? []), ...(z.floor ? { floor: z.floor } : {}) };
}

/** Pone el sector como estaba en la foto (deshacer, o usar un armado). Las mesas que ya no existen se saltean. */
export async function applySnapshot(zone: string, snap: PlanSnapshot, layoutId?: string): Promise<void> {
  await db.transaction('rw', [db.outlets, db.settings, db.diningTables], async () => {
    await edit((cfg) => {
      const z = zoneOf(cfg, zone);
      z.fixtures = structuredClone(snap.fixtures);
      if (snap.floor) z.floor = snap.floor; else delete z.floor;
      if (layoutId !== undefined) z.layoutId = layoutId;
    });
    const t = nowIso();
    for (const [id, s] of Object.entries(snap.tables)) {
      const table = await db.diningTables.get(id);
      if (!table || !table.active) continue;
      await db.diningTables.put({ ...table, x: s.x, y: s.y, ...(s.shape ? { shape: s.shape } : {}), ...(s.size ? { size: s.size } : {}), updatedAt: t });
    }
  });
}

/** Guarda el sector como está, con un nombre. Con el mismo nombre, actualiza ese armado. */
export async function saveLayout(zone: string, name: string, tables: DiningTable[]): Promise<FloorLayout> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Poné un nombre para el armado (por ejemplo "Noche" o "Evento").');
  if (clean.length > 30) throw new Error('El nombre del armado es muy largo (hasta 30 letras).');
  let saved!: FloorLayout;
  await edit((cfg) => {
    const z = zoneOf(cfg, zone);
    const list = z.layouts ?? [];
    const prev = list.find((l) => l.name.toLocaleLowerCase('es') === clean.toLocaleLowerCase('es'));
    if (!prev && list.length >= 12) throw new Error('Hay 12 armados en este sector: borrá alguno para guardar otro.');
    saved = { id: prev?.id ?? uuid(), name: clean, savedAt: nowIso(), ...snapshotOf(z, tables) };
    z.layouts = prev ? list.map((l) => (l.id === prev.id ? saved : l)) : [...list, saved];
    z.layoutId = saved.id;
  }, { evenIfLocked: true });
  return saved;
}

/** Cambia el plano al armado guardado. */
export async function applyLayout(zone: string, id: string): Promise<void> {
  const z = (await readPlan()).zones?.[zone];
  const l = z?.layouts?.find((x) => x.id === id);
  if (!l) throw new Error('Ese armado ya no existe.');
  await applySnapshot(zone, { tables: l.tables, fixtures: l.fixtures, ...(l.floor ? { floor: l.floor } : {}) }, l.id);
}

export async function deleteLayout(zone: string, id: string): Promise<void> {
  await edit((cfg) => {
    const z = zoneOf(cfg, zone);
    z.layouts = (z.layouts ?? []).filter((l) => l.id !== id);
    if (z.layoutId === id) delete z.layoutId;
  }, { evenIfLocked: true });
}

/** ¿El sector sigue igual que el armado en uso? (si se movió algo, el armado "tiene cambios"). */
export function matchesLayout(l: FloorLayout, z: ZonePlan, tables: DiningTable[]): boolean {
  const now = snapshotOf(z, tables);
  if ((l.floor ?? 'puntos') !== (now.floor ?? 'puntos')) return false;
  const fx = (a: FloorFixture[]) => JSON.stringify([...a].sort((p, q) => p.id.localeCompare(q.id)).map((f) => [f.id, f.kind, f.x, f.y, f.size ?? 2, !!f.vertical]));
  if (fx(l.fixtures) !== fx(now.fixtures)) return false;
  return tables.every((t) => {
    const a = l.tables[t.id];
    const b = now.tables[t.id];
    if (!a || !b) return !a && !b;
    return a.x === b.x && a.y === b.y && (a.shape ?? 'cuadrada') === (b.shape ?? 'cuadrada') && (a.size ?? 2) === (b.size ?? 2);
  });
}

/** Acomoda las mesas en filas parejas (para empezar un plano prolijo). */
export function gridSpots(tables: DiningTable[]): Record<ID, FloorTableSpot> {
  const n = tables.length;
  const out: Record<ID, FloorTableSpot> = {};
  if (!n) return out;
  const cols = Math.min(n, Math.max(1, Math.ceil(Math.sqrt(n * 1.8))));
  const rows = Math.ceil(n / cols);
  tables.forEach((t, i) => {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - r * cols : cols;
    const c = i % cols;
    const x = 8 + ((c + 0.5) / inRow) * 84;
    const y = 10 + ((r + 0.5) / rows) * 80;
    out[t.id] = { x: Math.round(x), y: Math.round(y), shape: t.shape ?? 'cuadrada', size: t.size ?? 2 };
  });
  return out;
}
