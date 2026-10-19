import { FileSpreadsheet, FileUp } from 'lucide-react';
import { useRef } from 'react';
import { downloadCompletedMaxirestXls, downloadMaxirestXls } from '../../integrations/maxirest/maxirestXls';
import { useFeedback } from '../../store/feedback';

/**
 * Botones para llevar a Maxirest (Inventario → "Importar Inventario") el conteo o el stock actual en .xls.
 * "Completar Excel de Maxirest" rellena el archivo que exportó Maxirest, así el formato es exactamente el suyo.
 */
export function MaxirestXlsActions({ countId, name, small }: { countId?: string; name: string; small?: boolean }) {
  const { run, notify } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const size = small ? 16 : 18;
  const done = (summary: string | undefined) => summary && notify(`Excel para Maxirest descargado: ${summary}`);
  return (
    <>
      <button type="button" className="btn" onClick={async () => done(await run(() => downloadMaxirestXls(countId, name)))}>
        <FileSpreadsheet size={size} aria-hidden /> .xls para Maxirest
      </button>
      <button type="button" className="btn" onClick={() => fileRef.current?.click()} title="Elegí el Excel que exportó Maxirest y se completa la columna Conteo">
        <FileUp size={size} aria-hidden /> Completar Excel de Maxirest
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xls,.xlsx"
        hidden
        aria-label="Excel de inventario exportado de Maxirest"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) done(await run(() => downloadCompletedMaxirestXls(f, countId)));
        }}
      />
    </>
  );
}
