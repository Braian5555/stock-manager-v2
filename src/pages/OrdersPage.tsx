import { useSession } from '../store/session';
import { useLiveQuery } from 'dexie-react-hooks';
import { Lightbulb, Plus, ShoppingCart } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { db } from '../database/db';
import type { OrderStatus } from '../models';
import { OPEN_ORDER_STATUSES, ORDER_STATUS_LABEL } from '../services/orderService';
import { menuLabel } from '../services/settingsService';
import { useLookups, EMPTY } from '../hooks/useData';
import { useSettings } from '../store/settings';
import { Badge, EmptyState, PageHeader, Select } from '../components/ui';
import { SuggestedOrdersModal } from '../components/SuggestedOrdersModal';
import { fmtDate } from '../utils/format';

export const ORDER_TONE: Record<OrderStatus, string> = { borrador: '', pendiente: 'warn', enviado: 'info', recibido: 'ok', cancelado: 'error' };

export function OrdersPage() {
  const settings = useSettings();
  const { can } = useSession();
  const lk = useLookups();
  const [params, setParams] = useSearchParams();
  const filter = params.get('estado') ?? '';
  const suggestOpen = params.get('sugerido') === '1';
  const orders = useLiveQuery(() => db.orders.orderBy('number').reverse().toArray(), []) ?? EMPTY;
  const items = useLiveQuery(() => db.orderItems.toArray(), []) ?? EMPTY;
  const list = orders.filter((o) => !filter || (filter === 'abiertos' ? OPEN_ORDER_STATUSES.includes(o.status) : o.status === filter));

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'orders')}
        actions={
          can('orders.manage') && <>
            <button type="button" className="btn" onClick={() => setParam('sugerido', '1')}><Lightbulb size={18} aria-hidden /> Pedido sugerido</button>
            <Link to="/pedidos/nuevo" className="btn btn-primary"><Plus size={18} aria-hidden /> Nuevo pedido</Link>
          </>
        }
      />
      <div className="toolbar">
        <Select aria-label="Filtrar por estado" value={filter} onChange={(e) => setParam('estado', e.target.value)} style={{ maxWidth: 260 }}>
          <option value="">Todos los pedidos</option>
          <option value="abiertos">Pendientes y enviados</option>
          {(Object.keys(ORDER_STATUS_LABEL) as OrderStatus[]).map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
        </Select>
      </div>
      <div className="card">
        {list.length === 0 ? (
          <EmptyState icon={<ShoppingCart size={40} />} title="Sin pedidos">Creá un pedido o usá el pedido sugerido para reponer lo que falta.</EmptyState>
        ) : (
          <div className="list">
            {list.map((o) => {
              const n = items.filter((i) => i.orderId === o.id).length;
              return (
                <Link key={o.id} to={`/pedidos/${o.id}`} className="list-item">
                  <span className="stat-icon" aria-hidden><ShoppingCart size={16} /></span>
                  <div className="grow">
                    <div className="list-title truncate">Pedido #{o.number} · {lk.supplier(o.supplierId) || 'Sin proveedor'}</div>
                    <div className="list-sub">{fmtDate(o.date)} · {n} {n === 1 ? 'producto' : 'productos'}</div>
                  </div>
                  <Badge tone={ORDER_TONE[o.status]}>{ORDER_STATUS_LABEL[o.status]}</Badge>
                </Link>
              );
            })}
          </div>
        )}
      </div>
      <SuggestedOrdersModal open={suggestOpen} onClose={() => setParam('sugerido', '')} />
    </>
  );
}
