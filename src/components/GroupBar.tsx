import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { Lookups } from '../hooks/useData';
import type { Product } from '../models';
import { Segmented } from './ui';

export type GroupMode = 'familia' | 'ubicacion' | 'unidad';
const MODES: { value: GroupMode; label: string }[] = [
  { value: 'familia', label: 'Familia' },
  { value: 'ubicacion', label: 'Ubicación' },
  { value: 'unidad', label: 'Unidad' },
];
const NONE = '_';

/** "horma" → "Hormas", "Unidad" → "Unidades", "cajón" → "Cajones". */
export function pluralUnit(name: string): string {
  const n = name.trim();
  if (!n) return n;
  const cap = n[0].toUpperCase() + n.slice(1);
  if (/ón$/i.test(cap)) return cap.replace(/ón$/i, 'ones');
  if (/[aeiouáéíóú]$/i.test(cap) || /t$/i.test(cap)) return `${cap}s`;
  return `${cap}es`;
}

export interface Group { id: string; label: string; count: number }

/**
 * Agrupa una lista de productos por familia, ubicación o unidad. El modo y el grupo elegido
 * quedan en la dirección (?agrupar=…&grupo=…) para volver al mismo lugar.
 */
export function useProductGroups<T>(rows: T[], productOf: (r: T) => Product | undefined, lk: Lookups) {
  const [params, setParams] = useSearchParams();
  const mode = (MODES.some((m) => m.value === params.get('agrupar')) ? params.get('agrupar') : 'familia') as GroupMode;
  const group = params.get('grupo') ?? '';

  const keyOf = useMemo(() => {
    const field = mode === 'familia' ? 'categoryId' : mode === 'ubicacion' ? 'locationId' : 'unitId';
    return (p: Product | undefined) => (p?.[field] as string | undefined) || NONE;
  }, [mode]);
  const labelOf = useMemo(() => {
    const unitName = new Map(lk.units.map((u) => [u.id, u.name]));
    return (id: string) => {
      if (id === NONE) return mode === 'familia' ? 'Sin familia' : mode === 'ubicacion' ? 'Sin ubicación' : 'Sin unidad';
      if (mode === 'familia') return lk.category(id) || 'Sin familia';
      if (mode === 'ubicacion') return lk.location(id) || 'Sin ubicación';
      return pluralUnit(unitName.get(id) ?? lk.unit(id)) || 'Sin unidad';
    };
  }, [mode, lk]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = keyOf(productOf(r));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([id, count]) => ({ id, label: labelOf(id), count }))
      .sort((a, b) => (a.id === NONE ? 1 : b.id === NONE ? -1 : a.label.localeCompare(b.label, 'es')));
  }, [rows, keyOf, labelOf, productOf]);

  const order = useMemo(() => new Map(groups.map((g, i) => [g.id, i])), [groups]);
  const active = groups.some((g) => g.id === group) ? group : '';
  /** Filtradas por el grupo elegido y ordenadas por grupo (respetando el orden previo dentro de cada uno). */
  const shown = useMemo(() => {
    const list = active ? rows.filter((r) => keyOf(productOf(r)) === active) : rows;
    return list
      .map((r, i) => ({ r, i, g: order.get(keyOf(productOf(r))) ?? 0 }))
      .sort((a, b) => a.g - b.g || a.i - b.i)
      .map((x) => x.r);
  }, [rows, active, keyOf, productOf, order]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  return {
    mode,
    group: active,
    groups,
    shown,
    groupOf: (r: T) => keyOf(productOf(r)),
    labelOf,
    setMode: (m: GroupMode) => set({ agrupar: m === 'familia' ? '' : m, grupo: '' }),
    setGroup: (g: string) => set({ grupo: g }),
  };
}

/**
 * Agrupar por familia, ubicación o unidad. Con `children`, en la computadora los grupos van en
 * una columna a la izquierda de la lista (como un menú de categorías); en el celular, como
 * botones deslizables arriba de la lista.
 */
export function GroupBar({ mode, groups, group, total, onMode, onGroup, children, hideBar }: {
  mode: GroupMode; groups: Group[]; group: string; total: number; onMode: (m: GroupMode) => void; onGroup: (g: string) => void;
  children?: ReactNode; hideBar?: boolean;
}) {
  const bar = hideBar ? null : (
    <div className="group-bar">
      <Segmented label="Agrupar por" value={mode} onChange={onMode} options={MODES} />
      <div className="group-chips" role="group" aria-label="Grupos">
        <button type="button" className="group-chip" aria-pressed={!group} onClick={() => onGroup('')}><span className="group-chip-label">Todos</span> <span className="num">{total}</span></button>
        {groups.map((g) => (
          <button key={g.id} type="button" className="group-chip" aria-pressed={group === g.id} onClick={() => onGroup(group === g.id ? '' : g.id)}>
            <span className="group-chip-label">{g.label}</span> <span className="num">{g.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
  if (children === undefined) return bar;
  return (
    <div className={`grouped ${bar ? 'with-side' : ''}`}>
      {bar}
      <div className="grouped-main">{children}</div>
    </div>
  );
}
