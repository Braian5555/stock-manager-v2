import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronRight, ClipboardList, ListTodo, MinusCircle, Receipt, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../../database/db';
import { EMPTY, useLookups, useProducts } from '../../hooks/useData';
import type { InventoryCount, Invoice, Product, StockMovement } from '../../models';
import { explainNegative, familiesDue, negativeProducts, pendingInvoices, staleCounts, STALE_COUNT_DAYS } from '../../services/attentionService';
import { startCount } from '../../services/countService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtMoney, fmtNumber } from '../../utils/format';
import { recipesGettingPricier } from '../../services/costService';
import { recipesOn } from '../../services/settingsService';
import { useSettings } from '../../store/settings';
import { Modal } from '../ui/Modal';

/**
 * Inicio → "Para resolver": negativos (con el porqué), facturas sin cargar al stock, conteos colgados
 * y el conteo semanal. Cada renglón lleva a resolverlo en un toque.
 */
export function AttentionCard({ hideNegatives = false, negOpen: negOpenProp, onNegOpen }: {
  /** El Inicio ya muestra los negativos en su propio recuadro: no repetir el renglón. */
  hideNegatives?: boolean;
  /** Abrir la lista de negativos desde afuera (el recuadro del Inicio). */
  negOpen?: boolean;
  onNegOpen?: (open: boolean) => void;
} = {}) {
  const products = useProducts();
  const lk = useLookups();
  const { can } = useSession();
  const { run } = useFeedback();
  const navigate = useNavigate();
  const invoices = (useLiveQuery(() => db.invoices.toArray(), []) ?? EMPTY) as Invoice[];
  const counts = (useLiveQuery(() => db.counts.toArray(), []) ?? EMPTY) as InventoryCount[];
  // Conteos del último mes alcanzan para saber qué familia se contó esta semana.
  const since = useMemo(() => new Date(Date.now() - 35 * 86_400_000).toISOString(), []);
  const countMoves = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).filter((m) => m.origin === 'conteo').toArray(), [since]) ?? EMPTY;
  const [negOpenOwn, setNegOpenOwn] = useState(false);
  const negOpen = negOpenProp ?? negOpenOwn;
  const setNegOpen = onNegOpen ?? setNegOpenOwn;
  const [costOpen, setCostOpen] = useState(false);
  const seeCosts = can('catalog.manage') || can('invoices') || can('admin');
  const withRecipes = recipesOn(useSettings());
  const pricier = useMemo(() => (seeCosts && withRecipes ? recipesGettingPricier(products, invoices) : []), [products, invoices, seeCosts, withRecipes]);

  const negatives = useMemo(() => negativeProducts(products), [products]);
  const pending = useMemo(() => (can('invoices') ? pendingInvoices(invoices) : []), [invoices, can]);
  const stale = useMemo(() => (can('count.do') ? staleCounts(counts) : []), [counts, can]);
  const due = useMemo(() => (can('count.do') ? familiesDue(products, lk.categories, countMoves) : []), [products, lk.categories, countMoves, can]);

  const countThese = async (ids: string[], name: string) => {
    const c = await run(() => startCount({ name, productIds: ids }));
    if (c) navigate(`/conteo/${c.id}`);
  };
  // Conteo de la semana: de a 3 familias por vez (las que hace más que no se cuentan), para que sea corto.
  const weekly = due.slice(0, 3);
  const rows = [
    negatives.length > 0 && !hideNegatives && (
      <li key="neg"><button type="button" className="hm-row" onClick={() => setNegOpen(true)}>
        <MinusCircle size={18} aria-hidden className="neg" />
        <div className="grow"><div className="hm-row-title">{negatives.length} {negatives.length === 1 ? 'producto en negativo' : 'productos en negativo'}</div><div className="hm-row-sub">Tocá para ver por qué quedaron así</div></div>
        <ChevronRight size={16} aria-hidden />
      </button></li>
    ),
    pending.length > 0 && (
      <li key="inv"><Link to="/facturas?stock=pendiente" className="hm-row">
        <Receipt size={18} aria-hidden />
        <div className="grow"><div className="hm-row-title">{pending.length} {pending.length === 1 ? 'factura sin cargar' : 'facturas sin cargar'} al stock</div><div className="hm-row-sub">Si la mercadería entró, cargala: si no, el stock queda corto</div></div>
        <ChevronRight size={16} aria-hidden />
      </Link></li>
    ),
    stale.length > 0 && (
      <li key="cnt"><Link to="/conteo" className="hm-row">
        <ClipboardList size={18} aria-hidden />
        <div className="grow"><div className="hm-row-title">{stale.length} {stale.length === 1 ? 'conteo abierto' : 'conteos abiertos'} hace más de {STALE_COUNT_DAYS} días</div><div className="hm-row-sub">{stale.map((c) => c.name).join(' · ')}: terminalos o descartalos</div></div>
        <ChevronRight size={16} aria-hidden />
      </Link></li>
    ),
    pricier.length > 0 && (
      <li key="cost"><button type="button" className="hm-row" onClick={() => setCostOpen(true)}>
        <TrendingUp size={18} aria-hidden className="neg" />
        <div className="grow"><div className="hm-row-title">{pricier.length} {pricier.length === 1 ? 'receta se encareció' : 'recetas se encarecieron'}</div><div className="hm-row-sub">{pricier.slice(0, 3).map((r) => `${r.name} +${r.pct}%`).join(' · ')}</div></div>
        <ChevronRight size={16} aria-hidden />
      </button></li>
    ),
    weekly.length > 0 && (
      <li key="week"><button type="button" className="hm-row" onClick={() => void countThese(weekly.flatMap((f) => f.products.map((p) => p.id)), `Conteo semanal: ${weekly.map((f) => f.category.name).join(', ')}`)}>
        <ListTodo size={18} aria-hidden />
        <div className="grow">
          <div className="hm-row-title">Conteo semanal: {weekly.map((f) => f.category.name).join(', ')}</div>
          <div className="hm-row-sub">{weekly.reduce((s, f) => s + f.products.length, 0)} productos · {weekly[0].lastCounted ? `sin contar desde el ${new Date(weekly[0].lastCounted).toLocaleDateString('es-AR')}` : 'nunca se contaron'}{due.length > 3 ? ` · después siguen ${due.length - 3} familias más` : ''}. Tocá para empezar</div>
        </div>
        <ChevronRight size={16} aria-hidden />
      </button></li>
    ),
  ].filter(Boolean);
  const negModal = (
    <NegativesModal open={negOpen} products={negatives} onClose={() => setNegOpen(false)} canCount={can('count.do')}
      onCount={(ids) => { setNegOpen(false); void countThese(ids, 'Conteo de negativos'); }} />
  );
  if (!rows.length) return negModal;

  return (
    <section className="hm-panel" aria-labelledby="home-resolver">
      <header className="hm-panel-head">
        <span className="hm-chip tone-rose"><ListTodo size={17} aria-hidden /></span>
        <h2 id="home-resolver">Para resolver</h2>
      </header>
      <ul className="hm-list">{rows}</ul>
      <Modal open={costOpen} title="Recetas que se encarecieron" onClose={() => setCostOpen(false)} footer={<button type="button" className="btn" onClick={() => setCostOpen(false)}>Cerrar</button>}>
        <p className="small muted" style={{ marginTop: 0 }}>Costo por unidad con el último precio de cada insumo, contra la compra anterior.</p>
        <ul className="neg-list">
          {pricier.map((r) => (
            <li key={r.productId}>
              <div className="row between"><b className="truncate">{r.name}</b><span className="num neg">+{r.pct}%</span></div>
              <div className="small muted">{r.previousPerUnit !== undefined ? `${fmtMoney(r.previousPerUnit)} → ` : ''}<b>{fmtMoney(r.perUnit)}</b> por unidad{r.missing.length ? ` · sin precio: ${r.missing.join(', ')}` : ''}</div>
            </li>
          ))}
        </ul>
      </Modal>
      {negModal}
    </section>
  );
}

