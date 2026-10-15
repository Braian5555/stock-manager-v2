import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ChefHat, ChevronRight, ClipboardCheck, History, Receipt, RotateCcw, Scale, Store,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { db } from '../../database/db';
import { EMPTY, useLookups, useProducts } from '../../hooks/useData';
import { startOfDayIso, useToday } from '../../hooks/useToday';
import type { Invoice, MovementType, Product, StockStatus } from '../../models';
import { planOf, productionFamilyIds, ymdAdd } from '../../services/bakeryService';
import { MOVEMENT_LABEL, statusOf } from '../../services/stockService';
import { useSettings } from '../../store/settings';
import { fmtDay, fmtMoney, fmtNumber, fmtSigned, fmtTime, localYmd } from '../../utils/format';

/**
 * Datos del Inicio, todos reales y en vivo (se actualizan cuando otro dispositivo anota algo):
 * panadería de hoy, vitrina, lo que hay que reponer, facturas de la semana y actividad reciente.
 */
export function useHomePanels() {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const today = useToday();
  const since = useMemo(() => startOfDayIso(today), [today]);
  const moves = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY;
  const recentMoves = useLiveQuery(() => db.movements.orderBy('createdAt').reverse().limit(12).toArray(), []) ?? EMPTY;
  const weekFrom = ymdAdd(today, -6);
  const invoices = (useLiveQuery(() => db.invoices.where('date').aboveOrEqual(weekFrom).toArray(), [weekFrom]) ?? EMPTY) as Invoice[];
  const famIds = useMemo(() => productionFamilyIds(settings, lk.categories), [settings, lk.categories]);

  return useMemo(() => {
    const undone = new Set(moves.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
    const made = new Map<string, { qty: number; last: string; by?: string }>();
    for (const m of moves) {
      if (m.type !== 'produccion' || undone.has(m.id)) continue;
      const cur = made.get(m.productId) ?? { qty: 0, last: '' };
      cur.qty += m.delta;
      if (m.createdAt > cur.last) { cur.last = m.createdAt; cur.by = m.performedBy?.name; }
      made.set(m.productId, cur);
    }
    const inFamily = (p: Product) => !famIds.size || (!!p.categoryId && famIds.has(p.categoryId));
    const active = products.filter((p) => p.active);
    const byId = new Map(products.map((p) => [p.id, p]));

    // Panadería de hoy: lo planificado y lo que se hizo (lo pendiente primero).
    const bakery = active
      .filter((p) => planOf(p, today) > 0 || made.has(p.id))
      .map((p) => ({ p, plan: planOf(p, today), made: made.get(p.id)?.qty ?? 0, last: made.get(p.id) }))
      .sort((a, b) => Number(a.plan > 0 && a.made >= a.plan) - Number(b.plan > 0 && b.made >= b.plan) || (b.last?.last ?? '').localeCompare(a.last?.last ?? '') || a.p.name.localeCompare(b.p.name, 'es'));

    // Vitrina: lo producido que todavía queda.
    const showcase = active.filter((p) => made.has(p.id) || (p.stock > 0 && inFamily(p)));
    const available = showcase.filter((p) => p.stock > 0).sort((a, b) => (made.get(b.id)?.last ?? '').localeCompare(made.get(a.id)?.last ?? '') || a.name.localeCompare(b.name, 'es'));
    const soldOut = showcase.filter((p) => p.stock <= 0);

    // Para reponer: por debajo del mínimo o en negativo. Primero lo negativo y lo que usan las recetas.
    const inRecipes = new Set(active.flatMap((p) => p.recipe?.items.map((i) => i.productId) ?? []));
    const restock = active
      .filter((p) => p.stock < 0 || (p.minStock > 0 && p.stock <= p.minStock))
      .map((p) => ({ p, recipe: inRecipes.has(p.id), level: (p.stock < 0 ? 'neg' : p.stock <= 0 ? 'out' : p.stock <= p.minStock * settings.criticalRatio ? 'crit' : 'low') as RestockLevel }))
      .sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || Number(b.recipe) - Number(a.recipe) || a.p.name.localeCompare(b.p.name, 'es'));

    // Estado general del stock (para la barra de la tarjeta "Para reponer").
    const health: Record<StockStatus, number> = { normal: 0, bajo: 0, critico: 0, sin_stock: 0 };
    for (const p of active) health[statusOf(p, settings)]++;

    const week = [...invoices].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const recentUndone = new Set(recentMoves.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
    const activity = recentMoves
      .filter((m) => !m.idempotencyKey?.startsWith('undo:') && !recentUndone.has(m.id))
      .map((m) => ({ m, name: byId.get(m.productId)?.name ?? m.productName ?? '(producto eliminado)', unit: lk.unit(byId.get(m.productId)?.unitId) }));

    return {
      lk,
      today,
      activeCount: active.length,
      bakery,
      planned: bakery.filter((b) => b.plan > 0).length,
      madeUnits: bakery.reduce((s, b) => s + b.made, 0),
      madeProducts: bakery.filter((b) => b.made > 0).length,
      done: bakery.filter((b) => b.plan > 0 && b.made >= b.plan).length,
      available,
      soldOut,
      restock,
      negatives: restock.filter((r) => r.level === 'neg').length,
      health,
      week,
      weekTotal: week.reduce((s, i) => s + (i.total ?? 0), 0),
      activity,
    };
  }, [moves, recentMoves, products, invoices, famIds, today, lk, settings]);
}

export type HomePanels = ReturnType<typeof useHomePanels>;
type RestockLevel = 'neg' | 'out' | 'crit' | 'low';
const LEVEL_ORDER: Record<RestockLevel, number> = { neg: 0, out: 1, crit: 2, low: 3 };
const LEVEL_LABEL: Record<RestockLevel, string> = { neg: 'Negativo', out: 'Sin stock', crit: 'Crítico', low: 'Bajo' };

// ───────────────────────── Piezas comunes ─────────────────────────

export type Tone = 'petrol' | 'emerald' | 'blue' | 'amber' | 'slate' | 'rose';

/** Tarjeta de sección del Inicio: icono con color, título, acción y contenido. */
function Panel({ id, icon: Icon, tone, title, action, children, className = '' }: {
  id: string; icon: LucideIcon; tone: Tone; title: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`hm-panel ${className}`} aria-labelledby={id}>
      <header className="hm-panel-head">
        <span className={`hm-chip tone-${tone}`}><Icon size={17} aria-hidden /></span>
        <h2 id={id}>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

const PanelLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="hm-panel-link">{children} <ChevronRight size={15} aria-hidden /></Link>
);

const Empty = ({ children }: { children: ReactNode }) => <p className="hm-empty">{children}</p>;

const More = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="hm-more">{children} <ChevronRight size={15} aria-hidden /></Link>
);

