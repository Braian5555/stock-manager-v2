import { ArrowLeft, Plus, Search, Store, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { db } from '../database/db';
import type { TransferItem } from '../models';
import { createTransfer, normalizeItems, transferCode } from '../services/transferService';
import { useLookups, useOutlets, useProducts } from '../hooks/useData';
import { useFeedback } from '../store/feedback';
import { EmptyState, Field, Input, NumberInput, PageHeader, Select, Textarea } from '../components/ui';
import { fmtNumber, matches } from '../utils/format';

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Line = { productId: string; quantity: number | undefined };

export function TransferEditorPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const outlets = useOutlets().filter((o) => o.active);
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm, notify } = useFeedback();
  const [outletId, setOutletId] = useState(params.get('punto') ?? '');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastAdded, setLastAdded] = useState<string>();
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  // "Repetir" un remito anterior: mismo punto y productos.
  useEffect(() => {
    const copy = params.get('copiar');
    if (!copy) return;
    void db.transfers.get(copy).then((t) => {
      if (!t) return;
      setOutletId(t.outletId);
      setLines(t.items.map((i) => ({ productId: i.productId, quantity: i.quantity })));
    });
  }, [params]);

  const used = new Set(lines.map((l) => l.productId));
  const results = q.trim() ? products.filter((p) => p.active && !used.has(p.id) && matches(q, p.name, p.sku)).slice(0, 8) : [];

  const add = (productId: string) => {
    setLastAdded(productId);
    setLines((ls) => [...ls, { productId, quantity: undefined }]);
    setQ('');
  };

  const save = async () => {
    const items = normalizeItems(lines.map((l) => ({ productId: l.productId, quantity: l.quantity ?? 0 })) as TransferItem[]);
    if (!outletId) return notify('Elegí a qué punto va la mercadería.', { tone: 'error' });
    if (!items.length) return notify('Agregá al menos un producto con cantidad.', { tone: 'error' });
    const outlet = outlets.find((o) => o.id === outletId);
    const short = items.filter((i) => (byId.get(i.productId)?.stock ?? 0) < i.quantity);
    const ok = await confirm({
      title: `Remito a ${outlet?.name ?? ''}`,
      message: (
        <>
          <p>Se van a restar {items.length} {items.length === 1 ? 'producto' : 'productos'} del Depósito Central y sumar a {outlet?.name}.</p>
          {short.length > 0 && <p className="small" style={{ color: 'var(--crit)' }}>Atención: {short.map((i) => byId.get(i.productId)?.name).join(', ')} {short.length === 1 ? 'queda' : 'quedan'} con stock negativo en el depósito. Revisá el stock con un conteo.</p>}
          <p className="small muted">Queda pendiente de cargar en Maxirest.</p>
        </>
      ),
      confirmLabel: 'Confirmar remito',
    });
    if (!ok) return;
    setSaving(true);
    const r = await run(() => createTransfer({ date, outletId, notes, items }));
    setSaving(false);
    if (r) {
      notify(`Remito ${transferCode(r.transfer.number)} registrado`);
      navigate(`/remitos?ver=${r.transfer.id}`, { replace: true });
    }
  };

  return (
    <>
      <Link to="/remitos" className="btn btn-ghost btn-sm" style={{ marginBottom: 8 }}><ArrowLeft size={16} aria-hidden /> Remitos</Link>
      <PageHeader title="Nuevo remito interno" subtitle="Sale del Depósito Central y entra al punto" />
      {outlets.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Store size={40} />} title="Primero creá los puntos" action={<Link to="/remitos?tab=puntos" className="btn btn-primary"><Plus size={18} aria-hidden /> Crear puntos</Link>}>
            Cargá los puntos gastronómicos que reciben mercadería (Parador, Confitería…).
          </EmptyState>
        </div>
      ) : (
        <div className="card card-pad stack">
          <div className="form-grid cols-2">
            <Field label="Punto que recibe">
              <Select value={outletId} onChange={(e) => setOutletId(e.target.value)}>
                <option value="">Elegir punto…</option>
                {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </Select>
            </Field>
            <Field label="Fecha"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>

          <h2 className="section-title">Productos</h2>
          <div className="search">
            <Search size={18} aria-hidden />
            <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto para agregar…" aria-label="Buscar producto para agregar"
              onKeyDown={(e) => { if (e.key === 'Enter' && results[0]) { e.preventDefault(); add(results[0].id); } }} />
          </div>
          {results.length > 0 && (
            <div className="card">
              <div className="list">
                {results.map((p) => (
                  <button key={p.id} type="button" className="list-item invoice-item" onClick={() => add(p.id)} aria-label={`Agregar ${p.name}`}>
                    <Plus size={16} aria-hidden />
                    <span className="grow truncate">{p.name}</span>
                    <span className="small muted num">Depósito: {fmtNumber(p.stock)} {lk.unit(p.unitId)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {q.trim() && results.length === 0 && <p className="small muted">No hay productos con ese nombre.</p>}
          {lines.length === 0 && !q && <p className="small muted">Buscá y agregá los productos que salen del depósito.</p>}

          {lines.map((l) => {
            const p = byId.get(l.productId);
            const over = p && l.quantity !== undefined && l.quantity > p.stock;
            return (
              <div key={l.productId} className="row transfer-line">
                <div className="grow">
                  <div className="list-title">{p?.name ?? '(producto eliminado)'}</div>
                  <div className={`list-sub num ${over ? 'neg' : ''}`}>En depósito: {fmtNumber(p?.stock)} {lk.unit(p?.unitId)}{over ? ' · no alcanza' : ''}</div>
                </div>
                <NumberInput aria-label={`Cantidad de ${p?.name ?? ''}`} value={l.quantity} min={0} placeholder="Cant."
                  autoFocus={l.productId === lastAdded}
                  onChange={(v) => setLines((ls) => ls.map((x) => (x.productId === l.productId ? { ...x, quantity: v } : x)))}
                  style={{ width: 88 }} />
                <span className="small muted" style={{ minWidth: 24 }}>{lk.unit(p?.unitId)}</span>
                <button type="button" className="btn btn-ghost icon-btn" aria-label={`Quitar ${p?.name ?? 'producto'}`} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}><X size={18} /></button>
              </div>
            );
          })}

          <Field label="Observaciones" hint="opcional"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ej.: retiró Juan" /></Field>
          <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
            <Link to="/remitos" className="btn">Cancelar</Link>
            <button type="button" className="btn btn-primary" disabled={saving} onClick={save}>Confirmar remito</button>
          </div>
        </div>
      )}
    </>
  );
}
