import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, Check, ChefHat, Pencil, Search, Tags, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../database/db';
import { EMPTY, useLookups, useProducts } from '../hooks/useData';
import type { Product, StockMovement } from '../models';
import { recipeConsumption, registerProduction, undoProduction } from '../services/productionService';
import { useFeedback } from '../store/feedback';
import { PageHeader, Segmented } from '../components/ui';
import { RecipeModal } from '../components/RecipeModal';
import { PlanView, SummaryView } from '../components/bakery/BakeryViews';
import { productionFamilyIds } from '../services/bakeryService';
import { updateSettings } from '../services/settingsService';
import { useSettings } from '../store/settings';
import { useSession } from '../store/session';
import { Modal } from '../components/ui/Modal';
import { Stepper } from '../components/Stepper';
import { fmtNumber, fmtTime, matches, round3 } from '../utils/format';

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
  // Recetas: quien administra el catálogo o tiene el permiso "recetas" (p. ej. el jefe de panadería).
  // Plan (armarlo) y resumen: el encargado. Qué familias se ven: el administrador.
  const { can, canAny } = useSession();
  const settings = useSettings();
  const canEdit = can('catalog.manage');
  const canRecipes = canAny(['catalog.manage', 'recipes']);
  const [famOpen, setFamOpen] = useState(false);
  type View = 'anotar' | 'plan' | 'resumen' | 'recetas';
  const [view, setView] = useState<View>('anotar');
  const views: { value: View; label: string }[] = [
    { value: 'anotar', label: 'Anotar' },
    { value: 'plan', label: 'Plan' },
    ...(canEdit ? [{ value: 'resumen' as View, label: 'Resumen' }] : []),
    ...(canRecipes ? [{ value: 'recetas' as View, label: 'Recetas' }] : []),
  ];
  // Movimientos de los últimos dos meses (plan y resumen).
  const twoMonthsAgo = useMemo(() => new Date(Date.now() - 62 * 86_400_000).toISOString(), []);
  const recent = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(twoMonthsAgo).toArray(), [twoMonthsAgo]) ?? EMPTY;
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

  // Sólo los productos de las familias de producción (panadería, pastelería…): nada de bebidas
  // ni verduras. Si ninguna familia coincide, se muestran todos para no dejar la pantalla vacía.
  const famIds = useMemo(() => productionFamilyIds(settings, lk.categories), [settings, lk.categories]);
  const active = useMemo(
    () => products.filter((p) => p.active && (!famIds.size || (p.categoryId && famIds.has(p.categoryId)))).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [products, famIds],
  );
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

  const open = (p: Product, initial?: number) => {
    setPicked(p);
    setQty(initial && initial > 0 ? initial : undefined);
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
        actions={<>
          {can('admin') && <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFamOpen(true)}><Tags size={16} aria-hidden /> Familias</button>}
          <Segmented label="Vista" value={view} onChange={setView} options={views} />
        </>}
      />

      {view === 'recetas' ? (
        <RecipeList products={active} lk={lk} q={rq} onQ={setRq} onEdit={setEditing} />
      ) : view === 'plan' ? (
        <PlanView products={active} lk={lk} movements={recent} canEdit={canEdit} onPick={(p, remaining) => open(p, remaining)} />
      ) : view === 'resumen' ? (
        <SummaryView products={products} lk={lk} movements={recent} />
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
                      {fmtTime(m.createdAt)}
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
            {canRecipes && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(picked); setPicked(null); }}>
                <Pencil size={15} aria-hidden /> {picked.recipe?.items.length ? 'Editar receta' : 'Cargar receta'}
              </button>
            )}
          </div>
        )}
      </Modal>
      <RecipeModal product={editing} onClose={() => setEditing(null)} />
      <FamiliesModal open={famOpen} onClose={() => setFamOpen(false)} current={famIds} />
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

/** Elegir qué familias aparecen en Producción (sólo administradores). */
function FamiliesModal({ open, onClose, current }: { open: boolean; onClose: () => void; current: Set<string> }) {
  const lk = useLookups();
  const products = useProducts();
  const { run } = useFeedback();
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open) setSel(new Set(current));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- copiar al abrir
  const count = (id: string) => products.filter((p) => p.active && p.categoryId === id).length;
  const recipes = (id: string) => products.filter((p) => p.active && p.categoryId === id && p.recipe?.items.length).length;
  const toggle = (id: string, on: boolean) => setSel((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  const save = async () => {
    const ok = await run(() => updateSettings({ productionCategoryIds: [...sel] }).then(() => true), 'Familias de producción guardadas');
    if (ok) onClose();
  };
  return (
    <Modal open={open} title="Familias de producción" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" disabled={!sel.size} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <p className="small muted">Producción (anotar, plan y recetas) muestra sólo los productos de estas familias. Así el panadero no ve bebidas, verduras ni el resto del depósito. Los insumos de las recetas se eligen igual de cualquier familia.</p>
        <div className="list">
          {[...lk.categories].sort((a, b) => a.name.localeCompare(b.name, 'es')).map((c) => (
            <label key={c.id} className="list-item check">
              <input type="checkbox" checked={sel.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} aria-label={`Mostrar ${c.name} en Producción`} />
              <span className="grow">{c.name}</span>
              <span className="small muted num">{count(c.id)} productos{recipes(c.id) ? ` · ${recipes(c.id)} con receta` : ''}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}
