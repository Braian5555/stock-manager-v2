import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDownRight, ArrowUpRight, Download, MapPin, PackageX, Scale, Tags, TrendingDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { EMPTY, useLookups, useProducts } from '../hooks/useData';
import type { MovementType } from '../models';
import { MOVEMENT_LABEL, OUTGOING_TYPES, statusOf } from '../services/stockService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { EmptyState, PageHeader, Segmented } from '../components/ui';
import { fmtNumber } from '../utils/format';
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
  const since = useMemo(() => new Date(Date.now() - Number(days) * 86_400_000).toISOString(), [days]);
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
        <div className="card stat"><span className="stat-icon"><ArrowUpRight size={18} aria-hidden /></span><span className="stat-value">{fmtNumber((byType.get('ingreso') ?? 0) + (byType.get('devolucion') ?? 0))}</span><span className="stat-label">Ingresos registrados</span></div>
        <div className="card stat"><span className="stat-icon"><ArrowDownRight size={18} aria-hidden /></span><span className="stat-value">{fmtNumber((byType.get('salida') ?? 0) + (byType.get('consumo') ?? 0))}</span><span className="stat-label">Salidas y consumos</span></div>
        <div className="card stat"><span className="stat-icon"><TrendingDown size={18} aria-hidden /></span><span className="stat-value">{fmtNumber(byType.get('perdida') ?? 0)}</span><span className="stat-label">Pérdidas</span></div>
        <div className="card stat"><span className="stat-icon"><Scale size={18} aria-hidden /></span><span className="stat-value">{fmtNumber((byType.get('ajuste') ?? 0) + (byType.get('conteo') ?? 0))}</span><span className="stat-label">Ajustes y conteos</span></div>
        <div className="card stat"><span className="stat-icon"><PackageX size={18} aria-hidden /></span><span className="stat-value">{fmtNumber(active.filter((p) => statusOf(p, settings) === 'sin_stock').length)}</span><span className="stat-label">Sin stock hoy</span></div>
        <div className="card stat"><span className="stat-icon"><Tags size={18} aria-hidden /></span><span className="stat-value">{fmtNumber(movements.length)}</span><span className="stat-label">Movimientos en total</span></div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <TopList title="Lo que más salió" rows={topOut} productById={productById} unit={lk.unit} sign="-" empty="No hubo salidas, consumos ni pérdidas en el período." />
        <TopList title="Lo que más ingresó" rows={topIn} productById={productById} unit={lk.unit} sign="+" empty="No hubo ingresos en el período." />
      </div>

      <div className="grid grid-2">
        <StatusTable title="Estado por familia" icon={<Tags size={18} aria-hidden />} rows={byCategory} />
        <StatusTable title="Estado por ubicación" icon={<MapPin size={18} aria-hidden />} rows={byLocation} />
      </div>

      <p className="small muted" style={{ marginTop: 16 }}>
        Tipos incluidos: {(['ingreso', 'devolucion', 'salida', 'consumo', 'perdida', 'ajuste', 'conteo'] as MovementType[]).map((t) => MOVEMENT_LABEL[t]).join(', ')}.
        Para el detalle completo, usá Movimientos o exportá a Excel.
      </p>
    </>
  );
}

function TopList({ title, rows, productById, unit, sign, empty }: {
  title: string; rows: [string, number][]; productById: Map<string, { name: string; unitId?: string }>; unit: (id?: string) => string; sign: string; empty: string;
}) {
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><h2>{title}</h2></div>
      {rows.length === 0 ? <EmptyState title="Sin datos">{empty}</EmptyState> : (
        <div className="list">
          {rows.map(([id, qty], i) => {
            const p = productById.get(id);
            return (
              <div key={id} className="list-item">
                <span className="rank" aria-hidden>{i + 1}</span>
                <div className="grow list-title truncate">{p?.name ?? '(producto eliminado)'}</div>
                <strong className={`num ${sign === '+' ? 'pos' : 'neg'}`}>{sign}{fmtNumber(qty)} {unit(p?.unitId)}</strong>
              </div>
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
