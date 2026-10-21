import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, Receipt, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
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
import { useCloud } from '../cloud/cloudService';
import { dismissRecoverable, recoverableInvoices, recoverInvoices } from '../services/recoverService';
import { useFeedback } from '../store/feedback';

export function InvoicesPage() {
  const settings = useSettings();
  const lk = useLookups();
  const [params, setParams] = useSearchParams();
  const invoices = useLiveQuery(() => db.invoices.orderBy('date').reverse().toArray(), []) ?? EMPTY;
  const cloud = useCloud();
  const { run, notify } = useFeedback();
  // Facturas que había en este dispositivo antes de entrar a la nube del negocio.
  const recoverable = useLiveQuery(() => recoverableInvoices(), [invoices.length]) ?? EMPTY;
  const [q, setQ] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [month, setMonth] = useState('');
  const [pay, setPay] = useState<'' | 'apagar' | 'pagadas' | 'sindatos'>('');
  const [editing, setEditing] = useState<Invoice | 'new' | undefined>(params.get('nueva') === '1' ? 'new' : undefined);
  // Lectura con IA: sólo si se configuró el servidor (Configuración → Lectura con IA).
  const aiOn = !!settings.aiReaderUrl;
  const [aiMode, setAiMode] = useState(aiOn && params.get('ia') === '1');
  const openNew = (ai: boolean) => { setAiMode(ai); setEditing('new'); };
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
      (!pay || (pay === 'pagadas' ? !!i.payment?.paid : pay === 'apagar' ? !!i.payment && !i.payment.paid : !i.payment?.method && !i.payment?.paid)) &&
      matches(q, i.number, lk.supplier(i.supplierId), i.notes)),
    [invoices, supplierId, month, pay, q, lk],
  );
  const sum = list.reduce((s, i) => s + (i.total ?? 0), 0);
  const filtered = !!(q || supplierId || month || pay);
  const toPay = list.filter((i) => i.payment && !i.payment.paid).reduce((s, i) => s + (i.total ?? 0), 0);

  return (
    <>
      <PageHeader
        title={menuLabel(settings, 'invoices')}
        subtitle="Fotos de las facturas de proveedores. Se guardan en la nube y se pueden descargar."
        actions={<>
          {aiOn && <button type="button" className="btn btn-primary" onClick={() => openNew(true)}><Sparkles size={18} aria-hidden /> Leer factura con IA</button>}
          <button type="button" className={`btn ${aiOn ? '' : 'btn-primary'}`} onClick={() => openNew(false)}><Camera size={18} aria-hidden /> Nueva factura</button>
        </>}
      />
      {cloud.phase !== 'linked' && cloud.phase !== 'loading' && (
        <div className="alert alert-warn" role="note">
          <span><b>Este dispositivo no está conectado a la nube del negocio.</b> Las facturas que cargues acá no las van a ver los demás. <Link to="/nube">Conectalo en Cuenta y nube</Link>.</span>
        </div>
      )}
      {recoverable.length > 0 && (
        <div className="alert alert-info" role="note">
          <div>
          <span>
            Hay <b>{recoverable.length} {recoverable.length === 1 ? 'factura' : 'facturas'}</b> que estaban en este dispositivo antes de entrar a la nube del negocio y no figuran acá.
            Se pueden traer con su foto (quedan sin cargar al stock, para revisarlas).
          </span>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={async () => { const n = await run(() => recoverInvoices()); if (n) notify(`${n} ${n === 1 ? 'factura traída' : 'facturas traídas'} a Facturas. Revisalas y cargalas al stock si corresponde.`); }}>Traerlas a Facturas</button>
            <button type="button" className="btn btn-sm" onClick={() => void run(() => dismissRecoverable())}>No, gracias</button>
          </div>
          </div>
        </div>
      )}
      <div className="toolbar">
        <SearchInput value={q} onChange={setQ} placeholder="Buscar por número, proveedor o nota…" label="Buscar facturas" />
        <Select aria-label="Filtrar por proveedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">Todos los proveedores</option>
          {lk.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Input type="month" aria-label="Filtrar por mes" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180 }} />
        <Select aria-label="Filtrar por pago" value={pay} onChange={(e) => setPay(e.target.value as typeof pay)} style={{ maxWidth: 200 }}>
          <option value="">Todas (pago)</option>
          <option value="apagar">A pagar</option>
          <option value="pagadas">Pagadas</option>
          <option value="sindatos">Sin datos de pago</option>
        </Select>
      </div>
      {list.length > 0 && (
        <p className="small muted" style={{ margin: '0 0 8px' }}>
          {list.length} {list.length === 1 ? 'factura' : 'facturas'}{sum > 0 && <> · Total cargado: <b className="num">{fmtMoney(sum)}</b></>}{toPay > 0 && <> · A pagar: <b className="num">{fmtMoney(toPay)}</b></>}
        </p>
      )}
      <div className="card">
        {list.length === 0 ? (
          filtered
            ? <EmptyState icon={<Receipt size={40} />} title="No hay facturas con esos filtros" />
            : <EmptyState icon={<Receipt size={40} />} title="Todavía no cargaste facturas"
                action={<div className="row wrap" style={{ justifyContent: 'center' }}>
                  {aiOn && <button type="button" className="btn btn-primary" onClick={() => openNew(true)}><Sparkles size={18} aria-hidden /> Leer factura con IA</button>}
                  <button type="button" className={`btn ${aiOn ? '' : 'btn-primary'}`} onClick={() => openNew(false)}><Camera size={18} aria-hidden /> Sacar foto a una factura</button>
                </div>}>
                Cuando recibas mercadería, sacale una foto a la factura. Queda guardada con el proveedor, la fecha y el total.
              </EmptyState>
        ) : (
          <InvoiceList invoices={list} onOpen={(i) => setView(i.id)} />
        )}
      </div>
      <InvoiceViewer invoiceId={viewId} onClose={() => setView()} onEdit={(inv, ai) => { setView(); setAiMode(!!ai); setEditing(inv); }} canReadAI={aiOn} />
      <InvoiceEditor open={!!editing} invoice={editing === 'new' ? undefined : editing} autoRead={aiMode} onClose={() => { setEditing(undefined); setAiMode(false); }} onSaved={(inv) => editing === 'new' && setView(inv.id)} />
    </>
  );
}
