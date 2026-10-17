import { CheckCircle2, Download, Loader2, PackageCheck, Pencil, Sparkles, Trash2, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import type { Invoice } from '../../models';
import { base64ToBlob } from '../../services/imageService';
import { deleteInvoice, getInvoiceImage, invoiceFileName } from '../../services/invoiceService';
import { downloadBlob, safeFilename } from '../../exports/download';
import { useLookups, useProducts } from '../../hooks/useData';
import { ITEM_STATUS_LABEL, pendingCount } from '../../services/invoiceAI';
import { applyInvoiceToStock, learnFromInvoice, loadableItems, undoInvoiceStock } from '../../services/invoiceStock';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtDay, fmtMoney, fmtNumber } from '../../utils/format';
import { Modal } from '../ui/Modal';

/** Una hoja de la factura: carga la foto (del dispositivo o de la nube) y permite descargarla. */
function PageImage({ invoice, index, supplierName }: { invoice: Invoice; index: number; supplierName: string }) {
  const page = invoice.pages[index];
  const { notify } = useFeedback();
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [blob, setBlob] = useState<Blob>();

  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setError(undefined);
    getInvoiceImage(page.id, invoice.id)
      .then((img) => {
        if (!alive) return;
        const b = base64ToBlob(img.data, img.type);
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [page.id, invoice.id]);

  const name = invoiceFileName(invoice, supplierName, index, safeFilename);
  const label = invoice.pages.length > 1 ? `Descargar hoja ${index + 1}` : 'Descargar foto';

  return (
    <figure className="invoice-page">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir en tamaño completo">
          <img src={url} alt={`Factura, hoja ${index + 1}`} />
        </a>
      ) : error ? (
        <div className="invoice-page-msg">{page.thumb && <img src={page.thumb} alt="" />}<p className="small">{error}</p></div>
      ) : (
        <div className="invoice-page-msg" role="status"><Loader2 size={22} className="spin" aria-hidden /> Cargando foto…</div>
      )}
      <figcaption className="row wrap">
        {invoice.pages.length > 1 && <span className="muted small grow">Hoja {index + 1} de {invoice.pages.length}</span>}
        <button type="button" className="btn btn-sm" disabled={!blob} onClick={() => { downloadBlob(blob!, name); notify(`Descargando ${name}`); }}>
          <Download size={16} aria-hidden /> {label}
        </button>
      </figcaption>
    </figure>
  );
}

