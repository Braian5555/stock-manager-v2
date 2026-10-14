import { Check, EyeOff, Pencil, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InvoiceItem, Product } from '../../models';
import { ITEM_STATUS_LABEL, similarity, toStockQty, type CatalogLookups } from '../../services/invoiceAI';
import { fmtNumber, matches } from '../../utils/format';
import { NumberInput } from '../ui';

const TONE: Record<InvoiceItem['status'], string> = { ok: 'ok', check: 'warn', none: 'error', ignored: '' };

/**
 * Revisión de los renglones leídos de la factura: a qué producto corresponde cada uno y cuánto
 * suma en su unidad de stock. Lo que la IA reconoció seguro queda en verde; lo demás se confirma.
 */
export function InvoiceItemsReview({ items, onChange, products, lk }: {
  items: InvoiceItem[];
  onChange: (items: InvoiceItem[]) => void;
  products: Product[];
  lk: CatalogLookups;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const set = (id: string, patch: Partial<InvoiceItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const pick = (item: InvoiceItem, p: Product) => {
    set(item.id, { productId: p.id, stockQty: toStockQty(item.quantity, item.unit, p, lk), status: 'ok' });
    setEditing(null);
  };
  const n = (s: InvoiceItem['status']) => items.filter((i) => i.status === s).length;
  const pending = n('check') + n('none');
  const confirmAll = () => onChange(items.map((i) => (i.status === 'check' && i.productId ? { ...i, status: 'ok' } : i)));

  return (
    <section className="inv-review" aria-label="Renglones de la factura">
      <div className="row wrap inv-review-head">
        <strong>{items.length} {items.length === 1 ? 'renglón' : 'renglones'}</strong>
        <span className="badge badge-ok">{n('ok')} {n('ok') === 1 ? 'reconocido' : 'reconocidos'}</span>
        {n('check') > 0 && <span className="badge badge-warn">{n('check')} para revisar</span>}
        {n('none') > 0 && <span className="badge badge-error">{n('none')} sin producto</span>}
        {n('ignored') > 0 && <span className="badge">{n('ignored')} {n('ignored') === 1 ? 'no va' : 'no van'} al stock</span>}
        <span className="grow" />
        {n('check') > 0 && <button type="button" className="btn btn-sm" onClick={confirmAll}><Check size={15} aria-hidden /> Confirmar sugeridos</button>}
      </div>
      {pending > 0 && <p className="small muted">Revisá los renglones en amarillo y rojo: elegí el producto o marcá “No va al stock” (envases, fletes, artículos que no controlás).</p>}

      <ul className="inv-items">
        {items.map((item) => {
          const p = item.productId ? byId.get(item.productId) : undefined;
          const unit = p ? lk.unit(p.unitId) || 'u' : '';
          return (
            <li key={item.id} className={`inv-item status-${item.status}`}>
              <div className="inv-item-top">
                <div className="grow">
                  <div className="inv-item-desc">{item.description}</div>
                  <div className="small muted">
                    {fmtNumber(item.quantity)} {item.unit ?? ''}
                    {item.unitPrice != null ? ` · $${fmtNumber(item.unitPrice)} c/u` : ''}
                    {item.lineTotal != null ? ` · total $${fmtNumber(item.lineTotal)}` : ''}
                    {item.code ? ` · cód. ${item.code}` : ''}
                  </div>
                </div>
                <span className={`badge badge-${TONE[item.status]}`}>{ITEM_STATUS_LABEL[item.status]}</span>
              </div>

              {item.status === 'ignored' ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(item.id, { status: item.productId ? 'check' : 'none' })}><RotateCcw size={15} aria-hidden /> Volver a incluir</button>
              ) : (
                <div className="inv-item-match">
                  <button type="button" className="btn btn-sm inv-item-product" onClick={() => setEditing(editing === item.id ? null : item.id)} aria-expanded={editing === item.id} aria-label={`Producto para ${item.description}`}>
                    {p ? <span className="truncate">{p.name}</span> : <span className="muted">Elegir producto</span>}
                    <Pencil size={14} aria-hidden />
                  </button>
                  {p && (
                    <label className="inv-item-qty">
                      <span className="small muted">Suma</span>
                      <NumberInput value={item.stockQty} min={0} onChange={(v) => set(item.id, { stockQty: v })} aria-label={`Cantidad en stock de ${item.description}`} />
                      <span className="small">{unit}</span>
                    </label>
                  )}
                  {item.status === 'check' && p && <button type="button" className="btn btn-sm" onClick={() => set(item.id, { status: 'ok' })}><Check size={15} aria-hidden /> Es este</button>}
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => { set(item.id, { status: 'ignored' }); setEditing(null); }}><EyeOff size={15} aria-hidden /> No va al stock</button>
                </div>
              )}
              {editing === item.id && <ProductSearch item={item} products={products} lk={lk} onPick={(prod) => pick(item, prod)} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Buscador dentro del renglón: arranca con los productos más parecidos al texto de la factura. */
function ProductSearch({ item, products, lk, onPick }: { item: InvoiceItem; products: Product[]; lk: CatalogLookups; onPick: (p: Product) => void }) {
  const [q, setQ] = useState('');
  const active = useMemo(() => products.filter((p) => p.active), [products]);
  const list = useMemo(() => {
    if (q.trim()) return active.filter((p) => matches(q, p.name, p.sku, p.barcode)).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 12);
    return active.map((p) => ({ p, s: similarity(item.description, p.name) })).filter((x) => x.s > 0.15).sort((a, b) => b.s - a.s).slice(0, 8).map((x) => x.p);
  }, [q, active, item.description]);
  return (
    <div className="inv-search">
      <label className="production-search">
        <Search size={18} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" aria-label={`Buscar producto para ${item.description}`} autoFocus />
      </label>
      {!q.trim() && list.length > 0 && <div className="small muted">Parecidos:</div>}
      <div className="list">
        {list.map((p) => (
          <button key={p.id} type="button" className="list-item" onClick={() => onPick(p)}>
            <span className="grow list-title">{p.name}</span>
            <span className="small muted">{lk.unit(p.unitId) || 'u'}</span>
          </button>
        ))}
        {list.length === 0 && <p className="small muted">{q.trim() ? 'No hay productos con ese nombre.' : 'Escribí para buscar.'}</p>}
      </div>
    </div>
  );
}
