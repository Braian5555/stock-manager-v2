import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, ImagePlus, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { localYmd } from '../../utils/format';
import { db } from '../../database/db';
import type { Invoice } from '../../models';
import { compressImage } from '../../services/imageService';
import { MAX_PAGES, newPageId, saveInvoice, type PageDraft } from '../../services/invoiceService';
import { useLookups, EMPTY } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { Modal } from '../ui/Modal';
import { Field, Input, NumberInput, Select, Textarea } from '../ui';

const today = () => localYmd();

interface Props {
  open: boolean;
  onClose: () => void;
  /** Factura a editar (si falta, es nueva). */
  invoice?: Invoice;
  /** Valores iniciales para una factura nueva (p. ej. desde un pedido). */
  defaults?: { supplierId?: string; orderId?: string };
  onSaved?: (inv: Invoice) => void;
}

export function InvoiceEditor({ open, onClose, invoice, defaults, onSaved }: Props) {
  const lk = useLookups();
  const { run, notify } = useFeedback();
  const orders = useLiveQuery(() => db.orders.orderBy('number').reverse().limit(200).toArray(), []) ?? EMPTY;
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [date, setDate] = useState(today());
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [number, setNumber] = useState('');
  const [total, setTotal] = useState<number | undefined>();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPages(invoice ? invoice.pages.map((p) => ({ id: p.id, existing: p })) : []);
    setDate(invoice?.date ?? today());
    setSupplierId(invoice?.supplierId ?? defaults?.supplierId ?? '');
    setOrderId(invoice?.orderId ?? defaults?.orderId ?? '');
    setNumber(invoice?.number ?? '');
    setTotal(invoice?.total);
    setNotes(invoice?.notes ?? '');
  }, [open, invoice, defaults?.supplierId, defaults?.orderId]);

  const addFiles = async (files: FileList | null) => {
    const list = [...(files ?? [])];
    if (!list.length) return;
    const room = MAX_PAGES - pages.length;
    if (list.length > room) notify(`Máximo ${MAX_PAGES} fotos por factura.`, { tone: 'error' });
    setBusy((b) => b + 1);
    try {
      for (const f of list.slice(0, Math.max(0, room))) {
        try {
          const image = await compressImage(f);
          setPages((ps) => [...ps, { id: newPageId(), image }]);
        } catch (e) {
          notify(e instanceof Error ? e.message : 'No se pudo leer la imagen.', { tone: 'error' });
        }
      }
    } finally {
      setBusy((b) => b - 1);
    }
  };

  const save = async () => {
    setSaving(true);
    const saved = await run(
      () => saveInvoice({ id: invoice?.id, date, supplierId, orderId, number, total, notes, pages }),
      invoice ? 'Factura actualizada' : 'Factura guardada',
    );
    setSaving(false);
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  };

  const supplierOrders = orders.filter((o) => !supplierId || o.supplierId === supplierId || o.id === orderId);

  return (
    <Modal open={open} wide title={invoice ? 'Editar factura' : 'Nueva factura'} onClose={onClose}
      footer={<>
        <button type="button" className="btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn btn-primary" disabled={busy > 0 || saving} onClick={save}>Guardar factura</button>
      </>}>
      <div className="stack">
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={() => camRef.current?.click()} disabled={pages.length >= MAX_PAGES}>
            <Camera size={18} aria-hidden /> Sacar foto
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={pages.length >= MAX_PAGES}>
            <ImagePlus size={18} aria-hidden /> Elegir de la galería
          </button>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden aria-label="Foto desde la cámara"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <input ref={fileRef} type="file" accept="image/*" multiple hidden aria-label="Fotos desde la galería"
            onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        {pages.length === 0 && busy === 0 && <p className="muted small">Sacale una foto a cada hoja de la factura. Si tiene varias hojas, agregá una foto por hoja.</p>}
        {(pages.length > 0 || busy > 0) && (
          <div className="invoice-pages" aria-label="Fotos de la factura">
            {pages.map((p, i) => {
              const thumb = 'image' in p ? p.image.thumb : p.existing.thumb;
              return (
                <figure key={p.id} className="invoice-page-thumb">
                  {thumb ? <img src={thumb} alt={`Hoja ${i + 1}`} /> : <div className="invoice-thumb-empty">Hoja {i + 1}</div>}
                  <figcaption>Hoja {i + 1}</figcaption>
                  <button type="button" className="btn btn-ghost icon-btn" aria-label={`Quitar hoja ${i + 1}`} onClick={() => setPages((ps) => ps.filter((x) => x.id !== p.id))}><X size={16} /></button>
                </figure>
              );
            })}
            {busy > 0 && <div className="invoice-page-thumb processing" role="status"><Loader2 size={22} className="spin" aria-hidden /> Procesando foto…</div>}
          </div>
        )}
        <div className="form-grid cols-2">
          <Field label="Proveedor">
            <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Sin proveedor</option>
              {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Fecha de la factura"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Número de factura" hint="opcional"><Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej.: A 0001-00012345" /></Field>
          <Field label="Total" hint="opcional"><NumberInput value={total} min={0} onChange={setTotal} placeholder="0,00" /></Field>
          <Field label="Pedido" hint="opcional">
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Sin pedido</option>
              {supplierOrders.map((o) => <option key={o.id} value={o.id}>Pedido #{o.number}{o.supplierId ? ` · ${lk.supplier(o.supplierId)}` : ''}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Notas" hint="opcional"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
