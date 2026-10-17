import { Check, EyeOff, PackagePlus, Pencil, RotateCcw, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { InvoiceItem, Product } from '../../models';
import type { Lookups } from '../../hooks/useData';
import { ITEM_STATUS_LABEL, isPackUnit, needsPackSize, similarity, toStockQty } from '../../services/invoiceAI';
import { createProductFromLine, suggestName } from '../../services/invoiceStock';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtNumber, matches } from '../../utils/format';
import { Field, Input, NumberInput, Select } from '../ui';

const TONE: Record<InvoiceItem['status'], string> = { ok: 'ok', check: 'warn', none: 'error', ignored: '' };

/** "B" → "bulto", "CJ" → "caja": cómo nombrar la unidad de la factura en las preguntas. */
function packName(unit?: string): string {
  const u = (unit ?? '').toLowerCase().replace(/\./g, '');
  if (/^(b|bu|bul|bult|bulto|bultos|bto|btos)$/.test(u)) return 'bulto';
  if (/^(cj|cja|caj|caja|cajas)$/.test(u)) return 'caja';
  if (/^(fdo|fardo|fardos)$/.test(u)) return 'fardo';
  if (/^(pk|pack|packs)$/.test(u)) return 'pack';
  if (/^(paq|pqt|paquete|paquetes)$/.test(u)) return 'paquete';
  if (/^(bls|bolsa|bolsas)$/.test(u)) return 'bolsa';
  return u || 'caja';
}

/**
 * Revisión de los renglones leídos de la factura: a qué producto corresponde cada uno y cuánto
 * suma en su unidad de stock. Lo que la IA reconoció seguro queda en verde; lo demás se confirma.
 * Si un renglón no está en el catálogo, se puede crear el producto ahí mismo.
 */
