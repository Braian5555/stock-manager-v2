import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownRight, ArrowUpRight, Download, MapPin, PackageX, Scale, Tags, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { EMPTY, useLookups, useProducts } from '../hooks/useData';
import type { MovementType } from '../models';
import { MOVEMENT_GROUPS, MOVEMENT_LABEL, OUTGOING_TYPES, statusOf, type MovementGroup } from '../services/stockService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { EmptyState, PageHeader, Segmented } from '../components/ui';
import { fmtNumber, localYmd } from '../utils/format';
import { menuLabel } from '../services/settingsService';

const PERIODS = [
  { value: '7', label: '7 días' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
];

/**
 * Reportes de sólo lectura, calculados con los datos que ya existen (productos y
 * movimientos). No modifica nada.
 */
export function ReportsPage() {
  const settings = useSettings();
  const { can } = useSession();
  const lk = useLookups();
  const products = useProducts();
  const [days, setDays] = useState('30');
  // Días completos (desde las 0 h): coincide con el filtro "Desde" de Movimientos.
  const since = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (Number(days) - 1));
    return d.toISOString();
  }, [days]);
  const movements = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY;

  const byType = useMemo(() => {
    const m = new Map<MovementType, number>();
    for (const x of movements) m.set(x.type, (m.get(x.type) ?? 0) + 1);
    return m;
  }, [movements]);

  const topOut = useMemo(() => {
    const out = new Map<string, number>();
    for (const x of movements) if (OUTGOING_TYPES.includes(x.type) && x.delta < 0) out.set(x.productId, (out.get(x.productId) ?? 0) - x.delta);
    return [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [movements]);

  const topIn = useMemo(() => {
    const inn = new Map<string, number>();
    for (const x of movements) if ((x.type === 'ingreso' || x.type === 'devolucion') && x.delta > 0) inn.set(x.productId, (inn.get(x.productId) ?? 0) + x.delta);
    return [...inn.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [movements]);

  // Nombre guardado en el movimiento, para productos que después se eliminaron.
  const savedName = useMemo(() => new Map(movements.filter((m) => m.productName).map((m) => [m.productId, m.productName!])), [movements]);
  const sinceYmd = localYmd(since);
  const movLink = (extra: Record<string, string>) => `/movimientos?${new URLSearchParams({ desde: sinceYmd, ...extra })}`;
  const countGroup = (g: MovementGroup) => (MOVEMENT_GROUPS[g].types as readonly MovementType[]).reduce((a, t) => a + (byType.get(t) ?? 0), 0);

  const active = products.filter((p) => p.active);
  const productById = new Map(products.map((p) => [p.id, p]));
  const groupBy = (key: (p: (typeof active)[number]) => string) => {
    const g = new Map<string, { total: number; low: number; out: number }>();
    for (const p of active) {
      const k = key(p) || 'Sin asignar';
      const row = g.get(k) ?? { total: 0, low: 0, out: 0 };
      const s = statusOf(p, settings);
      row.total++;
      if (s === 'bajo' || s === 'critico') row.low++;
      if (s === 'sin_stock') row.out++;
      g.set(k, row);
    }
    return [...g.entries()].sort((a, b) => b[1].out + b[1].low - (a[1].out + a[1].low) || a[0].localeCompare(b[0], 'es'));
  };
  const byCategory = groupBy((p) => lk.category(p.categoryId));
  const byLocation = groupBy((p) => lk.location(p.locationId));

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'reports')}
        subtitle="Resumen de la actividad y del estado del stock."
        actions={<>
          {can('export') && <Link to="/exportar" className="btn"><Download size={18} aria-hidden /> Exportar datos</Link>}
          {can('admin') && <Link to="/conciliacion" className="btn"><Scale size={18} aria-hidden /> Conciliación</Link>}
        </>}
      />
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <span className="small muted">Período:</span>
        <Segmented value={days} onChange={setDays} options={PERIODS} label="Período" />
      </div>

      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        <Tile to={movLink({ tipo: 'grupo:ingresos' })} icon={<ArrowUpRight size={18} aria-hidden />} value={countGroup('ingresos')} label="Ingresos registrados" />
        <Tile to={movLink({ tipo: 'grupo:salidas' })} icon={<ArrowDownRight size={18} aria-hidden />} value={countGroup('salidas')} label="Salidas y consumos" />
        <Tile to={movLink({ tipo: 'grupo:perdidas' })} icon={<TrendingDown size={18} aria-hidden />} value={countGroup('perdidas')} label="Pérdidas" />
        <Tile to={movLink({ tipo: 'grupo:ajustes' })} icon={<Scale size={18} aria-hidden />} value={countGroup('ajustes')} label="Ajustes y conteos" />
        <Tile to="/stock?estado=sin_stock" icon={<PackageX size={18} aria-hidden />} value={active.filter((p) => statusOf(p, settings) === 'sin_stock').length} label="Sin stock hoy" />
        <Tile to={movLink({})} icon={<Tags size={18} aria-hidden />} value={movements.length} label="Movimientos en total" />
      </div>
      <p className="small muted" style={{ margin: '-6px 0 16px' }}>Tocá un recuadro o un producto para ver el detalle de los movimientos.</p>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <TopList title="Lo que más salió" rows={topOut} productById={productById} savedName={savedName} unit={lk.unit} sign="-" empty="No hubo salidas, consumos ni pérdidas en el período." link={(id) => movLink({ producto: id })} />
        <TopList title="Lo que más ingresó" rows={topIn} productById={productById} savedName={savedName} unit={lk.unit} sign="+" empty="No hubo ingresos en el período." link={(id) => movLink({ producto: id, tipo: 'grupo:ingresos' })} />
      </div>

      <div className="grid grid-2">
        <StatusTable title="Estado por familia" icon={<Tags size={18} aria-hidden />} rows={byCategory} />
        <StatusTable title="Estado por ubicación" icon={<MapPin size={18} aria-hidden />} rows={byLocation} />
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        Tipos incluidos: {(['ingreso', 'produccion', 'devolucion', 'salida', 'consumo', 'perdida', 'ajuste', 'conteo'] as MovementType[]).map((t) => MOVEMENT_LABEL[t]).join(', ')}.
        Para el detalle completo, usá Movimientos o exportá a Excel.
      </p>
    </>
  );
}