export function InvoiceViewer({ invoiceId, onClose, onEdit, canReadAI }: { invoiceId?: string; onClose: () => void; onEdit: (inv: Invoice, ai?: boolean) => void; canReadAI?: boolean }) {
  const invoice = useLiveQuery(async () => (invoiceId ? ((await db.invoices.get(invoiceId)) ?? null) : undefined), [invoiceId]);
  const order = useLiveQuery(() => (invoice?.orderId ? db.orders.get(invoice.orderId) : undefined), [invoice?.orderId]);
  const lk = useLookups();
  const { can } = useSession();
  const { confirm, run } = useFeedback();
  const supplierName = lk.supplier(invoice?.supplierId);
  const canDelete = can('admin') || can('orders.manage');

  const remove = async () => {
    if (!invoice) return;
    if (!(await confirm({ title: 'Eliminar factura', message: 'Se borra la factura y sus fotos en todos los dispositivos. ¿Continuar?', danger: true, confirmLabel: 'Eliminar' }))) return;
    if (await run(async () => { await deleteInvoice(invoice.id); return true; }, 'Factura eliminada')) onClose();
  };

  const title = invoice ? `Factura${invoice.number ? ` ${invoice.number}` : ''}` : 'Factura';
  return (
    <Modal open={!!invoiceId} wide title={title} onClose={onClose}
      footer={invoice && <>
        {canDelete && <button type="button" className="btn btn-danger" onClick={remove}><Trash2 size={16} aria-hidden /> Eliminar</button>}
        {canReadAI && !invoice.items?.length && <button type="button" className="btn btn-primary" onClick={() => onEdit(invoice, true)}><Sparkles size={16} aria-hidden /> Leer con IA</button>}
        <button type="button" className="btn" onClick={() => onEdit(invoice)}><Pencil size={16} aria-hidden /> Editar datos</button>
      </>}>
      {invoiceId && invoice === undefined && <p className="muted">Cargando…</p>}
      {invoiceId && invoice === null && <p>La factura ya no existe.</p>}
      {invoice && (
        <div className="stack">
          <dl className="invoice-meta">
            <div><dt>Proveedor</dt><dd>{supplierName || 'Sin proveedor'}</dd></div>
            <div><dt>Fecha</dt><dd>{fmtDay(invoice.date)}</dd></div>
            <div><dt>Número</dt><dd>{invoice.number || '—'}</dd></div>
            <div><dt>Total</dt><dd className="num">{fmtMoney(invoice.total)}</dd></div>
            {order && <div><dt>Pedido</dt><dd>Pedido #{order.number}</dd></div>}
            {invoice.createdBy && <div><dt>Cargada por</dt><dd>{invoice.createdBy.name}</dd></div>}
          </dl>
          {invoice.notes && <p className="small">{invoice.notes}</p>}
          {invoice.items?.length ? <InvoiceStockBar invoice={invoice} onReview={() => onEdit(invoice)} /> : null}
          {invoice.items?.length ? <InvoiceItemsTable invoice={invoice} /> : null}
          {invoice.pages.map((p, i) => <PageImage key={p.id} invoice={invoice} index={i} supplierName={supplierName} />)}
        </div>
      )}
    </Modal>
  );
}

/** Cargar al stock lo que trajo la factura (una sola vez) o deshacer esa carga. */
function InvoiceStockBar({ invoice, onReview }: { invoice: Invoice; onReview: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const { can } = useSession();
  const { run, confirm, notify } = useFeedback();
  const [busy, setBusy] = useState(false);
  const canMove = can('stock.move');
  const pending = pendingCount(invoice.items, products, lk);
  const toLoad = loadableItems(invoice.items).length;

  const load = async () => {
    setBusy(true);
    const r = await run(async () => {
      await learnFromInvoice(invoice.items);
      return applyInvoiceToStock(invoice.id);
    });
    setBusy(false);
    if (r) notify(`Cargado al stock: ${r.applied} ${r.applied === 1 ? 'producto' : 'productos'}`);
  };
  const undo = async () => {
    if (!(await confirm({ title: 'Deshacer carga', message: 'Se resta del stock lo que sumó esta factura (queda registrado en el historial). ¿Continuar?', confirmLabel: 'Deshacer carga' }))) return;
    setBusy(true);
    await run(() => undoInvoiceStock(invoice.id), 'Carga deshecha: el stock volvió a como estaba');
    setBusy(false);
  };

  if (invoice.stockAppliedAt) {
    return (
      <div className="inv-stock done" role="status">
        <CheckCircle2 size={20} aria-hidden style={{ color: 'var(--ok)' }} />
        <p className="grow small">
          <b>Cargada al stock</b> el {new Date(invoice.stockAppliedAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}
          {invoice.stockAppliedBy ? ` por ${invoice.stockAppliedBy.name}` : ''}.
        </p>
        {canMove && <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void undo()}><Undo2 size={15} aria-hidden /> Deshacer carga</button>}
      </div>
    );
  }
  if (!canMove) return null;
  return (
    <div className="inv-stock">
      <PackageCheck size={20} aria-hidden />
      <p className="grow small">
        {pending > 0
          ? `Antes de cargar al stock, revisá ${pending} ${pending === 1 ? 'renglón' : 'renglones'}.`
          : toLoad > 0 ? `Suma al stock ${toLoad} ${toLoad === 1 ? 'producto' : 'productos'}. Se carga una sola vez y se puede deshacer.` : 'Ningún renglón va al stock.'}
      </p>
      {pending > 0
        ? <button type="button" className="btn btn-sm" onClick={onReview}><Pencil size={15} aria-hidden /> Revisar</button>
        : toLoad > 0 && <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void load()}><PackageCheck size={15} aria-hidden /> Cargar al stock</button>}
    </div>
  );
}

/** Renglones leídos con IA (sólo lectura; para cambiarlos, "Editar datos"). */
function InvoiceItemsTable({ invoice }: { invoice: Invoice }) {
  const products = useProducts();
  const lk = useLookups();
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = invoice.items ?? [];
  const pending = pendingCount(items, products, lk);
  return (
    <section className="card" aria-label="Productos de la factura">
      <div className="card-head">
        <h3 className="row" style={{ margin: 0 }}>Productos ({items.length})</h3>
        {pending > 0 ? <span className="badge badge-warn">{pending} sin revisar</span> : <span className="badge badge-ok">Revisada</span>}
      </div>
      <div className="list">
        {items.map((i) => {
          const p = i.productId ? byId.get(i.productId) : undefined;
          return (
            <div key={i.id} className={`list-item ${i.status === 'ignored' ? 'production-undone' : ''}`}>
              <div className="grow">
                <div className="list-title truncate">{p?.name ?? i.description}</div>
                <div className="list-sub">{p ? i.description : ITEM_STATUS_LABEL[i.status]}{i.unitPrice != null ? ` · $${fmtNumber(i.unitPrice)} c/u` : ''}</div>
              </div>
              <strong className="num">{i.status === 'ignored' ? '—' : p && i.stockQty != null ? `${fmtNumber(i.stockQty)} ${lk.unit(p.unitId) || 'u'}` : `${fmtNumber(i.quantity)} ${i.unit ?? ''}`}</strong>
            </div>
          );
        })}
      </div>
    </section>
  );
}
