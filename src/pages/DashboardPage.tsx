import { useSession } from '../store/session';
import type { ModuleKey } from '../models';
import { MODULE_PERMISSIONS } from '../layouts/modules';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowLeftRight, Boxes, Package, PackageX, ShoppingCart, Truck, TrendingDown } from 'lucide-react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { useLookups, useProducts, EMPTY } from '../hooks/useData';
import { MOVEMENT_LABEL, statusOf } from '../services/stockService';
import { OPEN_ORDER_STATUSES } from '../services/orderService';
import { useSettings } from '../store/settings';
import { EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { fmtDateTime, fmtNumber, fmtSigned } from '../utils/format';
import { menuLabel } from '../services/settingsService';
import { WelcomeCard } from '../components/WelcomeCard';

export function DashboardPage() {
  const settings = useSettings();
  const { can, canAny } = useSession();
  const allowed = (m: ModuleKey) => canAny(MODULE_PERMISSIONS[m]);
  const products = useProducts();
  const lk = useLookups();
  const pendingOrders = useLiveQuery(() => db.orders.where('status').anyOf(OPEN_ORDER_STATUSES).count(), []) ?? 0;
  const lastMovements = useLiveQuery(() => db.movements.orderBy('createdAt').reverse().limit(8).toArray(), []) ?? EMPTY;
  const productName = new Map(products.map((p) => [p.id, p.name]));

  const active = products.filter((p) => p.active);
  const withStatus = active.map((p) => ({ p, s: statusOf(p, settings) }));
  const low = withStatus.filter((x) => x.s === 'bajo' || x.s === 'critico');
  const critical = withStatus.filter((x) => x.s === 'critico');
  const out = withStatus.filter((x) => x.s === 'sin_stock');
  const totalUnits = active.reduce((a, p) => a + Math.max(0, p.stock), 0);

  const stats = [
    { label: 'Productos', value: active.length, icon: Package, to: '/productos', m: 'products' as ModuleKey },
    { label: 'Stock total (unid.)', value: fmtNumber(totalUnits), icon: Boxes, to: '/stock', m: 'stock' as ModuleKey },
    { label: 'Stock bajo', value: low.length, icon: TrendingDown, to: '/stock?estado=bajo', m: 'stock' as ModuleKey },
    { label: 'Sin stock', value: out.length, icon: PackageX, to: '/stock?estado=sin_stock', m: 'stock' as ModuleKey },
    { label: 'Pedidos pendientes', value: pendingOrders, icon: ShoppingCart, to: '/pedidos?estado=abiertos', m: 'orders' as ModuleKey },
    { label: 'Proveedores', value: lk.suppliers.length, icon: Truck, to: '/proveedores', m: 'suppliers' as ModuleKey },
  ].filter((x) => allowed(x.m));
  const alerts = [...out, ...critical, ...low.filter((x) => x.s === 'bajo')].slice(0, 8);

  return (
    <>
      <PageHeader title={menuLabel(settings, 'dashboard')} subtitle={new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })} />
      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}
      <div className="grid grid-stats" style={{ marginBottom: 16 }}>
        {stats.map(({ label, value, icon: Icon, to }) => (
          <Link key={label} to={to} className="card stat">
            <span className="stat-icon"><Icon size={18} aria-hidden /></span>
            <span className="stat-value">{value}</span>
            <span className="stat-label">{label}</span>
          </Link>
        ))}
      </div>

      {(low.length > 0 || out.length > 0 || pendingOrders > 0) && (
        <div className="stack" style={{ marginBottom: 16 }}>
          {low.length > 0 && (
            <Link to="/stock?estado=bajo" className="alert alert-warn">
              <span aria-hidden>⚠</span> {low.length} {low.length === 1 ? 'producto tiene' : 'productos tienen'} stock bajo
            </Link>
          )}
          {out.length > 0 && (
            <Link to="/stock?estado=sin_stock" className="alert alert-danger">
              <span aria-hidden>🔴</span> {out.length} {out.length === 1 ? 'producto está' : 'productos están'} sin stock
            </Link>
          )}
          {pendingOrders > 0 && (
            <Link to="/pedidos?estado=abiertos" className="alert alert-info">
              <span aria-hidden>🛒</span> {pendingOrders} {pendingOrders === 1 ? 'pedido está pendiente' : 'pedidos están pendientes'}
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-2">
        <section className="card" aria-labelledby="alertas">
          <div className="card-head">
            <h2 id="alertas" className="row"><AlertTriangle size={18} aria-hidden /> Alertas de stock</h2>
            {alerts.length > 0 && can('orders.manage') && <Link to="/pedidos?sugerido=1" className="btn btn-sm">Crear pedido sugerido</Link>}
          </div>
          {alerts.length === 0 ? (
            <EmptyState title="Todo en orden">No hay productos por debajo del mínimo.</EmptyState>
          ) : (
            <div className="list">
              {alerts.map(({ p, s }) => (
                <Link key={p.id} to={can('catalog.manage') ? `/productos?editar=${p.id}` : `/stock?estado=${s}`} className="list-item">
                  <div className="grow">
                    <div className="list-title truncate">{p.name}</div>
                    <div className="list-sub">Stock {fmtNumber(p.stock)} {lk.unit(p.unitId)} · mín. {fmtNumber(p.minStock)}</div>
                  </div>
                  <StatusBadge status={s} />
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="card" aria-labelledby="ultimos">
          <div className="card-head">
            <h2 id="ultimos" className="row"><ArrowLeftRight size={18} aria-hidden /> Últimos movimientos</h2>
            {allowed('movements') && <Link to="/movimientos" className="btn btn-sm btn-ghost">Ver todos</Link>}
          </div>
          {lastMovements.length === 0 ? (
            <EmptyState title="Sin movimientos">Los ingresos, salidas, ajustes y conteos aparecerán aquí.</EmptyState>
          ) : (
            <div className="list">
              {lastMovements.map((m) => (
                <div key={m.id} className="list-item">
                  <div className="grow">
                    <div className="list-title truncate">{productName.get(m.productId) ?? '(producto eliminado)'}</div>
                    <div className="list-sub">{MOVEMENT_LABEL[m.type]} · {fmtDateTime(m.createdAt)}</div>
                  </div>
                  <strong className={`num ${m.delta >= 0 ? 'pos' : 'neg'}`}>{fmtSigned(m.delta)}</strong>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
