import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Check, ChefHat, Pencil, Search, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { db } from '../database/db';
import { EMPTY, useLookups, useProducts } from '../hooks/useData';
import type { Product, StockMovement } from '../models';
import { recipeConsumption, registerProduction, undoProduction } from '../services/productionService';
import { useFeedback } from '../store/feedback';
import { PageHeader, Segmented } from '../components/ui';
import { RecipeModal } from '../components/RecipeModal';
import { useSession } from '../store/session';
import { Modal } from '../components/ui/Modal';
import { Stepper } from '../components/Stepper';
import { fmtNumber, matches, round3 } from '../utils/format';

const FREQUENT = '__frecuentes';
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

/** Botones rápidos según la unidad: de a docenas para unidades, de a medio kilo para kilos. */
function quickSteps(unit: string): number[] {
  const u = unit.toLowerCase();
  if (u === 'kg' || u === 'l') return [0.5, 1, 5];
  if (u === 'g' || u === 'ml') return [100, 250, 500];
  return [1, 6, 12, 24];
}

/**
 * Producción: pantalla pensada para el panadero / cocinero. Toca lo que hizo, pone cuánto
 * y listo — suma al stock como movimiento "Producción" con su nombre.
 */
export function ProductionPage() {
  const products = useProducts();
  const lk = useLookups();
  const { run, notify } = useFeedback();
  const [q, setQ] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const [qty, setQty] = useState<number | undefined>(undefined);
  // Quien administra el catálogo puede ver y editar las recetas desde acá; el panadero sólo anota.
  const { can } = useSession();
  const canEdit = can('catalog.manage');
  const [view, setView] = useState<'anotar' | 'recetas'>('anotar');
  const [editing, setEditing] = useState<Product | null>(null);
  const [rq, setRq] = useState('');

  const since = useMemo(startOfToday, []);
  const history = useLiveQuery(() => db.movements.where('type').equals('produccion').toArray(), []) ?? EMPTY;
  const undone = useLiveQuery(() => db.movements.where('type').equals('ajuste').filter((m) => m.origin === 'deshacer').toArray(), []) ?? EMPTY;
  const undoneKeys = useMemo(() => new Set(undone.map((m) => m.idempotencyKey)), [undone]);
  const today = useMemo(
    () => history.filter((m) => m.createdAt >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [history, since],
  );

  const active = useMemo(() => products.filter((p) => p.active).sort((a, b) => a.name.localeCompare(b.name, 'es')), [products]);
  // "Lo de siempre": lo que más se produjo (sin contar lo deshecho).
  const frequent = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of history) if (!undoneKeys.has(`undo:${m.id}`)) n.set(m.productId, (n.get(m.productId) ?? 0) + 1);
    return active.filter((p) => n.has(p.id)).sort((a, b) => n.get(b.id)! - n.get(a.id)! || a.name.localeCompare(b.name, 'es'));
  }, [history, undoneKeys, active]);
  const families = useMemo(() => {
    const used = new Set(active.map((p) => p.categoryId).filter(Boolean));
    return lk.categories.filter((c) => used.has(c.id)).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [active, lk.categories]);

  const defaultChip = frequent.length ? FREQUENT : (families.find((c) => /panader/i.test(c.name))?.id ?? families[0]?.id ?? '');
  const current = chip ?? defaultChip;
  const list = q.trim()
    ? active.filter((p) => matches(q, p.name, p.sku))
    : current === FREQUENT ? frequent : active.filter((p) => p.categoryId === current);

  const open = (p: Product) => {
    setPicked(p);
    setQty(undefined);
  };
  const unitOf = (p: Product) => lk.unit(p.unitId) || 'u';
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const save = async () => {
    if (!picked || !qty || qty <= 0) return;
    const p = picked;
    const amount = round3(qty);
    const r = await run(() => registerProduction(p.id, amount));
    if (!r) return;
    setPicked(null);
    const extra = r.consumed.length ? ` · se descontaron ${r.consumed.length} ${r.consumed.length === 1 ? 'insumo' : 'insumos'}` : '';
    notify(`Anotado: ${fmtNumber(amount)} ${unitOf(p)} de ${p.name}${extra}`, { undo: () => void undoProduction(r.movement) });
  };

  const undo = async (m: StockMovement) => {
    const r = await run(() => undoProduction(m).then(() => true));
    if (r) notify('Producción deshecha: se devolvieron los insumos');
  };

  return (
    <div className="production">
      <PageHeader
        title="Producción"
        subtitle={new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={canEdit ? <Segmented label="Vista" value={view} onChange={setView} options={[{ value: 'anotar', label: 'Anotar' }, { value: 'recetas', label: 'Recetas' }]} /> : undefined}
      />

      {view === 'recetas' ? (
        <RecipeList products={active} lk={lk} q={rq} onQ={setRq} onEdit={setEditing} />
      ) : (<>

      <label className="production-search">
        <Search size={20} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar qué hiciste" aria-label="Buscar producto" />
      </label>

      {!q.trim() && (
        <div className="group-chips" role="group" aria-label="Qué mostrar">
          {frequent.length > 0 && (
            <button type="button" className="group-chip" aria-pressed={current === FREQUENT} onClick={() => setChip(FREQUENT)}>Lo de siempre</button>
          )}
          {families.map((c) => (
            <button key={c.id} type="button" className="group-chip" aria-pressed={current === c.id} onClick={() => setChip(c.id)}>{c.name}</button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <p className="muted production-empty">{q.trim() ? 'No hay productos con ese nombre.' : 'No hay productos en esta familia.'}</p>
      ) : (
        <div className="production-grid" role="list" aria-label="Productos">
          {list.slice(0, 120).map((p) => (
            <button key={p.id} type="button" role="listitem" className="production-tile" onClick={() => open(p)}>
              <span className="production-tile-name">{p.name}</span>
              <span className="production-tile-unit">{unitOf(p)}</span>
            </button>
          ))}
        </div>
      )}

      <section className="card production-today" aria-labelledby="hoy">
        <div className="card-head">
          <h2 id="hoy" className="row"><ChefHat size={18} aria-hidden /> Anotado hoy</h2>
          <span className="small muted">{today.filter((m) => !undoneKeys.has(`undo:${m.id}`)).length} registros</span>
        </div>
        {today.length === 0 ? (
          <p className="muted small card-body">Todavía no se anotó producción hoy.</p>
        ) : (
          <div className="list">
            {today.map((m) => {
              const gone = undoneKeys.has(`undo:${m.id}`);
              const p = products.find((x) => x.id === m.productId);
              return (
                <div key={m.id} className={`list-item ${gone ? 'production-undone' : ''}`}>
                  <div className="grow">
                    <div className="list-title truncate">{m.productName ?? p?.name ?? '(producto eliminado)'}</div>
                    <div className="list-sub">
                      {new Date(m.createdAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                      {m.performedBy?.name ? ` · ${m.performedBy.name}` : ''}{gone ? ' · deshecho' : ''}
                    </div>
                  </div>
                  <strong className="num">+{fmtNumber(m.delta)} {p ? unitOf(p) : ''}</strong>
                  {!gone && (
                    <button type="button" className="btn btn-sm btn-ghost icon-btn" aria-label={`Deshacer ${m.productName ?? ''}`} title="Deshacer" onClick={() => undo(m)}>
                      <Undo2 size={16} aria-hidden />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      </>)}

      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={picked?.name ?? ''}
        footer={
          <button type="button" className="btn btn-primary btn-block production-save" disabled={!qty || qty <= 0} onClick={save}>
            <Check size={20} aria-hidden /> Anotar {qty ? `${fmtNumber(qty)} ${picked ? unitOf(picked) : ''}` : ''}
          </button>
        }
      >
        {picked && (
          <div className="production-sheet">
            <p className="muted">¿Cuánto hiciste? ({unitOf(picked)})</p>
            <Stepper label={picked.name} value={qty} onChange={setQty} />
            <div className="production-quick">
              {quickSteps(unitOf(picked)).map((n) => (
                <button key={n} type="button" className="btn" onClick={() => setQty(round3((qty ?? 0) + n))}>+{fmtNumber(n)}</button>
              ))}
            </div>
            {picked.recipe?.items.length ? (
              <div className="production-uses" aria-live="polite">
                <div className="small muted">{qty ? 'Se descuenta del stock:' : 'Según la receta se descuenta:'}</div>
                <ul>
                  {(qty ? recipeConsumption(picked, qty, byId) : picked.recipe.items.map((i) => ({ productId: i.productId, name: byId.get(i.productId)?.name ?? '?', quantity: i.quantity }))).map((c) => (
                    <li key={c.productId}><span className="grow">{c.name}</span> <b className="num">{fmtNumber(c.quantity)} {lk.unit(byId.get(c.productId)?.unitId)}</b></li>
                  ))}
                </ul>
                {!qty && <div className="small muted">(por tanda de {fmtNumber(picked.recipe.yield)} {unitOf(picked)})</div>}
              </div>
            ) : (
              <p className="small muted">Este producto no tiene receta: sólo se suma lo producido.</p>
            )}
            {canEdit && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(picked); setPicked(null); }}>
                <Pencil size={15} aria-hidden /> {picked.recipe?.items.length ? 'Editar receta' : 'Cargar receta'}
              </button>
            )}
          </div>
        )}
      </Modal>
      <RecipeModal product={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

/** Todas las recetas: buscar un producto y tocarlo para ver o cambiar su receta. */
function RecipeList({ products, lk, q, onQ, onEdit }: {
  products: Product[]; lk: ReturnType<typeof useLookups>; q: string; onQ: (v: string) => void; onEdit: (p: Product) => void;
}) {
  const withRecipe = products.filter((p) => p.recipe?.items.length);
  const list = q.trim()
    ? products.filter((p) => matches(q, p.name, p.sku)).sort((a, b) => Number(!!b.recipe?.items.length) - Number(!!a.recipe?.items.length))
    : withRecipe;
  return (
    <div className="stack">
      <label className="production-search">
        <Search size={20} aria-hidden />
        <input type="search" value={q} onChange={(e) => onQ(e.target.value)} placeholder="Buscar producto para ver o cargar su receta" aria-label="Buscar receta" />
      </label>
      <p className="small muted">{withRecipe.length} productos con receta. Buscá cualquier producto para cargarle una.</p>
      <div className="card list">
        {list.slice(0, 150).map((p) => {
          const n = p.recipe?.items.length ?? 0;
          return (
            <button key={p.id} type="button" className="list-item" onClick={() => onEdit(p)}>
              <BookOpen size={18} aria-hidden className="muted" />
              <span className="grow">
                <span className="list-title">{p.name}</span>
                <span className="list-sub" style={{ display: 'block' }}>
                  {n ? `Rinde ${fmtNumber(p.recipe!.yield)} ${lk.unit(p.unitId) || 'u'} · ${n} ${n === 1 ? 'insumo' : 'insumos'}` : 'Sin receta: tocá para cargarla'}
                </span>
              </span>
              <Pencil size={16} aria-hidden className="muted" />
            </button>
          );
        })}
        {list.length === 0 && <p className="muted small card-pad">{q.trim() ? 'No hay productos con ese nombre.' : 'Todavía no hay recetas.'}</p>}
      </div>
    </div>
  );
}
