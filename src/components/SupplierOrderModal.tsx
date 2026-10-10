import { ArrowLeft, ChevronRight, MessageCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLookups, useProducts } from '../hooks/useData';
import type { Product } from '../models';
import { saveOrder } from '../services/orderService';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { fmtNumber, localYmd, matches } from '../utils/format';
import { orderText, whatsappUrl } from '../utils/orderText';
import { Stepper } from './Stepper';
import { Modal } from './ui/Modal';

/** Cantidad sugerida: lo que falta para llegar al máximo (o al mínimo), en unidad de compra. */
function suggested(p: Product): number | undefined {
  if (p.minStock <= 0 || p.stock > p.minStock) return undefined;
  const target = p.maxStock > p.minStock ? p.maxStock : p.minStock;
  const needed = target - Math.max(0, p.stock);
  if (needed <= 0) return undefined;
  const f = p.purchaseFactor > 0 ? p.purchaseFactor : 1;
  return f === 1 ? Math.ceil(needed * 1000) / 1000 : Math.ceil(needed / f);
}

/**
 * Pedir a un proveedor en pocos toques: elegís el proveedor, aparecen sus productos
 * (los que están bajo el mínimo ya con cantidad), ajustás y lo mandás por WhatsApp.
 */
export function SupplierOrderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const navigate = useNavigate();
  const { run, notify } = useFeedback();
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number | undefined>>({});

  useEffect(() => {
    if (!open) {
      setSupplierId(null);
      setQ('');
      setQty({});
    }
  }, [open]);

  const active = useMemo(() => products.filter((p) => p.active), [products]);
  const suppliers = useMemo(() => {
    const count = new Map<string, { total: number; low: number }>();
    for (const p of active) {
      for (const id of [p.supplierId, ...(p.alternativeSupplierIds ?? [])]) {
        if (!id) continue;
        const c = count.get(id) ?? { total: 0, low: 0 };
        c.total++;
        if (id === p.supplierId && suggested(p)) c.low++;
        count.set(id, c);
      }
    }
    return lk.suppliers
      .filter((s) => count.has(s.id))
      .map((s) => ({ ...s, ...count.get(s.id)! }))
      .sort((a, b) => b.low - a.low || b.total - a.total || a.name.localeCompare(b.name, 'es'));
  }, [active, lk.suppliers]);

  const supplier = lk.suppliers.find((s) => s.id === supplierId);
  const lines = useMemo(() => {
    if (!supplierId) return [];
    return active
      .filter((p) => p.supplierId === supplierId || p.alternativeSupplierIds?.includes(supplierId))
      .sort((a, b) => Number(!!suggested(b)) - Number(!!suggested(a)) || Number(b.supplierId === supplierId) - Number(a.supplierId === supplierId) || a.name.localeCompare(b.name, 'es'));
  }, [active, supplierId]);

  const pick = (id: string) => {
    setSupplierId(id);
    setQ('');
    const pre: Record<string, number | undefined> = {};
    for (const p of active) if (p.supplierId === id) pre[p.id] = suggested(p);
    setQty(pre);
  };

  const unitOf = (p: Product) => lk.unit(p.purchaseUnitId) || lk.unit(p.unitId);
  const chosen = lines.filter((p) => (qty[p.id] ?? 0) > 0);

  const create = async (send: boolean) => {
    if (!supplierId || !chosen.length) return;
    const order = await run(() =>
      saveOrder({
        supplierId,
        status: send ? 'enviado' : 'pendiente',
        date: localYmd(),
        items: chosen.map((p) => ({ productId: p.id, quantity: qty[p.id]!, factor: p.purchaseFactor })),
      }),
    );
    if (!order) return;
    if (send) {
      const text = orderText({ number: order.number, supplier: supplier?.name, business: settings.businessName, lines: chosen.map((p) => ({ name: p.name, quantity: qty[p.id]!, unit: unitOf(p) })) });
      window.open(whatsappUrl(text, supplier?.phone), '_blank', 'noopener');
    }
    notify(`Pedido #${order.number} ${send ? 'creado y listo para mandar' : 'creado'}.`);
    onClose();
    navigate(`/pedidos/${order.id}`);
  };

  const shown = q.trim() ? lines.filter((p) => matches(q, p.name, p.sku)) : lines;

  return (
    <Modal
      open={open}
      wide
      title={supplier ? `Pedir a ${supplier.name}` : 'Pedir a un proveedor'}
      onClose={onClose}
      footer={supplier ? (
        <>
          <button type="button" className="btn" onClick={() => setSupplierId(null)}><ArrowLeft size={16} aria-hidden /> Proveedores</button>
          <span className="grow" />
          <button type="button" className="btn" disabled={!chosen.length} onClick={() => create(false)}>Crear pedido</button>
          <button type="button" className="btn btn-primary" disabled={!chosen.length} onClick={() => create(true)}><MessageCircle size={18} aria-hidden /> Mandar por WhatsApp ({chosen.length})</button>
        </>
      ) : undefined}
    >
      {!supplier ? (
        suppliers.length === 0 ? (
          <p className="muted">Todavía no hay productos con proveedor asignado.</p>
        ) : (
          <div className="list">
            {suppliers.map((s) => (
              <button key={s.id} type="button" className="list-item" onClick={() => pick(s.id)}>
                <span className="grow">
                  <span className="list-title">{s.name}</span>
                  <span className="list-sub" style={{ display: 'block' }}>{s.total} productos{s.phone ? ` · ${s.phone}` : ''}</span>
                </span>
                {s.low > 0 && <span className="badge badge-bajo">{s.low} para reponer</span>}
                <ChevronRight size={18} className="muted" aria-hidden />
              </button>
            ))}
          </div>
        )
      ) : (
        <div className="stack">
          <label className="production-search">
            <Search size={18} aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto del proveedor" />
          </label>
          {!supplier.phone && <p className="small muted">Este proveedor no tiene teléfono cargado: WhatsApp te va a pedir que elijas el contacto.</p>}
          <div className="list">
            {shown.map((p) => (
              <div key={p.id} className={`count-item ${(qty[p.id] ?? 0) > 0 ? 'done' : ''}`}>
                <div className="grow" style={{ minWidth: 160 }}>
                  <div className="list-title">{p.name}</div>
                  <div className="list-sub">
                    Stock {fmtNumber(p.stock)} {lk.unit(p.unitId)}
                    {p.minStock > 0 && ` · mín ${fmtNumber(p.minStock)}`}
                    {p.supplierId !== supplierId && ' · proveedor alternativo'}
                    {` · pedir en ${unitOf(p) || 'unidades'}`}
                  </div>
                </div>
                <Stepper label={p.name} value={qty[p.id]} onChange={(v) => setQty((cur) => ({ ...cur, [p.id]: v }))} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