export function InvoiceItemsReview({ items, onChange, products, lk, supplierId, readOnly }: {
  items: InvoiceItem[];
  onChange: (items: InvoiceItem[]) => void;
  products: Product[];
  lk: Lookups;
  /** Proveedor de la factura (se asigna a los productos que se creen). */
  supplierId?: string;
  /** Ya cargada al stock: sólo se muestra. */
  readOnly?: boolean;
}) {
  const { can } = useSession();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const set = (id: string, patch: Partial<InvoiceItem>) => onChange(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const replace = (item: InvoiceItem) => onChange(items.map((i) => (i.id === item.id ? item : i)));
  const pick = (item: InvoiceItem, p: Product) => {
    set(item.id, { productId: p.id, stockQty: toStockQty(item.quantity, item.unit, p, lk, item.packSize), status: 'ok' });
    setEditing(null);
  };
  const setPack = (item: InvoiceItem, p: Product, n: number | undefined) =>
    set(item.id, { packSize: n && n >= 1 ? Math.round(n) : undefined, stockQty: toStockQty(item.quantity, item.unit, p, lk, n && n >= 1 ? n : undefined) });
  const n = (s: InvoiceItem['status']) => items.filter((i) => i.status === s).length;
  const missingPack = items.filter((i) => i.status === 'ok' && needsPackSize(i, byId.get(i.productId ?? ''), lk)).length;
  const pending = n('check') + n('none') + missingPack;
  const confirmAll = () => onChange(items.map((i) => (i.status === 'check' && i.productId ? { ...i, status: 'ok' } : i)));
  const canCreate = can('catalog.manage');

  return (
    <section className="inv-review" aria-label="Renglones de la factura">
      <div className="row wrap inv-review-head">
        <strong>{items.length} {items.length === 1 ? 'renglón' : 'renglones'}</strong>
        <span className="badge badge-ok">{n('ok')} {n('ok') === 1 ? 'reconocido' : 'reconocidos'}</span>
        {n('check') > 0 && <span className="badge badge-warn">{n('check')} para revisar</span>}
        {n('none') > 0 && <span className="badge badge-error">{n('none')} sin producto</span>}
        {missingPack > 0 && <span className="badge badge-warn">{missingPack} sin unidades por caja</span>}
        {n('ignored') > 0 && <span className="badge">{n('ignored')} {n('ignored') === 1 ? 'no va' : 'no van'} al stock</span>}
        <span className="grow" />
        {!readOnly && n('check') > 0 && <button type="button" className="btn btn-sm" onClick={confirmAll}><Check size={15} aria-hidden /> Confirmar sugeridos</button>}
      </div>
      {!readOnly && pending > 0 && (
        <p className="small muted">
          Revisá los renglones en amarillo y rojo: elegí el producto{canCreate ? ', creá uno nuevo' : ''} o marcá “No va al stock” (envases, fletes, artículos que no controlás).
          {missingPack > 0 && ' En los que vienen por caja o bulto, poné cuántas unidades trae cada uno (se recuerda para la próxima).'}
        </p>
      )}

      <ul className="inv-items">
        {items.map((item) => {
          const p = item.productId ? byId.get(item.productId) : undefined;
          const unit = p ? lk.unit(p.unitId) || 'u' : '';
          const askPack = !!p && item.status !== 'ignored' && isPackUnit(item.unit) && !(p.purchaseFactor > 1) && !isPackUnit(unit) && (needsPackSize(item, p, lk) || item.packSize != null);
          const missing = !!p && item.status === 'ok' && needsPackSize(item, p, lk);
          const packLabel = packName(item.unit);
          return (
            <li key={item.id} className={`inv-item status-${missing ? 'check' : item.status}`}>
              <div className="inv-item-top">
                <div className="grow">
                  <div className="inv-item-desc">{item.description}</div>
                  <div className="small muted">
                    {fmtNumber(item.quantity)} {item.unit ?? ''}
                    {item.packSize && item.packSize > 1 ? ` (x${item.packSize})` : ''}
                    {item.unitPrice != null ? ` · $${fmtNumber(item.unitPrice)} c/u` : ''}
                    {item.lineTotal != null ? ` · total $${fmtNumber(item.lineTotal)}` : ''}
                    {item.code ? ` · cód. ${item.code}` : ''}
                  </div>
                </div>
                {missing ? <span className="badge badge-warn">Falta cuántas trae</span> : <span className={`badge badge-${TONE[item.status]}`}>{ITEM_STATUS_LABEL[item.status]}</span>}
              </div>

              {readOnly ? (
                <div className="small">{item.status === 'ignored' ? 'No va al stock' : p ? <><b>{p.name}</b>: +{fmtNumber(item.stockQty ?? 0)} {unit}</> : 'Sin producto'}</div>
              ) : item.status === 'ignored' ? (
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(item.id, { status: item.productId ? 'check' : 'none' })}><RotateCcw size={15} aria-hidden /> Volver a incluir</button>
              ) : (
                <>
                  <div className="inv-item-match">
                    <button type="button" className="btn btn-sm inv-item-product" onClick={() => { setEditing(editing === item.id ? null : item.id); setCreating(null); }} aria-expanded={editing === item.id} aria-label={`Producto para ${item.description}`}>
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
                    {!p && canCreate && (
                      <button type="button" className="btn btn-sm" onClick={() => { setCreating(creating === item.id ? null : item.id); setEditing(null); }} aria-expanded={creating === item.id}>
                        <PackagePlus size={15} aria-hidden /> Crear producto
                      </button>
                    )}
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => { set(item.id, { status: 'ignored' }); setEditing(null); setCreating(null); }}><EyeOff size={15} aria-hidden /> No va al stock</button>
                  </div>
                  {askPack && p && (
                    <label className={`inv-item-pack small ${missing ? 'missing' : ''}`}>
                      <span>Cada {packLabel} trae</span>
                      <NumberInput value={item.packSize} min={1} onChange={(v) => setPack(item, p, v)} placeholder="?" aria-label={`Unidades por ${packLabel} de ${item.description}`} />
                      <span>{unit}</span>
                    </label>
                  )}
                </>
              )}
              {!readOnly && editing === item.id && (
                <ProductSearch item={item} products={products} lk={lk} onPick={(prod) => pick(item, prod)}
                  onCreate={canCreate ? () => { setEditing(null); setCreating(item.id); } : undefined} />
              )}
              {!readOnly && creating === item.id && (
                <NewProductForm item={item} lk={lk} supplierId={supplierId} packLabel={packLabel}
                  onCancel={() => setCreating(null)} onCreated={(updated) => { replace(updated); setCreating(null); }} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Buscador dentro del renglón: arranca con los productos más parecidos al texto de la factura. */
function ProductSearch({ item, products, lk, onPick, onCreate }: { item: InvoiceItem; products: Product[]; lk: Lookups; onPick: (p: Product) => void; onCreate?: () => void }) {
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
      {onCreate && <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={onCreate}><PackagePlus size={15} aria-hidden /> No está: crear producto nuevo</button>}
    </div>
  );
}

/** Alta rápida de un producto desde el renglón: nombre, familia, unidad de stock y unidades por caja. */
function NewProductForm({ item, lk, supplierId, packLabel, onCancel, onCreated }: {
  item: InvoiceItem;
  lk: Lookups;
  supplierId?: string;
  packLabel: string;
  onCancel: () => void;
  onCreated: (item: InvoiceItem) => void;
}) {
  const { run } = useFeedback();
  const [name, setName] = useState(() => suggestName(item.description));
  const [categoryId, setCategoryId] = useState('');
  const [unitId, setUnitId] = useState(() => lk.units.find((u) => u.abbreviation === 'u')?.id ?? lk.units[0]?.id ?? '');
  const [packSize, setPackSize] = useState<number | undefined>(item.packSize);
  const [saving, setSaving] = useState(false);
  const unitAbbr = lk.unit(unitId) || 'u';
  // Viene por caja/bulto y se cuenta suelto: hace falta saber cuántas trae.
  const pack = isPackUnit(item.unit) && !isPackUnit(unitAbbr);

  const create = async () => {
    setSaving(true);
    const r = await run(() => createProductFromLine(item, { name, categoryId, unitId, packSize: pack ? packSize : undefined, supplierId }, lk), 'Producto creado');
    setSaving(false);
    if (r) onCreated(r.item);
  };

  return (
    <div className="inv-new card card-pad stack" role="group" aria-label={`Nuevo producto para ${item.description}`}>
      <strong className="small">Nuevo producto</strong>
      <div className="form-grid cols-2">
        <Field label="Nombre"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Familia">
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Sin familia</option>
            {lk.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Se cuenta en" hint="unidad de stock">
          <Select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
            {lk.units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
          </Select>
        </Field>
        {pack && (
          <Field label={`Cada ${packLabel} trae`} hint={unitAbbr}>
            <NumberInput value={packSize} min={1} onChange={setPackSize} placeholder="Ej.: 6" />
          </Field>
        )}
      </div>
      <div className="row wrap">
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || !name.trim() || (pack && !packSize)} onClick={() => void create()}>
          <PackagePlus size={15} aria-hidden /> Crear y usar
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