// ───────────────────────── Secciones ─────────────────────────

export function BakeryTodayCard({ d, limit = 7 }: { d: HomePanels; limit?: number }) {
  return (
    <Panel id="home-panaderia" icon={ChefHat} tone="emerald" title="Panadería de hoy" action={<PanelLink to="/produccion">Producción</PanelLink>}>
      {d.bakery.length === 0 ? (
        <Empty>Todavía no hay plan ni producción anotada hoy.</Empty>
      ) : (
        <ul className="hm-list">
          {d.bakery.slice(0, limit).map(({ p, plan, made, last }) => {
            const pct = plan > 0 ? Math.min(100, Math.round((made / plan) * 100)) : 0;
            const unit = d.lk.unit(p.unitId) || 'u';
            const done = plan > 0 && made >= plan;
            return (
              <li key={p.id} className="hm-row">
                <div className="grow">
                  <div className="hm-row-title truncate">{p.name}</div>
                  <div className="hm-row-sub">{last ? `${fmtTime(last.last)}${last.by ? ` · ${last.by}` : ''}` : 'Sin anotar todavía'}</div>
                  {plan > 0 && <div className="hm-bar" aria-hidden><span className={done ? 'is-done' : ''} style={{ width: `${Math.max(pct, made > 0 ? 4 : 0)}%` }} /></div>}
                </div>
                <div className="hm-row-value">
                  <strong className="num">{fmtNumber(made)}</strong>
                  <span>{plan > 0 ? `de ${fmtNumber(plan)} ${unit}` : unit}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {d.bakery.length > limit && <More to="/produccion">Ver los {d.bakery.length} productos</More>}
    </Panel>
  );
}

export function ShowcaseCard({ d, limit = 6 }: { d: HomePanels; limit?: number }) {
  return (
    <Panel
      id="home-vitrina" icon={Store} tone="blue" title="Vitrina"
      action={<span className="row">{d.soldOut.length > 0 && <span className="hm-tag tone-rose">{d.soldOut.length} {d.soldOut.length === 1 ? 'agotado' : 'agotados'}</span>}<PanelLink to="/vitrina">Abrir</PanelLink></span>}
    >
      {d.available.length === 0 ? (
        <Empty>{d.soldOut.length ? 'Se agotó todo lo de hoy.' : 'No queda nada en la vitrina.'}</Empty>
      ) : (
        <ul className="hm-tiles">
          {d.available.slice(0, limit).map((p) => (
            <li key={p.id}>
              <Link to="/vitrina" className="hm-tile">
                <span className="hm-tile-name">{p.name}</span>
                <span className="hm-tile-qty"><strong className="num">{fmtNumber(p.stock)}</strong> {d.lk.unit(p.unitId) || 'u'}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {d.available.length > limit && <More to="/vitrina">Ver los {d.available.length} productos</More>}
    </Panel>
  );
}

export function RestockCard({ d, limit = 6 }: { d: HomePanels; limit?: number }) {
  return (
    <Panel id="home-reponer" icon={AlertTriangle} tone="amber" title="Para reponer" action={d.restock.length > 0 ? <PanelLink to="/stock?estado=bajo">Ver en Stock</PanelLink> : undefined} className="hm-alerts">
      {d.restock.length === 0 ? (
        <Empty>Nada por debajo del mínimo.</Empty>
      ) : (
        <ul className="hm-list">
          {d.restock.slice(0, limit).map(({ p, recipe, level }) => {
            const unit = d.lk.unit(p.unitId);
            return (
              <li key={p.id}>
                <Link to={`/stock?q=${encodeURIComponent(p.name)}`} className={`hm-row hm-alert lvl-${level}`}>
                  <span className="hm-dot" aria-hidden />
                  <div className="grow">
                    <div className="hm-row-title truncate">{p.name}</div>
                    <div className="hm-row-sub">{LEVEL_LABEL[level]}{p.minStock > 0 ? ` · mín. ${fmtNumber(p.minStock)} ${unit}` : ''}{recipe ? ' · insumo de receta' : ''}</div>
                  </div>
                  <div className="hm-row-value">
                    <strong className="num">{fmtNumber(p.stock)}</strong>
                    <span>{unit}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {d.restock.length > limit && <More to="/stock?estado=bajo">Ver los {d.restock.length} productos</More>}
    </Panel>
  );
}

export function InvoicesWeekCard({ d, limit = 5 }: { d: HomePanels; limit?: number }) {
  const lk = useLookups();
  return (
    <Panel id="home-facturas" icon={Receipt} tone="petrol" title="Facturas de la semana" action={<PanelLink to="/facturas">Ver todas</PanelLink>}>
      {d.week.length === 0 ? (
        <Empty>No se cargaron facturas en los últimos 7 días.</Empty>
      ) : (
        <>
          <div className="hm-total">
            <span className="num">{fmtMoney(d.weekTotal)}</span>
            <span>en {d.week.length} {d.week.length === 1 ? 'factura' : 'facturas'}</span>
          </div>
          <ul className="hm-list">
            {d.week.slice(0, limit).map((i) => (
              <li key={i.id}>
                <Link to="/facturas" className="hm-row">
                  <div className="grow">
                    <div className="hm-row-title truncate">{lk.supplier(i.supplierId) || 'Sin proveedor'}</div>
                    <div className="hm-row-sub">{fmtDay(i.date)}{i.number ? ` · ${i.number}` : ''}</div>
                  </div>
                  <strong className="num">{fmtMoney(i.total)}</strong>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.week.length > limit && <More to="/facturas">Ver las {d.week.length} facturas</More>}
    </Panel>
  );
}

const MOVE_LOOK: Record<MovementType, { icon: LucideIcon; tone: Tone }> = {
  ingreso: { icon: ArrowDownToLine, tone: 'emerald' },
  devolucion: { icon: RotateCcw, tone: 'emerald' },
  produccion: { icon: ChefHat, tone: 'blue' },
  salida: { icon: ArrowUpFromLine, tone: 'amber' },
  consumo: { icon: ArrowUpFromLine, tone: 'slate' },
  perdida: { icon: ArrowUpFromLine, tone: 'rose' },
  ajuste: { icon: Scale, tone: 'petrol' },
  conteo: { icon: ClipboardCheck, tone: 'petrol' },
};

export function ActivityCard({ d, limit = 8, showLink }: { d: HomePanels; limit?: number; showLink: boolean }) {
  // Hoy: sólo la hora. Otro día: fecha y hora.
  const when = (iso: string) => (localYmd(iso) === d.today ? fmtTime(iso) : `${fmtDay(localYmd(iso))} ${fmtTime(iso)}`);
  return (
    <Panel id="home-actividad" icon={History} tone="slate" title="Actividad reciente" action={showLink ? <PanelLink to="/movimientos">Movimientos</PanelLink> : undefined}>
      {d.activity.length === 0 ? (
        <Empty>Los ingresos, producciones, salidas y conteos van a aparecer acá.</Empty>
      ) : (
        <ol className="hm-timeline">
          {d.activity.slice(0, limit).map(({ m, name, unit }) => {
            const look = MOVE_LOOK[m.type] ?? MOVE_LOOK.ajuste;
            const Icon = look.icon;
            return (
              <li key={m.id} className="hm-event">
                <span className={`hm-event-icon tone-${look.tone}`}><Icon size={15} aria-hidden /></span>
                <div className="grow">
                  <div className="hm-row-title truncate">{name}</div>
                  <div className="hm-row-sub">{MOVEMENT_LABEL[m.type]} · {when(m.createdAt)}{m.performedBy?.name ? ` · ${m.performedBy.name}` : ''}</div>
                </div>
                <strong className={`num hm-delta ${m.delta >= 0 ? 'is-up' : 'is-down'}`}>{fmtSigned(m.delta)}{unit ? ` ${unit}` : ''}</strong>
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}