function Tile({ to, icon, value, label }: { to: string; icon: React.ReactNode; value: number; label: string }) {
  return (
    <Link to={to} className="card stat" aria-label={`${label}: ${value}. Ver detalle`}>
      <span className="stat-icon">{icon}</span>
      <span className="stat-value">{fmtNumber(value)}</span>
      <span className="stat-label">{label}</span>
    </Link>
  );
}

function TopList({ title, rows, productById, savedName, unit, sign, empty, link }: {
  title: string; rows: [string, number][]; productById: Map<string, { name: string; unitId?: string }>; savedName: Map<string, string>;
  unit: (id?: string) => string; sign: string; empty: string; link: (productId: string) => string;
}) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><h2>{title}</h2></div>
      {rows.length === 0 ? <EmptyState title="Sin datos">{empty}</EmptyState> : (
        <div className="list">
          {rows.map(([id, qty], i) => {
            const p = productById.get(id);
            return (
              <Link key={id} to={link(id)} className="list-item">
                <span className="rank" aria-hidden>{i + 1}</span>
                <div className="grow list-title truncate">{p?.name ?? (savedName.get(id) ? `${savedName.get(id)} (eliminado)` : '(producto eliminado)')}</div>
                <strong className={`num ${sign === '+' ? 'pos' : 'neg'}`}>{sign}{fmtNumber(qty)} {unit(p?.unitId)}</strong>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusTable({ title, icon, rows }: { title: string; icon: React.ReactNode; rows: [string, { total: number; low: number; out: number }][] }) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><h2 className="row">{icon} {title}</h2></div>
      {rows.length === 0 ? <EmptyState title="Sin productos">Cargá productos para ver este reporte.</EmptyState> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Nombre</th><th className="num">Productos</th><th className="num">Bajo</th><th className="num">Sin stock</th></tr></thead>
            <tbody>
              {rows.map(([name, r]) => (
                <tr key={name}><td>{name}</td><td className="num">{r.total}</td><td className="num">{r.low || '—'}</td><td className="num">{r.out || '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
