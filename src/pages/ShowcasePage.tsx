import { useLiveQuery } from 'dexie-react-hooks';
import { ChefHat, ClipboardCheck, Minus, Search, Snowflake } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { db } from '../database/db';
import { EMPTY, useLookups, useOutlets, useProducts } from '../hooks/useData';
import { startOfDayIso, useToday } from '../hooks/useToday';
import type { Product } from '../models';
import { productionFamilyIds } from '../services/bakeryService';
import { applyMovement, revertMovement } from '../services/stockService';
import { useFeedback } from '../store/feedback';
import { useSession } from '../store/session';
import { startCount } from '../services/countService';
import { useSettings } from '../store/settings';
import { PageHeader, Segmented } from '../components/ui';
import { Modal } from '../components/ui/Modal';
import { Stepper } from '../components/Stepper';
import { fmtNumber, fmtTime, matches, round3 } from '../utils/format';

/** Motivos de las salidas de la cámara (y los de la vieja "Vitrina", para el historial). */
export const OVEN_REASON = 'Cámara: al horno · Desayunos';
export const WASTE_REASON = 'Cámara: merma';
const toOutlet = (name: string) => `Cámara: a ${name}`;
const isOut = (reason?: string) => !!reason && (reason.startsWith('Cámara:') || reason.startsWith('Vitrina:'));

/** Adónde va lo que se saca: al horno para la mesa de desayunos, a un punto (p. ej. Xenote) o merma. */
type Dest = string; // 'desayunos' | 'merma' | id de un punto

/** Botones rápidos para descontar, según la unidad. */
function quickSteps(unit: string): number[] {
  const u = unit.toLowerCase();
  if (u === 'kg' || u === 'l') return [0.25, 0.5, 1];
  if (u === 'g' || u === 'ml') return [100, 250, 500];
  return [1, 2, 6, 12];
}

export interface ShowcaseItem {
  product: Product;
  /** Lo que producción anotó hoy (sin lo deshecho). */
  madeToday: number;
  /** Lo que se sacó hoy de la cámara (horno, puntos y merma, sin lo deshecho). */
  outToday: number;
  /** Quién anotó y a qué hora la última producción de hoy. */
  last?: { at: string; by?: string };
}

/**
 * Cámara de congelados: lo que produce la panadería se congela acá (es el stock del producto).
 * Cuando se saca para hornear (mesa de desayunos), para un punto o como merma, se descuenta.
 */