function NegativesModal({ open, products, onClose, onCount, canCount }: { open: boolean; products: Product[]; onClose: () => void; onCount: (ids: string[]) => void; canCount: boolean }) {
  const lk = useLookups();
  const ids = useMemo(() => products.map((p) => p.id), [products]);
  const moves = useLiveQuery(async (): Promise<StockMovement[]> => (open ? db.movements.where('productId').anyOf(ids).toArray() : []), [open, ids.join('|')]) ?? EMPTY;
  return (
    <Modal open={open} wide title={`${products.length} ${products.length === 1 ? 'producto en negativo' : 'productos en negativo'}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cerrar</button>
        {canCount && <button type="button" className="btn btn-primary" onClick={() => onCount(ids)}>Contar estos {products.length}</button>}
      </>}>
      <p className="small muted" style={{ marginTop: 0 }}>Un stock negativo quiere decir que salió más de lo que figuraba. Casi siempre falta cargar una compra (factura) o hacer un conteo.</p>
      <ul className="neg-list">
        {products.map((p) => {
          const r = explainNegative(p, moves);
          return (
            <li key={p.id}>
              <div className="row between" style={{ gap: 8 }}>
                <b className="truncate">{p.name}</b>
                <span className="num neg">{fmtNumber(p.stock)} {lk.unit(p.unitId)}</span>
              </div>
              <div className="small muted">{lk.category(p.categoryId) || 'Sin familia'}{r.lastPurchase ? ` · última compra ${new Date(r.lastPurchase).toLocaleDateString('es-AR')}` : ' · sin compras cargadas'}</div>
              <div className="small">{r.summary}</div>
              <Link className="small" to={`/movimientos?producto=${p.id}`} onClick={onClose}>Ver movimientos</Link>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
