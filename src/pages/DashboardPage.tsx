import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeftRight, Boxes, Camera, ChevronRight, ClipboardCheck, Forklift, Lock, LogOut, Package, PackageCheck, PackageX, Plus, Search,
  ShoppingCart, Truck, TrendingDown, type LucideIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { db } from '../database/db';
import { useLookups, useProducts, EMPTY } from '../hooks/useData';
import { DESKTOP_QUERY, openGlobalSearch, useMediaQuery } from '../hooks/useMediaQuery';
import { MODULE_PERMISSIONS } from '../layouts/modules';
import type { ModuleKey, Permission, Product, StockStatus } from '../models';
import { OPEN_ORDER_STATUSES, ORDER_STATUS_LABEL } from '../services/orderService';
import { menuLabel } from '../services/settingsService';
import { MOVEMENT_LABEL, statusOf } from '../services/stockService';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { WelcomeCard } from '../components/WelcomeCard';
import { fmtDate, fmtDateTime, fmtDay, fmtNumber, fmtSigned } from '../utils/format';

/** Datos que comparten las dos versiones del Inicio. */
function useHomeData() {
  const settings = useSettings();
  const products = useProducts();
  const openOrders = useLiveQuery(() => db.orders.where('status').anyOf(OPEN_ORDER_STATUSES).toArray(), []) ?? EMPTY;
  const pendingTransfers = useLiveQuery(() => db.transfers.filter((t) => t.status === 'enviado' && t.maxirest === 'pendiente').toArray(), []) ?? EMPTY;
  const active = products.filter((p) => p.active);
  const withStatus = active.map((p) => ({ p, s: statusOf(p, settings) as StockStatus }));
  const low = withStatus.filter((x) => x.s === 'bajo' || x.s === 'critico');
  const out = withStatus.filter((x) => x.s === 'sin_stock');
  const alerts = [...out, ...low.filter((x) => x.s === 'critico'), ...low.filter((x) => x.s === 'bajo')];
  return { settings, products, active, low, out, alerts, openOrders, pendingTransfers };
}

export function DashboardPage() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return desktop ? <DesktopHome /> : <MobileHome />;
}

// ───────────────────────── Celular: acciones grandes ─────────────────────────

interface Action {
  label: string;
  to: string;
  icon: LucideIcon;
  perms: Permission[];
  tone: string;
}

const ACTIONS: Action[] = [
  { label: 'Contar', to: '/conteo', icon: ClipboardCheck, perms: ['count.do'], tone: 'tone-a' },
  { label: 'Recibir pedido', to: '/pedidos?estado=abiertos', icon: PackageCheck, perms: ['orders.receive', 'orders.manage'], tone: 'tone-b' },
  { label: 'Registrar movimiento', to: '/stock', icon: ArrowLeftRight, perms: ['stock.move'], tone: 'tone-c' },
  { label: 'Foto de factura', to: '/facturas?nueva=1', icon: Camera, perms: ['invoices'], tone: 'tone-d' },
  { label: 'Nuevo remito', to: '/remitos/nuevo', icon: Forklift, perms: ['transfers'], tone: 'tone-e' },
  { label: 'Nuevo pedido', to: '/pedidos/nuevo', icon: ShoppingCart, perms: ['orders.manage'], tone: 'tone-f' },
  { label: 'Ver stock', to: '/stock', icon: Boxes, perms: ['stock.view'], tone: 'tone-g' },
];

