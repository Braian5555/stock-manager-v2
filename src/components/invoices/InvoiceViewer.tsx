import { Download, Loader2, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../database/db';
import type { Invoice } from '../../models';
import { base64ToBlob } from '../../services/imageService';
import { deleteInvoice, getInvoiceImage, invoiceFileName } from '../../services/invoiceService';
import { downloadBlob, safeFilename } from '../../exports/download';
import { useLookups } from '../../hooks/useData';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { fmtDay, fmtMoney } from '../../utils/format';
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

export function InvoiceViewer({ invoiceId, onClose, onEdit }: { invoiceId?: string; onClose: () => void; onEdit: (inv: Invoice) => void }) {
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
            {order && <div><dt>Pedido</dt><dd><Link to={`/pedidos/${order.id}`} onClick={onClose}>Pedido #{order.number}</Link></dd></div>}
            {invoice.createdBy && <div><dt>Cargada por</dt><dd>{invoice.createdBy.name}</dd></div>}
          </dl>
          {invoice.notes && <p className="small">{invoice.notes}</p>}
          {invoice.pages.map((p, i) => <PageImage key={p.id} invoice={invoice} index={i} supplierName={supplierName} />)}
        </div>
      )}
    </Modal>
  );
}
