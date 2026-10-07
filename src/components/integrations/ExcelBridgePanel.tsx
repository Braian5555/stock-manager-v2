import { FileDown, FileUp } from 'lucide-react';
import { useRef, useState } from 'react';
import { readTabularFile, type Tabular } from '../../importers/tabular';
import { BRIDGE_FIELD_LABEL, BRIDGE_FIELDS, detectMapping, importBridgeRows, toBridgeRows, type BridgeField, type BridgeMapping } from '../../integrations/maxirest/excelBridge';
import { exportBridgeWorkbook } from '../../integrations/maxirest/excelBridgeExport';
import { useFeedback } from '../../store/feedback';
import { Field, Select } from '../ui';
import { fmtNumber } from '../../utils/format';

/** Puente manual por Excel: Maxirest → Excel → Stock Manager, y Stock Manager → Excel → Maxirest. */
export function ExcelBridgePanel({ onImported }: { onImported?: () => void }) {
  const { run, notify, confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tabular | null>(null);
  const [mapping, setMapping] = useState<BridgeMapping>({});

  const onFile = async (f: File) => {
    const t = await run(() => readTabularFile(f));
    if (!t) return;
    setTab(t);
    setMapping(detectMapping(t.headers));
  };

  const preview = (() => {
    if (!tab) return null;
    try {
      return toBridgeRows(tab, mapping);
    } catch {
      return null;
    }
  })();

  const doImport = async () => {
    if (!preview) return notify('Indicá al menos la columna de código o de nombre.', { tone: 'error' });
    if (mapping.stock === undefined && !(await confirm({ title: 'Sin columna de stock', message: 'No se indicó la columna de stock: se importarán sólo códigos y nombres (útil para vincular). ¿Continuar?' }))) return;
    const n = await run(() => importBridgeRows(preview.rows));
    if (n !== undefined) {
      notify(`${n} insumos importados desde Excel. Revisá los vínculos y la conciliación.`);
      setTab(null);
      onImported?.();
    }
  };

  return (
    <div className="stack">
      <div className="alert alert-info small">
        <span>
          <b>Proceso manual.</b> En Maxirest: Menú → Stock → Inventarios → Nuevo → “Preparar inventario” → exportar a Excel.
          Guardalo como .xlsx (o .csv) e importalo acá. El formato no está documentado oficialmente: confirmá las columnas antes de importar.
        </span>
      </div>
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}><FileUp size={18} aria-hidden /> Importar Excel de Maxirest</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv,text/csv" hidden aria-label="Excel exportado de Maxirest" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void onFile(f); }} />
        <button type="button" className="btn" onClick={() => run(() => exportBridgeWorkbook(undefined, 'stock_actual'), 'Excel generado')}><FileDown size={18} aria-hidden /> Exportar stock para Maxirest</button>
      </div>
      {tab && (
        <div className="card card-pad stack">
          <h3>Columnas detectadas {tab.sheetName && <span className="muted small">· hoja “{tab.sheetName}”</span>}</h3>
          <div className="form-grid cols-3">
            {BRIDGE_FIELDS.map((f: BridgeField) => (
              <Field key={f} label={BRIDGE_FIELD_LABEL[f]}>
                <Select value={mapping[f] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [f]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  <option value="">— No usar —</option>
                  {tab.headers.map((h, i) => <option key={i} value={i}>{h || `Columna ${i + 1}`}</option>)}
                </Select>
              </Field>
            ))}
          </div>
          {preview && (
            <>
              <p className="small muted">{preview.rows.length} filas válidas{preview.skipped ? `, ${preview.skipped} omitidas` : ''}. Vista previa:</p>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Código</th><th>Nombre</th><th>Unidad</th><th className="num">Stock</th><th className="num">Conteo</th></tr></thead>
                  <tbody>
                    {preview.rows.slice(0, 6).map((r) => (
                      <tr key={r.externalId}><td>{r.code ?? '—'}</td><td>{r.name}</td><td>{r.unitName ?? '—'}</td><td className="num">{fmtNumber(r.stock)}</td><td className="num">{fmtNumber(r.counted)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setTab(null)}>Cancelar</button>
            <button type="button" className="btn btn-primary" onClick={doImport} disabled={!preview?.rows.length}>Importar {preview?.rows.length ?? 0} insumos</button>
          </div>
        </div>
      )}
    </div>
  );
}