export function ShowcasePage() {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const { run, notify } = useFeedback();
  const { can } = useSession();
  const navigate = useNavigate();
  const outlets = useOutlets().filter((o) => o.active);
  const [q, setQ] = useState('');
  const [view, setView] = useState<'hay' | 'agotado'>('hay');
  const [picked, setPicked] = useState<Product | null>(null);
  const [qty, setQty] = useState<number | undefined>();
  const [dest, setDest] = useState<Dest>('desayunos');

  const today = useToday();
  const since = useMemo(() => startOfDayIso(today), [today]);
  const moves = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY;

  const famIds = useMemo(() => productionFamilyIds(settings, lk.categories), [settings, lk.categories]);
  const unitOf = (p: Product) => lk.unit(p.unitId) || 'u';

  const items = useMemo(() => {
    const undone = new Set(moves.filter((m) => m.idempotencyKey?.startsWith('undo:')).map((m) => m.idempotencyKey.slice(5)));
    const made = new Map<string, number>();
    const out = new Map<string, number>();
    const last = new Map<string, { at: string; by?: string }>();
    for (const m of moves) {
      if (undone.has(m.id)) continue;
      if (m.type === 'produccion') {
        made.set(m.productId, (made.get(m.productId) ?? 0) + m.delta);
        const l = last.get(m.productId);
        if (!l || m.createdAt > l.at) last.set(m.productId, { at: m.createdAt, by: m.performedBy?.name });
      } else if (isOut(m.reason)) {
        out.set(m.productId, (out.get(m.productId) ?? 0) - m.delta);
      }
    }
    return products
      .filter((p) => p.active && (made.has(p.id) || (p.stock > 0 && (!famIds.size || (p.categoryId && famIds.has(p.categoryId))))))
      .map<ShowcaseItem>((p) => ({ product: p, madeToday: round3(made.get(p.id) ?? 0), outToday: round3(out.get(p.id) ?? 0), last: last.get(p.id) }))
      .sort((a, b) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '') || a.product.name.localeCompare(b.product.name, 'es'));
  }, [moves, products, famIds]);

  const available = items.filter((i) => i.product.stock > 0);
  const soldOut = items.filter((i) => i.product.stock <= 0);
  const shown = (view === 'hay' ? available : soldOut).filter((i) => !q.trim() || matches(q, i.product.name, i.product.sku));

  const open = (p: Product) => {
    setPicked(p);
    setQty(undefined);
    setDest('desayunos');
  };

  const stockOf = (p: Product | null) => (p ? products.find((x) => x.id === p.id)?.stock ?? p.stock : 0);
  const left = stockOf(picked);
  const tooMuch = !!qty && qty > left + 1e-9;

  const take = async (amount: number) => {
    if (!picked || amount <= 0) return;
    const p = picked;
    const value = round3(amount);
    const outlet = outlets.find((o) => o.id === dest);
    const reason = dest === 'merma' ? WASTE_REASON : outlet ? toOutlet(outlet.name) : OVEN_REASON;
    const r = await run(() =>
      applyMovement({ productId: p.id, type: dest === 'merma' ? 'perdida' : 'salida', delta: -value, origin: 'manual', reason }),
    );
    if (!r) return;
    setPicked(null);
    const rest = round3(left - value);
    const what = dest === 'merma' ? 'Merma' : outlet ? `A ${outlet.name}` : 'Al horno';
    notify(`${what}: ${fmtNumber(value)} ${unitOf(p)} de ${p.name} · ${rest > 0 ? `quedan ${fmtNumber(rest)} en la cámara` : 'no queda más en la cámara'}`, {
      undo: () => void revertMovement(r.movement),
    });
  };

  return (
    <div className="production showcase">
      <PageHeader
        title="Cámara de congelados"
        subtitle="Lo que produce la panadería queda acá congelado. Cuando saques algo para hornear, tocalo y anotá cuánto."
        actions={<>
          {can('count.do') && available.length > 0 && (
            <button type="button" className="btn btn-sm" onClick={async () => {
              const c = await run(() => startCount({ name: 'Conteo de la cámara de congelados', productIds: items.map((i) => i.product.id) }));
              if (c) navigate(`/conteo/${c.id}`);
            }}><ClipboardCheck size={16} aria-hidden /> Contar la cámara</button>
          )}
          <Segmented label="Mostrar" value={view} onChange={setView} options={[{ value: 'hay', label: `En la cámara (${available.length})` }, { value: 'agotado', label: `Se terminó (${soldOut.length})` }]} />
        </>}
      />

      {items.length > 6 && (
        <label className="production-search">
          <Search size={20} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en la cámara" aria-label="Buscar en la cámara" />
        </label>
      )}

      {shown.length === 0 ? (
        <div className="card card-body showcase-empty">
          <Snowflake size={28} aria-hidden className="muted" />
          <p className="muted">
            {q.trim() ? 'No hay productos con ese nombre.' : view === 'hay' ? 'La cámara está vacía. Cuando la panadería anote lo que produjo, aparece acá.' : 'No se terminó nada.'}
          </p>
        </div>
      ) : (
        <div className="production-grid" role="list" aria-label="Cámara de congelados">
          {shown.map((i) => (
            <button
              key={i.product.id}
              type="button"
              role="listitem"
              className={`production-tile showcase-tile ${i.product.stock <= 0 ? 'is-out' : ''} ${i.product.minStock > 0 && i.product.stock > 0 && i.product.stock <= i.product.minStock ? 'is-low' : ''}`}
              onClick={() => open(i.product)}
              disabled={i.product.stock <= 0}
              aria-label={`${i.product.name}: quedan ${fmtNumber(Math.max(0, i.product.stock))} ${unitOf(i.product)} en la cámara`}
            >
              <span className="production-tile-name">{i.product.name}</span>
              <span className="showcase-left">
                {i.product.stock > 0 ? (
                  <><b className="num">{fmtNumber(i.product.stock)}</b> <span>{unitOf(i.product)}</span></>
                ) : (
                  <b>No queda</b>
                )}
              </span>
              <span className="production-tile-unit">
                {i.product.minStock > 0 && i.product.stock > 0 && i.product.stock <= i.product.minStock ? 'Quedan pocas · producir · ' : ''}
                {i.madeToday > 0 ? `Hoy entró ${fmtNumber(i.madeToday)}` : 'De antes'}
                {i.outToday > 0 ? ` · se sacó ${fmtNumber(i.outToday)}` : ''}
                {i.last ? ` · ${fmtTime(i.last.at)}${i.last.by ? ` ${i.last.by}` : ''}` : ''}
              </span>
            </button>
          ))}
        </div>
      )}

      <TodayFeed items={items} unitOf={unitOf} />

      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={picked?.name ?? ''}
        footer={
          <>
            <button type="button" className="btn" disabled={left <= 0} onClick={() => take(left)}>Sacar todo</button>
            <span className="grow" />
            <button type="button" className="btn btn-primary production-save" disabled={!qty || qty <= 0 || tooMuch} onClick={() => qty && take(qty)}>
              <Minus size={20} aria-hidden /> Sacar {qty ? `${fmtNumber(qty)} ${picked ? unitOf(picked) : ''}` : ''}
            </button>
          </>
        }
      >
        {picked && (
          <div className="production-sheet">
            <p className="muted">En la cámara hay <b className="num">{fmtNumber(left)}</b> {unitOf(picked)}. ¿Cuánto sacás?</p>
            <Segmented label="Para qué" value={dest} onChange={setDest} options={[
              { value: 'desayunos', label: 'Al horno · Desayunos' },
              ...outlets.map((o) => ({ value: o.id, label: o.name })),
              { value: 'merma', label: 'Merma' },
            ]} />
            <Stepper label={picked.name} value={qty} onChange={setQty} />
            <div className="production-quick">
              {quickSteps(unitOf(picked)).map((n) => (
                <button key={n} type="button" className="btn" onClick={() => setQty(round3(Math.min(left, (qty ?? 0) + n)))}>+{fmtNumber(n)}</button>
              ))}
            </div>
            {tooMuch && <p className="small" role="alert" style={{ color: 'var(--crit)' }}>Sólo quedan {fmtNumber(left)} {unitOf(picked)}.</p>}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Lo que anotó producción hoy, para que se vea quién hizo qué y cuánto queda de cada cosa. */
function TodayFeed({ items, unitOf }: { items: ShowcaseItem[]; unitOf: (p: Product) => string }) {
  const made = items.filter((i) => i.madeToday > 0);
  return (
    <section className="card production-today" aria-labelledby="camara-hoy">
      <div className="card-head">
        <h2 id="camara-hoy" className="row"><ChefHat size={18} aria-hidden /> Entró hoy a la cámara</h2>
        <span className="small muted">{made.length} productos</span>
      </div>
      {made.length === 0 ? (
        <p className="muted small card-body">Todavía no se anotó producción hoy.</p>
      ) : (
        <div className="list">
          {made.map((i) => (
            <div key={i.product.id} className="list-item">
              <div className="grow">
                <div className="list-title truncate">{i.product.name}</div>
                <div className="list-sub">
                  Entró {fmtNumber(i.madeToday)} · se sacó {fmtNumber(i.outToday)}
                  {i.last?.by ? ` · ${i.last.by}` : ''}
                </div>
              </div>
              <strong className="num">{i.product.stock > 0 ? `Quedan ${fmtNumber(i.product.stock)} ${unitOf(i.product)}` : 'No queda'}</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
