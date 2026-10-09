import { Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { Lookups } from '../hooks/useData';
import type { Product, Recipe } from '../models';
import { NumberInput } from './ui';

/**
 * Receta de un producto que se elabora: cuánto rinde una tanda y qué insumos lleva.
 * Al anotar una producción se descuentan en proporción.
 */
export function RecipeEditor({ value, onChange, products, lk, selfId, unit }: {
  value?: Recipe; onChange: (r: Recipe | undefined) => void; products: Product[]; lk: Lookups; selfId?: string; unit: string;
}) {
  const listId = useId();
  const [pick, setPick] = useState('');
  const r: Recipe = value ?? { yield: 1, items: [] };
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const options = useMemo(() => products.filter((p) => p.active && p.id !== selfId && !r.items.some((i) => i.productId === p.id)), [products, selfId, r.items]);

  const update = (next: Recipe) => onChange(next.items.length ? next : undefined);
  const add = (name: string) => {
    const p = options.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    if (!p) return;
    update({ ...r, items: [...r.items, { productId: p.id, quantity: 0 }] });
    setPick('');
  };

  return (
    <fieldset className="span-all recipe" aria-label="Receta">
      <legend>Receta <span className="muted small">— opcional: al anotar una producción se descuentan estos insumos</span></legend>
      <div className="recipe-yield">
        <span>Una tanda rinde</span>
        <NumberInput aria-label="Rinde" value={r.yield} min={0} onChange={(v) => update({ ...r, yield: v && v > 0 ? v : 1 })} style={{ maxWidth: 110 }} />
        <span className="muted">{unit || 'unidades'} y lleva:</span>
      </div>
      {r.items.length > 0 && (
        <ul className="recipe-items">
          {r.items.map((i, idx) => {
            const p = byId.get(i.productId);
            return (
              <li key={i.productId}>
                <span className="grow truncate">{p?.name ?? '(producto eliminado)'}</span>
                <NumberInput
                  aria-label={`Cantidad de ${p?.name ?? 'insumo'}`}
                  value={i.quantity || undefined}
                  min={0}
                  onChange={(v) => update({ ...r, items: r.items.map((x, j) => (j === idx ? { ...x, quantity: v ?? 0 } : x)) })}
                  style={{ maxWidth: 110 }}
                />
                <span className="muted small recipe-unit">{lk.unit(p?.unitId) || 'u'}</span>
                <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Quitar ${p?.name ?? 'insumo'}`} onClick={() => update({ ...r, items: r.items.filter((_, j) => j !== idx) })}>
                  <Trash2 size={16} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="recipe-add">
        <input
          className="input"
          list={listId}
          value={pick}
          placeholder="Agregar insumo (escribí y elegí)"
          aria-label="Agregar insumo"
          onChange={(e) => {
            setPick(e.target.value);
            if (options.some((x) => x.name.toLowerCase() === e.target.value.trim().toLowerCase())) add(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(pick);
            }
          }}
        />
        <datalist id={listId}>{options.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        <button type="button" className="btn" onClick={() => add(pick)} disabled={!pick.trim()}><Plus size={16} aria-hidden /> Agregar</button>
      </div>
    </fieldset>
  );
}