function MobileHome() {
  const { user, canAny, can, lock, cloudMode } = useSession();
  const { products, low, out, alerts, openOrders, pendingTransfers } = useHomeData();
  const lk = useLookups();
  const firstName = user?.name.split(' ')[0] ?? '';
  const actions = ACTIONS.filter((a) => canAny(a.perms));
  const chips = [
    out.length > 0 && { to: '/stock?estado=sin_stock', cls: 'alert-danger', text: `${out.length} ${out.length === 1 ? 'producto está' : 'productos están'} sin stock` },
    low.length > 0 && { to: '/stock?estado=bajo', cls: 'alert-warn', text: `${low.length} ${low.length === 1 ? 'producto tiene' : 'productos tienen'} stock bajo` },
    openOrders.length > 0 && canAny(MODULE_PERMISSIONS.orders) && { to: '/pedidos?estado=abiertos', cls: 'alert-info', text: `${openOrders.length} ${openOrders.length === 1 ? 'pedido abierto' : 'pedidos abiertos'}` },
    pendingTransfers.length > 0 && can('transfers') && { to: '/remitos', cls: 'alert-info', text: `${pendingTransfers.length} ${pendingTransfers.length === 1 ? 'remito' : 'remitos'} sin cargar en Maxirest` },
  ].filter(Boolean) as { to: string; cls: string; text: string }[];

  return (
    <div className="home-mobile">
      <div className="home-hello">
        <h1>Hola{firstName ? `, ${firstName}` : ''}</h1>
        <p className="muted small">{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}

      <button type="button" className="home-search" onClick={openGlobalSearch}>
        <Search size={20} aria-hidden /> Buscar producto, proveedor…
      </button>

      {chips.length > 0 ? (
        <div className="home-chips">
          {chips.map((c) => <Link key={c.text} to={c.to} className={`alert ${c.cls} home-chip`}>{c.text}</Link>)}
        </div>
      ) : (
        products.length > 0 && <p className="alert alert-ok small">Todo en orden: no hay productos por debajo del mínimo.</p>
      )}

      <nav className="home-actions" aria-label="Acciones rápidas">
        {actions.map(({ label, to, icon: Icon, tone }) => (
          <Link key={label} to={to} className={`home-action ${tone}`}>
            <span className="home-action-icon"><Icon size={26} aria-hidden /></span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {alerts.length > 0 && canAny(MODULE_PERMISSIONS.stock) && (
        <section className="card" aria-labelledby="reponer">
          <div className="card-head">
            <h2 id="reponer" className="row"><AlertTriangle size={18} aria-hidden /> Para reponer</h2>
            {can('orders.manage') && <Link to="/pedidos?sugerido=1" className="btn btn-sm">Crear pedido sugerido</Link>}
          </div>
          <div className="list">
            {alerts.slice(0, 5).map(({ p, s }) => <AlertRow key={p.id} p={p} s={s} unit={lk.unit(p.unitId)} />)}
            {alerts.length > 5 && <Link to="/stock?estado=bajo" className="list-item small muted">Ver los {alerts.length} productos <ChevronRight size={16} aria-hidden /></Link>}
          </div>
        </section>
      )}

      <button type="button" className="btn btn-block home-logout" onClick={() => void lock()}>
        {cloudMode ? <><LogOut size={18} aria-hidden /> Cerrar sesión</> : <><Lock size={18} aria-hidden /> Bloquear / cambiar usuario</>}
      </button>
    </div>
  );
}

function AlertRow({ p, s, unit }: { p: Product; s: StockStatus; unit: string }) {
  return (
    <Link to={`/stock?estado=${s === 'sin_stock' ? 'sin_stock' : 'bajo'}`} className="list-item">
      <div className="grow">
        <div className="list-title truncate">{p.name}</div>
        <div className="list-sub">Stock {fmtNumber(p.stock)} {unit} · mín. {fmtNumber(p.minStock)}</div>
      </div>
      <StatusBadge status={s} />
    </Link>
  );
}

// ───────────────────────── Computadora: tablero completo ─────────────────────────

function DesktopHome() {
  const { can, canAny } = useSession();
  const allowed = (m: ModuleKey) => canAny(MODULE_PERMISSIONS[m]);
  const { settings, products, active, low, out, alerts, openOrders, pendingTransfers } = useHomeData();
  const lk = useLookups();
  const lastMovements = useLiveQuery(() => db.movements.orderBy('createdAt').reverse().limit(10).toArray(), []) ?? EMPTY;
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) ?? EMPTY;
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const totalUnits = active.reduce((a, p) => a + Math.max(0, p.stock), 0);

  const stats = [
    { label: 'Productos', value: active.length, icon: Package, to: '/productos', m: 'products' as ModuleKey },
    { label: 'Stock total (unid.)', value: fmtNumber(totalUnits), icon: Boxes, to: '/stock', m: 'stock' as ModuleKey },
    { label: 'Stock bajo', value: low.length, icon: TrendingDown, to: '/stock?estado=bajo', m: 'stock' as ModuleKey },
    { label: 'Sin stock', value: out.length, icon: PackageX, to: '/stock?estado=sin_stock', m: 'stock' as ModuleKey },
    { label: 'Pedidos abiertos', value: openOrders.length, icon: ShoppingCart, to: '/pedidos?estado=abiertos', m: 'orders' as ModuleKey },
    { label: 'Remitos sin cargar', value: pendingTransfers.length, icon: Forklift, to: '/remitos', m: 'transfers' as ModuleKey },
    { label: 'Proveedores', value: lk.suppliers.length, icon: Truck, to: '/proveedores', m: 'suppliers' as ModuleKey },
  ].filter((x) => allowed(x.m)).slice(0, 6);

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'dashboard')}
        subtitle={new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
        actions={<>
          {can('orders.manage') && <Link to="/pedidos/nuevo" className="btn"><Plus size={18} aria-hidden /> Nuevo pedido</Link>}
          {can('transfers') && <Link to="/remitos/nuevo" className="btn"><Forklift size={18} aria-hidden /> Nuevo remito</Link>}
          {can('count.do') && <Link to="/conteo" className="btn btn-primary"><ClipboardCheck size={18} aria-hidden /> Contar</Link>}
        </>}
      />
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

      {(low.length > 0 || out.length > 0) && (
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
        </div>
      )}

      <div className="grid home-desk-grid">
        <section className="card" aria-labelledby="alertas">
          <div className="card-head">
            <h2 id="alertas" className="row"><AlertTriangle size={18} aria-hidden /> Alertas de stock</h2>
            {alerts.length > 0 && can('orders.manage') && <Link to="/pedidos?sugerido=1" className="btn btn-sm">Crear pedido sugerido</Link>}
          </div>
          {alerts.length === 0 ? (
            <EmptyState title="Todo en orden">No hay productos por debajo del mínimo.</EmptyState>
          ) : (
            <div className="list">{alerts.slice(0, 10).map(({ p, s }) => <AlertRow key={p.id} p={p} s={s} unit={lk.unit(p.unitId)} />)}</div>
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

        <div className="stack">
          {allowed('orders') && (
            <section className="card" aria-labelledby="pedidos-abiertos">
              <div className="card-head">
                <h2 id="pedidos-abiertos" className="row"><ShoppingCart size={18} aria-hidden /> Pedidos abiertos</h2>
                <Link to="/pedidos?estado=abiertos" className="btn btn-sm btn-ghost">Ver todos</Link>
              </div>
              {openOrders.length === 0 ? (
                <p className="muted small card-body">No hay pedidos pendientes de recibir.</p>
              ) : (
                <div className="list">
                  {[...openOrders].sort((a, b) => b.number - a.number).slice(0, 6).map((o) => (
                    <Link key={o.id} to={`/pedidos/${o.id}`} className="list-item">
                      <div className="grow">
                        <div className="list-title truncate">#{o.number} · {lk.supplier(o.supplierId) || 'Sin proveedor'}</div>
                        <div className="list-sub">{fmtDate(o.date)}</div>
                      </div>
                      <span className="small muted">{ORDER_STATUS_LABEL[o.status]}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
          {allowed('transfers') && (
            <section className="card" aria-labelledby="remitos-pendientes">
              <div className="card-head">
                <h2 id="remitos-pendientes" className="row"><Forklift size={18} aria-hidden /> Remitos sin cargar en Maxirest</h2>
                <Link to="/remitos" className="btn btn-sm btn-ghost">Ver todos</Link>
              </div>
              {pendingTransfers.length === 0 ? (
                <p className="muted small card-body">Todos los remitos están cargados en Maxirest.</p>
              ) : (
                <div className="list">
                  {[...pendingTransfers].sort((a, b) => b.number - a.number).slice(0, 6).map((t) => (
                    <Link key={t.id} to="/remitos" className="list-item">
                      <div className="grow">
                        <div className="list-title truncate">#{t.number} · {outletName.get(t.outletId) ?? 'Punto'}</div>
                        <div className="list-sub">{fmtDay(t.date)} · {t.items.length} {t.items.length === 1 ? 'producto' : 'productos'}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </>
  );
}
