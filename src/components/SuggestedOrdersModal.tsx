import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLookups, useProducts } from '../hooks/useData';
import { createSuggestedOrders, suggestOrders, type SuggestedGroup } from '../services/orderService';
import { updateSettings } from '../services/settingsService';
import type { SuggestionMode } from '../models';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { Modal } from './ui/Modal';
import { EmptyState, NumberInput, Segmented } from './ui';
import { fmtNumber } from '../utils/format';

export function SuggestedOrdersModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useSettings();
  const products = useProducts();
  const lk = useLookups();
  const navigate = useNavigate();
  const { run, notify } = useFeedback();
  const base = useMemo(() => suggestOrders(products, settings), [products, settings]);
  const [qty, setQty] = useState<Record<string, number | undefined>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setQty(Object.fromEntries(base.flatMap((g) => g.lines.map((l) => [l.product.id, l.quantity]))));
    setExcluded(new Set());
  }, [open, base]);

  const create = async () => {
    const groups: SuggestedGroup[] = base
      .map((g) => ({ ...g, lines: g.lines.filter((l) => !excluded.has(l.product.id) && (qty[l.product.id] ?? 0) > 0).map((l) => ({ ...l, quantity: qty[l.product.id]! })) }))
      .filter((g) => g.lines.length);
    if (!groups.length) return notify('No hay productos seleccionados.', { tone: 'error' });
    const created = await run(() => createSuggestedOrders(groups));
    if (created) {
      notify(`${created.length} ${created.length === 1 ? 'pedido creado' : 'pedidos creados'} en borrador.`);
      onClose();
      if (created.length === 1) navigate(`/pedidos/${created[0].id}`);
    }
  };

  return (
    <Modal open={open} wide title="Pedido sugerido" onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-primary" onClick={create} disabled={!base.length}>Crear pedidos</button></>}>
      <div className="stack">
        <div className="row wrap between">
          <p className="small muted">Productos en o por debajo del mínimo, agrupados por proveedor principal.</p>
          <Segmented<SuggestionMode> label="Cantidad sugerida" value={settings.suggestionMode} onChange={(v) => void updateSettings({ suggestionMode: v })}
            options={[{ value: 'toMax', label: 'Hasta el máximo' }, { value: 'toMin', label: 'Hasta el mínimo' }]} />
        </div>
        {base.length === 0 ? (
          <EmptyState title="No hace falta pedir nada">Ningún producto está por debajo de su stock mínimo.</EmptyState>
        ) : (
          base.map((g) => (
            <section key={g.supplierId ?? 'none'} className="card">
              <div className="card-head"><h3>{lk.supplier(g.supplierId) || 'Sin proveedor asignado'}</h3><span className="badge">{g.lines.length} productos</span></div>
              {g.lines.map((l) => {
                const p = l.product;
                const pu = lk.unit(p.purchaseUnitId) || lk.unit(p.unitId);
                return (
                  <div key={p.id} className="count-item">
                    <label className="check grow" style={{ minWidth: 180 }}>
                      <input type="checkbox" checked={!excluded.has(p.id)} onChange={(e) => setExcluded((s) => { const n = new Set(s); if (e.target.checked) n.delete(p.id); else n.add(p.id); return n; })} />
                      <span>
                        <span className="list-title">{p.name}</span>
                        <span className="list-sub" style={{ display: 'block' }}>Stock {fmtNumber(p.stock)} · mín {fmtNumber(p.minStock)} · máx {fmtNumber(p.maxStock)} · faltan {fmtNumber(l.needed)} {lk.unit(p.unitId)}{p.purchaseFactor !== 1 && ` (1 ${pu} = ${p.purchaseFactor})`}</span>
                      </span>
                    </label>
                    <div className="row" style={{ width: 160 }}>
                      <NumberInput aria-label={`Cantidad a pedir de ${p.name}`} value={qty[p.id]} onChange={(v) => setQty((q) => ({ ...q, [p.id]: v }))} min={0} />
                      <span className="small muted">{pu}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          ))
        )}
      </div>
    </Modal>
  );
}
