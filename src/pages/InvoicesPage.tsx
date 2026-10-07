import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { db } from '../database/db';
import type { Invoice } from '../models';
import { menuLabel } from '../services/settingsService';
import { useLookups, EMPTY } from '../hooks/useData';
import { useSettings } from '../store/settings';
import { EmptyState, Input, PageHeader, SearchInput, Select } from '../components/ui';
import { InvoiceEditor } from '../components/invoices/InvoiceEditor';
import { InvoiceViewer } from '../components/invoices/InvoiceViewer';
import { InvoiceList } from '../components/invoices/InvoiceList';
import { fmtMoney, matches } from '../utils/format';

export function InvoicesPage() {
  const settings = useSettings();
  const lk = useLookups();
  const [params, setParams] = useSearchParams();
  const invoices = useLiveQuery(() => db.invoices.orderBy('date').reverse().toArray(), []) ?? EMPTY;
  const [q, setQ] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [month, setMonth] = useState('');
  const [editing, setEditing] = useState<Invoice | 'new' | undefined>(params.get('nueva') === '1' ? 'new' : undefined);
  const viewId = params.get('ver') ?? undefined;

  const setView = (id?: string) => {
    const n = new URLSearchParams(params);
    if (id) n.set('ver', id);
    else n.delete('ver');
    n.delete('nueva');
    setParams(n, { replace: !id });
  };

  const list = useMemo(
    () => invoices.filter((i) =>
      (!supplierId || i.supplierId === supplierId) &&
      (!month || i.date.startsWith(month)) &&
      matches(q, i.number, lk.supplier(i.supplierId), i.notes)),
    [invoices, supplierId, month, q, lk],
  );
  const sum = list.reduce((s, i) => s + (i.total ?? 0), 0);
  const filtered = !!(q || supplierId || month);

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'invoices')}
        subtitle="Fotos de las facturas de proveedores. Se guardan en la nube y se pueden descargar."
        actions={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Camera size={18} aria-hidden /> Nueva factura</button>}
      />
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por número, proveedor o nota…" label="Buscar facturas" />
        <Select aria-label="Filtrar por proveedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">Todos los proveedores</option>
          {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input type="month" aria-label="Filtrar por mes" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
      </div>
      {list.length > 0 && (
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          {list.length} {list.length === 1 ? 'factura' : 'facturas'}{sum > 0 && <> · Total cargado: <b className="num">{fmtMoney(sum)}</b></>}
        </p>
      )}
      <div className="card">
        {list.length === 0 ? (
          filtered
            ? <EmptyState icon={<Receipt size={40} />} title="No hay facturas con esos filtros" />
            : <EmptyState icon={<Receipt size={40} />} title="Todavía no cargaste facturas"
                action={<button type="button" className="btn btn-primary" onClick={() => setEditing('new')}><Camera size={18} aria-hidden /> Sacar foto a una factura</button>}>
                Cuando recibas mercadería, sacale una foto a la factura. Queda guardada con el proveedor, la fecha y el total.
              </EmptyState>
        ) : (
          <InvoiceList invoices={list} onOpen={(i) => setView(i.id)} />
        )}
      </div>
      <InvoiceViewer invoiceId={viewId} onClose={() => setView()} onEdit={(inv) => { setView(); setEditing(inv); }} />
      <InvoiceEditor open={!!editing} invoice={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} onSaved={(inv) => editing === 'new' && setView(inv.id)} />
    </>
  );
}
