import { useSession } from '../store/session';
import { DatabaseBackup, FileDown, FileJson, FileSpreadsheet, FileText, FileType2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { db, DATA_TABLES } from '../database/db';
import { buildDatasets, EXPORT_SCOPES, SCOPE_LABEL, type ExportScope } from '../exports/datasets';
import { downloadBlob, safeFilename, stamp } from '../exports/download';
import { toDocx, toJsonBlob, toPdf, toXlsx } from '../exports/writers';
import { createBackup, restoreBackup, validateBackup, type BackupFile } from '../services/backupService';
import { menuLabel } from '../services/settingsService';
import { readTabularFile } from '../importers/tabular';
import { planProductImport, type ProductImportPlan } from '../importers/productImport';
import { useFeedback } from '../store/feedback';
import { useSettings } from '../store/settings';
import { PageHeader, Segmented } from '../components/ui';

const SCOPE_TABLES: Partial<Record<ExportScope, string[]>> = {
  stock: ['products'], products: ['products', 'categories', 'units', 'locations'], suppliers: ['suppliers'], orders: ['orders', 'orderItems'],
  counts: ['counts', 'countItems'], movements: ['movements'], settings: ['settings'],
};

export function ExportPage() {
  const settings = useSettings();
  const { run, confirm, notify } = useFeedback();
  const { can } = useSession();
  const [scope, setScope] = useState<ExportScope>('all');
  const [busy, setBusy] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ProductImportPlan | null>(null);
  const base = safeFilename(settings.businessName);

  const exportAs = async (format: 'pdf' | 'docx' | 'xlsx' | 'json') => {
    setBusy(true);
    await run(async () => {
      if (format === 'json') {
        const data = scope === 'all' ? await createBackup() : Object.fromEntries(await Promise.all((SCOPE_TABLES[scope] ?? []).map(async (t) => [t, await db.table(t).toArray()])));
        return downloadBlob(toJsonBlob(data), `${base}_${scope}_${stamp()}.json`);
      }
      const { title, datasets } = await buildDatasets(scope);
      const blob = format === 'pdf' ? await toPdf(title, datasets) : format === 'docx' ? await toDocx(title, datasets) : await toXlsx(title, datasets);
      downloadBlob(blob, `${base}_${scope}_${stamp()}.${format}`);
    }, 'Archivo generado');
    setBusy(false);
  };

  const backup = () => run(async () => downloadBlob(toJsonBlob(await createBackup()), `backup_${base}_${stamp()}.json`), 'Copia de seguridad descargada');

  const onRestoreFile = async (file: File) => {
    let data: unknown;
    try {
      data = JSON.parse(await file.text());
    } catch {
      return notify('El archivo no es un JSON válido.', { tone: 'error' });
    }
    const check = validateBackup(data);
    if (!check.ok) return notify(`No se puede restaurar: ${check.errors[0]}`, { tone: 'error' });
    const ok = await confirm({
      title: 'Restaurar copia de seguridad',
      danger: true,
      confirmLabel: 'Reemplazar datos',
      message: (
        <>
          <p className="alert alert-warn"><b>Esta acción reemplazará los datos actuales.</b></p>
          <p>La copia contiene {check.counts.products ?? 0} productos, {check.counts.suppliers ?? 0} proveedores, {check.counts.orders ?? 0} pedidos y {check.counts.movements ?? 0} movimientos.</p>
          <p className="small muted">Podrás deshacer la restauración inmediatamente después.</p>
        </>
      ),
    });
    if (!ok) return;
    const previous = await createBackup();
    const done = await run(() => restoreBackup(data as BackupFile).then(() => true));
    if (done) notify('Copia restaurada correctamente', { undo: () => restoreBackup(previous) });
  };

  const onImportFile = async (file: File) => {
    const p = await run(async () => planProductImport(await readTabularFile(file)));
    if (p) setPlan(p);
  };

  const confirmImport = async () => {
    if (!plan) return;
    const ok = await confirm({ title: 'Importar productos', message: <p>Se crearán {plan.create} productos y se actualizarán {plan.update} (sin modificar su stock). {plan.skipped > 0 && `${plan.skipped} filas sin nombre se omitirán.`}</p>, confirmLabel: 'Importar' });
    setPlan(null);
    if (!ok) return;
    const r = await run(plan.run);
    if (r) notify(`Importación lista: ${r.created} creados, ${r.updated} actualizados.`);
  };

  return (
    <>
      <PageHeader title={menuLabel(settings, 'export')} />
      <section className="card card-pad stack" aria-labelledby="exp">
        <h2 id="exp" className="row"><FileDown size={18} aria-hidden /> Exportar</h2>
        <Segmented label="Qué exportar" value={scope} onChange={setScope} options={EXPORT_SCOPES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} />
        <div className="row wrap">
          <button type="button" className="btn" disabled={busy} onClick={() => exportAs('pdf')}><FileText size={18} aria-hidden /> PDF</button>
          <button type="button" className="btn" disabled={busy} onClick={() => exportAs('docx')}><FileType2 size={18} aria-hidden /> Word (DOCX)</button>
          <button type="button" className="btn" disabled={busy} onClick={() => exportAs('xlsx')}><FileSpreadsheet size={18} aria-hidden /> Excel (XLSX)</button>
          <button type="button" className="btn" disabled={busy} onClick={() => exportAs('json')}><FileJson size={18} aria-hidden /> JSON</button>
        </div>
      </section>

      <section className="card card-pad stack" style={{ marginTop: 16 }} aria-labelledby="bk">
        <h2 id="bk" className="row"><DatabaseBackup size={18} aria-hidden /> Copia de seguridad</h2>
        <p className="muted small">Incluye todos los datos ({DATA_TABLES.length} tablas), relaciones e identificadores externos. Nunca incluye contraseñas, tokens ni claves. Las fotos de facturas no van en el backup (quedan en la nube y se descargan desde Facturas).</p>
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={backup}><DatabaseBackup size={18} aria-hidden /> Exportar backup</button>
          {can('admin') && <button type="button" className="btn" onClick={() => restoreRef.current?.click()}><Upload size={18} aria-hidden /> Restaurar backup</button>}
          <input ref={restoreRef} type="file" accept="application/json,.json" hidden aria-label="Archivo de backup" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onRestoreFile(f); }} />
        </div>
      </section>

      <section className="card card-pad stack" style={{ marginTop: 16 }} aria-labelledby="imp">
        <h2 id="imp" className="row"><Upload size={18} aria-hidden /> Importar productos</h2>
        <p className="muted small">Desde Excel (.xlsx) o CSV. Columnas reconocidas: Nombre, Código, Familia, Unidad, Ubicación, Proveedor, Mínimo, Máximo, Stock, Observaciones. Si el producto ya existe (mismo código o nombre) se actualiza sin cambiar su stock.</p>
        <div className="row wrap">
          {can('catalog.manage') ? <button type="button" className="btn" onClick={() => importRef.current?.click()}><FileSpreadsheet size={18} aria-hidden /> Elegir archivo</button> : <span className="small muted">Necesitás permiso para administrar productos.</span>}
          <input ref={importRef} type="file" accept=".xlsx,.csv,text/csv" hidden aria-label="Archivo de productos" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onImportFile(f); }} />
          {plan && <button type="button" className="btn btn-primary" onClick={confirmImport}>Importar {plan.create + plan.update} productos</button>}
        </div>
      </section>
    </>
  );
}
