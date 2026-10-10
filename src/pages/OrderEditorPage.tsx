import { useSession } from '../store/session';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Camera, ClipboardCopy, Copy, MessageCircle, PackageCheck, Plus, Trash2, X } from 'lucide-react';
import { orderText, whatsappUrl } from '../utils/orderText';
import { useSettings } from '../store/settings';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { db } from '../database/db';
import type { OrderStatus } from '../models';
import {
  ORDER_STATUS_LABEL, deleteOrder, duplicateOrder, receiveOrder, saveOrder, type OrderLineDraft,
} from '../services/orderService';
import { useLookups, useProducts } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { Modal } from '../components/ui/Modal';
import { Badge, Field, Input, NumberInput, PageHeader, Select, Textarea } from '../components/ui';
import { fmtNumber, localYmd } from '../utils/format';
import { ORDER_TONE } from './OrdersPage';
import { InvoiceEditor } from '../components/invoices/InvoiceEditor';
import { InvoiceViewer } from '../components/invoices/InvoiceViewer';
import { InvoiceList } from '../components/invoices/InvoiceList';
import type { Invoice } from '../models';

interface Draft {
  supplierId?: string;
  status: OrderStatus;
  date: string;
  notes: string;
  items: OrderLineDraft[];
}

const today = () => localYmd();
const EDITABLE_STATUSES: OrderStatus[] = ['borrador', 'pendiente', 'enviado', 'cancelado'];

