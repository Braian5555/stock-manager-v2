import { Camera, ImagePlus, Loader2, Sparkles, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { localYmd, normalize } from '../../utils/format';
import { db } from '../../database/db';
import { saveEntity } from '../../services/entityService';
import type { Invoice, InvoiceItem } from '../../models';
import { compressImage } from '../../services/imageService';
import { getInvoiceImage, MAX_PAGES, newPageId, saveInvoice, type PageDraft } from '../../services/invoiceService';
import { readInvoicePhotos } from '../../services/invoiceAI';
import { useCloud } from '../../cloud/cloudService';
import { useSettings } from '../../store/settings';
import { InvoiceItemsReview } from './InvoiceItemsReview';
import { useLookups, useProducts } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { Modal } from '../ui/Modal';
import { Field, Input, NumberInput, Textarea } from '../ui';

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
  const products = useProducts();
  const cloud = useCloud();
  const settings = useSettings();
  const { run, notify, confirm } = useFeedback();
  const listId = useId();
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [date, setDate] = useState(today());
  // Proveedor por nombre: se elige de la lista o se escribe uno nuevo (se crea al guardar).
  // `undefined` = sin tocar: se conserva el proveedor que ya tenía (aunque la lista no haya cargado).
  const [supplierName, setSupplierName] = useState<string | undefined>();
  const initialSupplierId = invoice?.supplierId ?? defaults?.supplierId ?? '';
  const shownSupplier = supplierName ?? lk.supplier(initialSupplierId) ?? '';
  const [number, setNumber] = useState('');
  const [total, setTotal] = useState<number | undefined>();
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(0);
  const [saving, setSaving] = useState(false);
  const [items, setItems] = useState<InvoiceItem[] | undefined>();
  const [aiReadAt, setAiReadAt] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  // En las pruebas automáticas el lector se reemplaza; en uso real hace falta la nube.
  const aiAvailable = cloud.phase === 'linked' || !!(globalThis as { __smInvoiceReader?: unknown }).__smInvoiceReader;

  useEffect(() => {
    if (!open) return;
    setPages(invoice ? invoice.pages.map((p) => ({ id: p.id, existing: p })) : []);
    setDate(invoice?.date ?? today());
    setSupplierName(undefined);
    setNumber(invoice?.number ?? '');
    setTotal(invoice?.total);
    setNotes(invoice?.notes ?? '');
    setItems(invoice?.items);
    setAiReadAt(invoice?.aiReadAt);
    setWarnings(invoice?.aiWarnings ?? []);
  }, [open, invoice, defaults?.supplierId]);

  const readAI = async () => {
    if (items?.length && !(await confirm({ title: 'Volver a leer', message: 'Se reemplazan los renglones que ya revisaste por una lectura nueva.', confirmLabel: 'Leer de nuevo' }))) return;
    setReading(true);
    const r = await run(async () => {
      const images = await Promise.all(pages.map(async (p) => ('image' in p ? { type: p.image.type, data: p.image.data } : getInvoiceImage(p.id, invoice!.id))));
      return readInvoicePhotos(images.map((i) => ({ type: i.type, data: i.data })), products, lk, { readerUrl: settings.aiReaderUrl });
    });
    setReading(false);
    if (!r) return;
    setItems(r.items);
    setAiReadAt(new Date().toISOString());
    setWarnings(r.warnings);
    // Sólo se completan los datos que todavía están vacíos.
    if (!shownSupplier.trim() && r.supplierName) setSupplierName(r.supplierName);
    if (!number.trim() && r.number) setNumber(r.number);
    if (r.date && !invoice && date === today()) setDate(r.date);
    if (total === undefined && r.total != null) setTotal(r.total);
    const pend = r.items.filter((i) => i.status !== 'ok').length;
    notify(r.items.length ? `Leí ${r.items.length} renglones${pend ? `: ${pend} para revisar` : ', todos reconocidos'}` : 'No encontré renglones de productos en la foto.', r.items.length ? undefined : { tone: 'error' });
  };

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
      async () => {
        let supplierId = initialSupplierId;
        if (supplierName !== undefined) {
          const name = supplierName.trim();
          const found = name ? (await db.suppliers.toArray()).find((x) => normalize(x.name) === normalize(name)) : undefined;
          supplierId = !name ? '' : (found?.id ?? (await saveEntity(db.suppliers, { name })).id);
        }
        // El pedido vinculado (de antes) se conserva al editar.
        return saveInvoice({ id: invoice?.id, date, supplierId, orderId: invoice?.orderId ?? defaults?.orderId ?? '', number, total, notes, pages, items, aiReadAt, aiWarnings: warnings });
      },
      invoice ? 'Factura actualizada' : 'Factura guardada',
    );
    setSaving(false);
    if (saved) {
      onSaved?.(saved);
      onClose();
    }
  };

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
        {pages.length > 0 && (
          <div className="inv-ai">
            <Sparkles size={20} aria-hidden />
            <p className="grow small">
              {aiAvailable
                ? items?.length ? `Leída con IA${aiReadAt ? ` el ${new Date(aiReadAt).toLocaleDateString('es-AR')}` : ''}. Revisá los renglones abajo.` : 'La IA lee los productos de la foto y los busca en tu catálogo. Después revisás y confirmás.'
                : 'Para leer los productos con IA, conectá la app a la nube (Configuración → Cuenta y nube).'}
            </p>
            {aiAvailable && (
              <button type="button" className="btn btn-primary" disabled={reading || busy > 0} onClick={() => void readAI()}>
                {reading ? <><Loader2 size={18} className="spin" aria-hidden /> Leyendo…</> : <><Sparkles size={18} aria-hidden /> {items?.length ? 'Leer de nuevo' : 'Leer con IA'}</>}
              </button>
            )}
          </div>
        )}
        {reading && <p className="small muted" role="status">Leyendo la factura: tarda entre 10 y 40 segundos.</p>}
        {warnings.length > 0 && (
          <div className="alert" role="note"><span><b>Avisos de la lectura:</b> {warnings.join(' · ')}</span></div>
        )}
        {items && items.length > 0 && <InvoiceItemsReview items={items} onChange={setItems} products={products} lk={lk} />}
        <div className="form-grid cols-2">
          <Field label="Proveedor" hint="elegí o escribí uno nuevo">
            <Input list={listId} value={shownSupplier} onChange={(e) => setSupplierName(e.target.value)} placeholder="Ej.: Lo de Camilo" autoComplete="off" />
          </Field>
          <datalist id={listId}>{lk.suppliers.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          <Field label="Fecha de la factura"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Número de factura" hint="opcional"><Input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="Ej.: A 0001-00012345" /></Field>
          <Field label="Total" hint="opcional"><NumberInput value={total} min={0} onChange={setTotal} placeholder="0,00" /></Field>
        </div>
        <Field label="Notas" hint="opcional"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
