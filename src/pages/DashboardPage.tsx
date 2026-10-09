import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle, ArrowLeftRight, Boxes, Camera, ChevronRight, ClipboardCheck, Forklift, Lock, LogOut, Package, PackageCheck, Plus, Search,
  ShoppingCart, Truck, type LucideIcon,
} from 'lucide-react';
import { useMemo } from 'react';
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
import { StockHealth, type HealthCounts } from '../components/dashboard/StockHealth';
import { ActivityChart } from '../components/dashboard/ActivityChart';

const DAY = 86_400_000;

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
  const health: HealthCounts = { normal: 0, bajo: 0, critico: 0, sin_stock: 0 };
  for (const x of withStatus) health[x.s]++;
  // ¿Algún producto activo tuvo alguna vez un movimiento? (los de productos borrados no cuentan)
  const movedIds = useLiveQuery(() => db.movements.orderBy('productId').uniqueKeys(), []);
  const activeIds = useMemo(() => new Set(active.map((p) => p.id)), [active]);
  const hasMovements = movedIds === undefined ? true : movedIds.some((id) => activeIds.has(String(id)));
  return { settings, products, active, low, out, alerts, openOrders, pendingTransfers, health, hasMovements };
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
  }

const ACTIONS: Action[] = [
  { label: 'Contar stock', to: '/conteo', icon: ClipboardCheck, perms: ['count.do'] },
  { label: 'Registrar movimiento', to: '/stock', icon: ArrowLeftRight, perms: ['stock.move'] },
  { label: 'Recibir pedido', to: '/pedidos?estado=abiertos', icon: PackageCheck, perms: ['orders.receive', 'orders.manage'] },
  { label: 'Nuevo pedido', to: '/pedidos/nuevo', icon: ShoppingCart, perms: ['orders.manage'] },
  { label: 'Nuevo remito', to: '/remitos/nuevo', icon: Forklift, perms: ['transfers'] },
  { label: 'Foto de factura', to: '/facturas?nueva=1', icon: Camera, perms: ['invoices'] },
  { label: 'Buscar producto', to: '', icon: Search, perms: ['stock.view'] },
  { label: 'Ver stock', to: '/stock', icon: Boxes, perms: ['stock.view'] },
];