export function OrderEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'nuevo';
  const navigate = useNavigate();
  const products = useProducts();
  const settingsBiz = useSettings();
  const lk = useLookups();
  const { run, confirm, notify } = useFeedback();
  const { can } = useSession();
  const order = useLiveQuery(async () => (isNew ? undefined : ((await db.orders.get(id!)) ?? null)), [id]);
  const orderItems = useLiveQuery(() => (isNew ? [] : db.orderItems.where('orderId').equals(id!).toArray()), [id]);
  const [d, setD] = useState<Draft>({ status: 'borrador', date: today(), notes: '', items: [] });
  const [dirty, setDirty] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState<Record<string, number | undefined>>({});
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const invoices = useLiveQuery(() => (isNew ? [] : db.invoices.where('orderId').equals(id!).toArray()), [id]);
  const [invoiceEdit, setInvoiceEdit] = useState<Invoice | 'new'>();
  const [invoiceView, setInvoiceView] = useState<string>();

  useEffect(() => {
    if (!isNew && order && orderItems && !dirty) {
      setD({
        supplierId: order.supplierId,
        status: order.status,
        date: localYmd(order.date),
        notes: order.notes ?? '',
        items: orderItems.map((i) => ({ id: i.id, productId: i.productId, quantity: i.quantity, factor: i.factor })),
      });
    }
  }, [isNew, order, orderItems, dirty]);

  if (!isNew && order === undefined) return <p className="muted">Cargando…</p>;
  if (!isNew && !order) return <p>El pedido no existe. <Link to="/pedidos">Volver</Link></p>;

  const locked = order?.status === 'recibido' || !can('orders.manage');
  const update = (patch: Partial<Draft>) => {
    setDirty(true);
    setD((x) => ({ ...x, ...patch }));
  };
  const setLine = (idx: number, patch: Partial<OrderLineDraft>) => update({ items: d.items.map((l, i) => (i === idx ? { ...l, ...patch } : l)) });
  const used = new Set(d.items.map((l) => l.productId));
  const fromSupplier = products.filter((p) => p.active && d.supplierId && (p.supplierId === d.supplierId || p.alternativeSupplierIds.includes(d.supplierId)));
  const others = products.filter((p) => p.active && !fromSupplier.includes(p));

  const save = async (status = d.status) => {
    if (!d.items.some((l) => l.productId && l.quantity > 0)) return notify('Agregá al menos un producto con cantidad.', { tone: 'error' });
    const saved = await run(() => saveOrder({ id: isNew ? undefined : id, ...d, status, date: new Date(`${d.date}T12:00:00`).toISOString() }), 'Pedido guardado');
    if (saved) {
      setDirty(false);
      if (isNew) navigate(`/pedidos/${saved.id}`, { replace: true });
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Eliminar pedido', message: `¿Eliminar el pedido #${order!.number}?`, danger: true, confirmLabel: 'Eliminar' }))) return;
    const undo = await run(() => deleteOrder(id!));
    if (undo) {
      notify(`Pedido #${order!.number} eliminado`, { undo: undo.restore });
      navigate('/pedidos');
    }
  };

  const openReceive = () => {
    if (dirty) return notify('Guardá los cambios antes de recibir el pedido.', { tone: 'error' });
    setReceived(Object.fromEntries((orderItems ?? []).map((i) => [i.id, i.quantity])));
    setReceiving(true);
  };

  const confirmReceive = async () => {
    const r = await run(() => receiveOrder(id!, (orderItems ?? []).map((i) => ({ itemId: i.id, receivedQuantity: received[i.id] ?? 0 }))));
    if (r) {
      setReceiving(false);
      notify(`Pedido recibido: ${r.lines.length} productos actualizados.`);
      if (can('invoices') && !invoices?.length && (await confirm({ title: 'Factura del pedido', message: '¿Querés sacarle una foto a la factura ahora?', confirmLabel: 'Sacar foto' })))
        setInvoiceEdit('new');
    }
  };

  const buildText = () =>
    orderText({
      number: order?.number,
      supplier: d.supplierId ? lk.supplier(d.supplierId) : undefined,
      business: settingsBiz.businessName,
      notes: d.notes,
      lines: d.items.filter((l) => l.productId).map((l) => {
        const p = byId.get(l.productId);
        return { name: p?.name ?? '?', quantity: l.quantity, unit: lk.unit(p?.purchaseUnitId) || lk.unit(p?.unitId) };
      }),
    });
  const copyText = async () => {
    await run(() => navigator.clipboard.writeText(buildText()), 'Pedido copiado al portapapeles');
  };
  const sendWhatsapp = () => {
    const phone = lk.suppliers.find((s) => s.id === d.supplierId)?.phone;
    window.open(whatsappUrl(buildText(), phone), '_blank', 'noopener');
  };

  return (
    <>
      <Link to="/pedidos" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={16} aria-hidden /> Pedidos</Link>
      <PageHeader
        title={isNew ? 'Nuevo pedido' : `Pedido #${order!.number}`}
        subtitle={order && <Badge tone={ORDER_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Badge>}
        actions={
          !isNew && (
            <>
              <button type="button" className="btn" onClick={sendWhatsapp}><MessageCircle size={16} aria-hidden /> WhatsApp</button>
              <button type="button" className="btn" onClick={copyText}><ClipboardCopy size={16} aria-hidden /> Copiar texto</button>
              {can('orders.manage') && <button type="button" className="btn" onClick={async () => { const c = await run(() => duplicateOrder(id!), 'Pedido duplicado'); if (c) navigate(`/pedidos/${c.id}`); }}><Copy size={16} aria-hidden /> Duplicar</button>}
              {order!.status !== 'recibido' && order!.status !== 'cancelado' && can('orders.receive') && <button type="button" className="btn btn-primary" onClick={openReceive}><PackageCheck size={16} aria-hidden /> Recibir</button>}
              {can('orders.manage') && <button type="button" className="btn btn-danger" onClick={remove}><Trash2 size={16} aria-hidden /> Eliminar</button>}
            </>
          )
        }
      />
      <div className="card card-pad stack">
        <div className="form-grid cols-3">
          <Field label="Proveedor">
            <Select value={d.supplierId ?? ''} disabled={locked} onChange={(e) => update({ supplierId: e.target.value || undefined })}>
              <option value="">Sin proveedor</option>
              {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Fecha"><Input type="date" value={d.date} disabled={locked} onChange={(e) => update({ date: e.target.value })} /></Field>
          <Field label="Estado">
            {locked ? <Input value={ORDER_STATUS_LABEL[d.status]} disabled /> : (
              <Select value={d.status} onChange={(e) => update({ status: e.target.value as OrderStatus })}>
                {EDITABLE_STATUSES.map((s) => <option key={s} value={s}>{ORDER_STATUS_LABEL[s]}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <h2 className="section-title">Productos</h2>
        {d.items.length === 0 && <p className="muted small">Todavía no agregaste productos.</p>}
        {d.items.map((l, idx) => {
          const p = byId.get(l.productId);
          const pu = lk.unit(p?.purchaseUnitId) || lk.unit(p?.unitId);
          const item = orderItems?.find((i) => i.id === l.id);
          return (
            <div key={l.id ?? idx} className="row wrap" style={{ alignItems: 'flex-end' }}>
              <Field label="Producto" className="grow">
                <Select value={l.productId} disabled={locked} onChange={(e) => setLine(idx, { productId: e.target.value, factor: byId.get(e.target.value)?.purchaseFactor })}>
                  <option value="">Elegir producto…</option>
                  {fromSupplier.length > 0 && (
                    <optgroup label={`De ${lk.supplier(d.supplierId)}`}>
                      {fromSupplier.map((x) => <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== l.productId}>{x.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label={fromSupplier.length ? 'Otros productos' : 'Productos'}>
                    {others.map((x) => <option key={x.id} value={x.id} disabled={used.has(x.id) && x.id !== l.productId}>{x.name}</option>)}
                  </optgroup>
                </Select>
              </Field>
              <Field label={`Cantidad${pu ? ` (${pu})` : ''}`} hint={p && p.purchaseFactor !== 1 ? `= ${fmtNumber(l.quantity * (l.factor ?? p.purchaseFactor))} ${lk.unit(p.unitId)}` : undefined}>
                <NumberInput value={l.quantity} disabled={locked} min={0} onChange={(v) => setLine(idx, { quantity: v ?? 0 })} style={{ width: 130 }} />
              </Field>
              {locked && item?.receivedQuantity !== undefined && <span className="small muted" style={{ paddingBottom: 12 }}>recibido {fmtNumber(item.receivedQuantity)}</span>}
              {!locked && (
                <button type="button" className="btn btn-ghost icon-btn" aria-label="Quitar producto" onClick={() => update({ items: d.items.filter((_, i) => i !== idx) })}><X size={18} /></button>
              )}
            </div>
          );
        })}
        {!locked && (
          <div><button type="button" className="btn btn-sm" onClick={() => update({ items: [...d.items, { productId: '', quantity: 1 }] })}><Plus size={16} aria-hidden /> Agregar producto</button></div>
        )}
        <Field label="Observaciones"><Textarea value={d.notes} disabled={locked} onChange={(e) => update({ notes: e.target.value })} /></Field>
        {!locked && (
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            {isNew && <button type="button" className="btn" onClick={() => save('borrador')}>Guardar borrador</button>}
            <button type="button" className="btn btn-primary" onClick={() => save(isNew && d.status === 'borrador' ? 'pendiente' : d.status)}>
              {isNew && d.status === 'borrador' ? 'Guardar como pendiente' : 'Guardar'}
            </button>
          </div>
        )}
        <p className="small muted">Los pedidos se gestionan en Stock Manager. No se envían a Maxirest: no hay una interfaz oficial documentada para órdenes de compra.</p>
      </div>

      {!isNew && can('invoices') && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="row wrap card-pad" style={{ paddingBottom: invoices?.length ? 8 : undefined }}>
            <h2 className="section-title grow" style={{ margin: 0 }}>Facturas de este pedido</h2>
            <button type="button" className="btn btn-sm" onClick={() => setInvoiceEdit('new')}><Camera size={16} aria-hidden /> Agregar factura</button>
          </div>
          {invoices && invoices.length > 0 && <InvoiceList invoices={invoices} onOpen={(i) => setInvoiceView(i.id)} />}
        </div>
      )}
      <InvoiceEditor open={!!invoiceEdit} invoice={invoiceEdit === 'new' ? undefined : invoiceEdit} defaults={{ orderId: id, supplierId: order?.supplierId }} onClose={() => setInvoiceEdit(undefined)} />
      <InvoiceViewer invoiceId={invoiceView} onClose={() => setInvoiceView(undefined)} onEdit={(inv) => { setInvoiceView(undefined); setInvoiceEdit(inv); }} />

      <Modal open={receiving} wide title={`Recibir pedido #${order?.number ?? ''}`} onClose={() => setReceiving(false)}
        footer={<><button type="button" className="btn" onClick={() => setReceiving(false)}>Cancelar</button><button type="button" className="btn btn-primary" onClick={confirmReceive}>Confirmar recepción</button></>}>
        <div className="stack">
          <p className="small muted">Ajustá la cantidad si llegó distinto a lo pedido. Se sumará al stock y quedará registrado como movimiento de ingreso.</p>
          {(orderItems ?? []).map((i) => {
            const p = byId.get(i.productId);
            const add = (received[i.id] ?? 0) * i.factor;
            return (
              <div key={i.id} className="count-item">
                <div className="grow" style={{ minWidth: 160 }}>
                  <div className="list-title">{p?.name ?? '(producto eliminado)'}</div>
                  {p && <div className="list-sub num">Stock anterior: {fmtNumber(p.stock)} · Pedido recibido: +{fmtNumber(add)} · Stock nuevo: <b>{fmtNumber(p.stock + add)}</b> {lk.unit(p.unitId)}</div>}
                </div>
                <NumberInput aria-label={`Cantidad recibida de ${p?.name ?? ''}`} value={received[i.id]} min={0} onChange={(v) => setReceived((r) => ({ ...r, [i.id]: v }))} style={{ width: 120 }} />
              </div>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
