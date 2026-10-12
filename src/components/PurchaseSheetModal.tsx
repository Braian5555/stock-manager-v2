import { FileSpreadsheet, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLookups, useProducts } from '../hooks/useData';
import { downloadBlob, safeFilename, stamp } from '../exports/download';
import { toXlsx } from '../exports/writers';
import { buildPurchaseSheets, type PurchaseSheet } from '../services/purchaseSheet';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { fmtNumber } from '../utils/format';
import { Modal } from './ui/Modal';

/**
 * Planillas de compra para imprimir: una hoja por proveedor con sus productos por familia y
 * columnas en blanco ("Hay", "Pedir", "Obs.") para que la cocina marque qué hace falta.
 */
export function PurchaseSheetModal({ open, initial, onClose }: { open: boolean; initial?: string; onClose: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const settings = useSettings();
  const { run, notify } = useFeedback();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [alternatives, setAlternatives] = useState(false);
  const [showStock, setShowStock] = useState(false);
  const [showHay, setShowHay] = useState(true);
  const [printJob, setPrintJob] = useState(0);

  // Proveedores con productos (principal o alternativo), con su cantidad.
  const withProducts = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of products) {
      if (!p.active) continue;
      for (const id of [p.supplierId, ...(alternatives ? p.alternativeSupplierIds ?? [] : [])]) if (id) n.set(id, (n.get(id) ?? 0) + 1);
    }
    return lk.suppliers.filter((s) => n.has(s.id)).map((s) => ({ ...s, count: n.get(s.id)! }));
  }, [products, lk.suppliers, alternatives]);

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(initial ? [initial] : []));
    setPrintJob(0);
  }, [open, initial]);

  const sheets: PurchaseSheet[] = useMemo(
    () => buildPurchaseSheets([...selected], { products, suppliers: lk.suppliers, categories: lk.categories, units: lk.units }, { alternatives }).filter((s) => s.total > 0),
    [selected, products, lk, alternatives],
  );

  // Imprimir: la hoja queda montada (oculta en pantalla) mientras el diálogo está abierto.
  useEffect(() => {
    if (!printJob) return;
    const html = document.documentElement;
    html.classList.add('printing-sheets');
    const style = document.createElement('style');
    style.textContent = '@page { size: A4 portrait; margin: 12mm; }';
    document.head.appendChild(style);
    const t = setTimeout(() => window.print(), 60);
    return () => {
      clearTimeout(t);
      html.classList.remove('printing-sheets');
      style.remove();
    };
  }, [printJob]);

  const print = () => {
    if (!sheets.length) return notify('Elegí al menos un proveedor con productos.', { tone: 'error' });
    setPrintJob((n) => n + 1);
  };

  const excel = () =>
    run(async () => {
      const cols = ['Producto', 'Unidad', 'Mínimo', ...(showStock ? ['Stock (app)'] : []), ...(showHay ? ['Hay'] : []), 'Pedir', 'Obs.'];
      const datasets = sheets.map((s) => ({
        title: s.supplier.name,
        columns: ['Familia', ...cols],
        rows: s.groups.flatMap((g) => g.rows.map((r) => [g.family, r.name + (r.alternative ? ' (alt.)' : ''), r.unit, r.min || '', ...(showStock ? [r.stock] : []), ...(showHay ? [''] : []), '', ''])),
      }));
      const blob = await toXlsx('Planillas de compra', datasets);
      downloadBlob(blob, `${safeFilename(sheets.length === 1 ? `planilla-${sheets[0].supplier.name}` : 'planillas-de-compra')}-${stamp()}.xlsx`);
    }, 'Planilla descargada');

  const toggle = (id: string, on: boolean) => setSelected((cur) => { const n = new Set(cur); if (on) n.add(id); else n.delete(id); return n; });
  const rowsCount = sheets.reduce((a, s) => a + s.total, 0);

  return (
    <>
      <Modal
        open={open}
        wide
        title="Planillas de compra"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" disabled={!sheets.length} onClick={excel}><FileSpreadsheet size={18} aria-hidden /> Excel</button>
            <span className="grow" />
            <button type="button" className="btn btn-primary" disabled={!sheets.length} onClick={print}><Printer size={18} aria-hidden /> Imprimir {sheets.length === 1 ? 'planilla' : `${sheets.length} planillas`}</button>
          </>
        }
      >
        <div className="stack">
          <p className="small muted">Una hoja por proveedor con sus productos ordenados por familia. La cocina marca en “Pedir” lo que hace falta y después cargás el pedido con “Pedir a proveedor”.</p>
          <div className="row wrap" style={{ gap: '6px 16px' }}>
            <label className="check small"><input type="checkbox" checked={showHay} onChange={(e) => setShowHay(e.target.checked)} /> Columna “Hay” (lo que queda)</label>
            <label className="check small"><input type="checkbox" checked={showStock} onChange={(e) => setShowStock(e.target.checked)} /> Mostrar stock de la app</label>
            <label className="check small"><input type="checkbox" checked={alternatives} onChange={(e) => setAlternatives(e.target.checked)} /> Incluir productos donde es proveedor alternativo</label>
          </div>
          <div className="row small">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set(withProducts.map((s) => s.id)))}>Elegir todos</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Ninguno</button>
            <span className="grow" />
            <span className="muted">{selected.size ? `${sheets.length} ${sheets.length === 1 ? 'hoja' : 'hojas'} · ${rowsCount} productos` : 'Elegí los proveedores'}</span>
          </div>
          <div className="list labels-pick">
            {withProducts.map((s) => (
              <label key={s.id} className="list-item check">
                <input type="checkbox" checked={selected.has(s.id)} onChange={(e) => toggle(s.id, e.target.checked)} aria-label={`Planilla de ${s.name}`} />
                <span className="grow">{s.name}</span>
                <span className="small muted num">{s.count} productos</span>
              </label>
            ))}
            {withProducts.length === 0 && <p className="muted small">Todavía no hay productos con proveedor asignado.</p>}
          </div>
        </div>
      </Modal>
      {printJob > 0 &&
        createPortal(
          <div className="print-sheets" aria-hidden>
            {sheets.map((s) => (
              <section key={s.supplier.id} className="psheet">
                <header className="psheet-head">
                  <div>
                    <div className="psheet-biz">{settings.businessName}</div>
                    <h1>Planilla de compra · {s.supplier.name}</h1>
                    {(s.supplier.phone || s.supplier.contact) && <div className="psheet-sub">{[s.supplier.contact, s.supplier.phone].filter(Boolean).join(' · ')}</div>}
                  </div>
                  <div className="psheet-fill">
                    <span>Fecha: ____________</span>
                    <span>Completó: ____________</span>
                  </div>
                </header>
                <table className="psheet-table">
                  <thead>
                    <tr>
                      <th>Producto</th><th>Unidad</th><th className="n">Mín.</th>
                      {showStock && <th className="n">Stock</th>}
                      {showHay && <th className="box">Hay</th>}
                      <th className="box">Pedir</th><th className="obs">Obs.</th>
                    </tr>
                  </thead>
                  {s.groups.map((g) => (
                    <tbody key={g.family}>
                      <tr className="psheet-fam"><th colSpan={5 + (showStock ? 1 : 0) + (showHay ? 1 : 0)}>{g.family}</th></tr>
                      {g.rows.map((r) => (
                        <tr key={r.productId}>
                          <td>{r.name}{r.alternative && <span className="psheet-alt"> (alt.)</span>}</td>
                          <td>{r.unit}</td>
                          <td className="n">{r.min ? fmtNumber(r.min) : ''}</td>
                          {showStock && <td className="n">{fmtNumber(r.stock)}</td>}
                          {showHay && <td className="box" />}
                          <td className="box" />
                          <td className="obs" />
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
                <footer className="psheet-foot">
                  <span>Pedido hecho por: ____________</span>
                  <span>Fecha del pedido: ____________</span>
                </footer>
              </section>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