function MobileHome() {
  const { user, canAny, can, lock, cloudMode } = useSession();
  const { products, alerts, openOrders, pendingTransfers, health, hasMovements } = useHomeData();
  const lk = useLookups();
  const noStockLoaded = health.sin_stock > 0 && health.sin_stock === products.filter((p) => p.active).length && !hasMovements;
  const firstName = user?.name.split(' ')[0] ?? '';
  const actions = ACTIONS.filter((a) => canAny(a.perms));
  // El estado del stock (sin stock / bajo) va en su propia tarjeta; acá quedan los pendientes de gestión.
  const chips = [
    openOrders.length > 0 && canAny(MODULE_PERMISSIONS.orders) && { to: '/pedidos?estado=abiertos', icon: ShoppingCart, text: `${openOrders.length} ${openOrders.length === 1 ? 'pedido abierto' : 'pedidos abiertos'}` },
    pendingTransfers.length > 0 && can('transfers') && { to: '/remitos', icon: Forklift, text: `${pendingTransfers.length} ${pendingTransfers.length === 1 ? 'remito' : 'remitos'} sin cargar en Maxirest` },
  ].filter(Boolean) as { to: string; icon: LucideIcon; text: string }[];

  return (
    <div className="home-mobile">
      <div className="home-hello">
        <h1>Hola{firstName ? `, ${firstName}` : ''}</h1>
        <p className="muted small">{new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {products.length === 0 && can('catalog.manage') && <WelcomeCard />}

      <button type="button" className="home-search" onClick={openGlobalSearch}>
        <Search size={20} aria-hidden /> Buscar producto, proveedor, pedido…
      </button>

      {canAny(MODULE_PERMISSIONS.stock) && <StockHealth counts={health} canCount={can('count.do')} hasMovements={hasMovements} compact />}

      {chips.length > 0 && (
        <div className="home-chips">
          {chips.map((c) => <Link key={c.text} to={c.to} className="home-chip"><c.icon size={16} aria-hidden /> {c.text}</Link>)}
        </div>
      )}

      <nav className="home-actions" aria-label="Acciones rápidas">
        {actions.map(({ label, to, icon: Icon }) => to ? (
          <Link key={label} to={to} className="home-action">
            <span className="home-action-icon"><Icon size={22} aria-hidden /></span>
            <span>{label}</span>
          </Link>
        ) : (
          <button key={label} type="button" className="home-action" onClick={openGlobalSearch}>
            <span className="home-action-icon"><Icon size={22} aria-hidden /></span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {alerts.length > 0 && !noStockLoaded && canAny(MODULE_PERMISSIONS.stock) && (
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
  const { settings, products, active, alerts, openOrders, pendingTransfers, health, hasMovements } = useHomeData();
  const lk = useLookups();
  const lastMovements = useLiveQuery(() => db.movements.orderBy('createdAt').reverse().limit(10).toArray(), []) ?? EMPTY;
  // Ventana del gráfico (14 días) — se consulta por índice, no se recorre todo el historial.
  const since = useMemo(() => new Date(Date.now() - 15 * DAY).toISOString(), []);
  const recent = useLiveQuery(() => db.movements.where('createdAt').aboveOrEqual(since).toArray(), [since]) ?? EMPTY;
  const outlets = useLiveQuery(() => db.outlets.toArray(), []) ?? EMPTY;
  const productName = new Map(products.map((p) => [p.id, p.name]));
  const outletName = new Map(outlets.map((o) => [o.id, o.name]));
  const weekAgo = Date.now() - 7 * DAY;
  const lastWeek = recent.filter((m) => new Date(m.createdAt).getTime() >= weekAgo).length;
  const categories = new Set(active.map((p) => p.categoryId).filter(Boolean)).size;

  const stats = [
    { label: 'Productos activos', value: fmtNumber(active.length), sub: categories ? `${categories} ${categories === 1 ? 'familia' : 'familias'}` : 'Catálogo', icon: Package, to: '/productos', m: 'products' as ModuleKey },
    { label: 'Movimientos · 7 días', value: fmtNumber(lastWeek), sub: lastWeek ? 'Ingresos, salidas y ajustes' : 'Sin movimientos esta semana', icon: ArrowLeftRight, to: '/movimientos', m: 'movements' as ModuleKey },
    { label: 'Pedidos abiertos', value: fmtNumber(openOrders.length), sub: openOrders.length ? 'Pendientes de recibir' : 'Nada pendiente', icon: ShoppingCart, to: '/pedidos?estado=abiertos', m: 'orders' as ModuleKey },
    { label: 'Remitos sin cargar', value: fmtNumber(pendingTransfers.length), sub: pendingTransfers.length ? 'Falta cargarlos en Maxirest' : 'Todo cargado', icon: Forklift, to: '/remitos', m: 'transfers' as ModuleKey },
    { label: 'Proveedores', value: fmtNumber(lk.suppliers.length), sub: 'Activos en el catálogo', icon: Truck, to: '/proveedores', m: 'suppliers' as ModuleKey },
  ].filter((x) => allowed(x.m)).slice(0, 4);

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
      {stats.length > 0 && (
        <div className="grid home-kpis">
          {stats.map(({ label, value, sub, icon: Icon, to }) => (
            <Link key={label} to={to} className="card stat">
              <span className="stat-icon"><Icon size={17} aria-hidden /></span>
              <span className="stat-value">{value}</span>
              <span className="stat-label">{label}</span>
              <span className="stat-sub">{sub}</span>
            </Link>
          ))}
        </div>
      )}

      {allowed('stock') && active.length > 0 && (
        <div className={`grid home-overview ${recent.length ? '' : 'single'}`}>
          <StockHealth counts={health} canCount={can('count.do')} hasMovements={hasMovements} />
          {allowed('movements') && <ActivityChart movements={recent} />}
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
