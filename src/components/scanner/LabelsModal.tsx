import { Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLookups, useProducts } from '../../hooks/useData';
import type { Product } from '../../models';
import { saveProduct } from '../../services/productService';
import { useFeedback } from '../../store/feedback';
import { code128Svg, nextInternalCode, validateBarcode } from '../../utils/barcode';
import { Field, NumberInput, Segmented } from '../ui';
import { Modal } from '../ui/Modal';

type Sheet = 'a4' | 'roll';

/** Código que va impreso: el de barras; si no hay, el SKU (también se encuentra al escanear). */
export function labelCode(p: Pick<Product, 'barcode' | 'sku'>): string | undefined {
  for (const c of [p.barcode, p.sku]) if (c && validateBarcode(c).ok) return validateBarcode(c).code;
  return undefined;
}

/**
 * Etiquetas con código de barras (Code 128), nombre, código y unidad, para imprimir en hoja A4
 * o en etiquetadora (50 × 30 mm). Los productos sin código pueden recibir un código interno.
 */
export function LabelsModal({ open, products, scope, onClose }: { open: boolean; products: Product[]; scope: string; onClose: () => void }) {
  const lk = useLookups();
  const all = useProducts();
  const { run, confirm, notify } = useFeedback();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copies, setCopies] = useState<number | undefined>(1);
  const [sheet, setSheet] = useState<Sheet>('a4');
  // Cada impresión es un "trabajo" nuevo; la hoja queda montada (oculta en pantalla) mientras el diálogo está abierto,
  // porque en algunos teléfonos window.print() no espera y no avisa cuándo terminó.
  const [printJob, setPrintJob] = useState(0);

  // Productos de la lista, al día (si se les generó código, se ve enseguida).
  const list = useMemo(() => products.map((p) => all.find((x) => x.id === p.id) ?? p).filter((p) => p.active), [products, all]);
  useEffect(() => {
    if (open) setSelected(new Set(products.filter((p) => p.active).map((p) => p.id)));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- selección inicial al abrir

  const chosen = list.filter((p) => selected.has(p.id));
  const withCode = chosen.filter((p) => labelCode(p));
  const withoutCode = chosen.filter((p) => !labelCode(p));

  const generate = async () => {
    const ok = await confirm({
      title: `¿Generar ${withoutCode.length} códigos internos?`,
      message: <>Cada producto recibe un código propio (por ejemplo {nextInternalCode(all.map((p) => p.barcode))}) que queda guardado y se sincroniza. Después podés cambiarlo desde el producto.</>,
      confirmLabel: 'Generar códigos',
    });
    if (!ok) return;
    await run(async () => {
      const used = all.map((p) => p.barcode);
      for (const p of withoutCode) {
        const code = nextInternalCode(used);
        used.push(code);
        await saveProduct({ ...p, barcode: code });
      }
    }, `${withoutCode.length} códigos generados`);
  };

  const print = () => {
    if (!withCode.length) return notify('No hay productos con código para imprimir.', { tone: 'error' });
    setPrintJob((n) => n + 1);
  };

  useEffect(() => {
    if (!open) setPrintJob(0);
  }, [open]);

  useEffect(() => {
    if (!printJob) return;
    const html = document.documentElement;
    html.classList.add('printing-labels');
    const style = document.createElement('style');
    style.textContent = sheet === 'roll' ? '@page { size: 50mm 30mm; margin: 0; }' : '@page { size: A4; margin: 8mm; }';
    document.head.appendChild(style);
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      html.classList.remove('printing-labels');
      style.remove();
    };
  }, [printJob]); // eslint-disable-line react-hooks/exhaustive-deps -- el papel se toma al momento de imprimir

  const n = Math.max(1, Math.min(50, copies ?? 1));
  const toggle = (id: string, on: boolean) => setSelected((cur) => { const s = new Set(cur); if (on) s.add(id); else s.delete(id); return s; });

  return (
    <>
      <Modal
        open={open}
        wide
        title="Imprimir etiquetas"
        onClose={onClose}
        footer={
          <>
            <button type="button" className="btn" onClick={onClose}>Cerrar</button>
            <button type="button" className="btn btn-primary" disabled={!withCode.length} onClick={print}><Printer size={18} aria-hidden /> Imprimir {withCode.length * n} etiquetas</button>
          </>
        }
      >
        <div className="stack">
          <p className="small muted">{list.length} productos {scope}. Elegí cuáles imprimir.</p>
          <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
            <Segmented label="Papel" value={sheet} onChange={setSheet} options={[{ value: 'a4', label: 'Hoja A4' }, { value: 'roll', label: 'Etiquetadora 50×30' }]} />
            <Field label="Copias de cada una"><NumberInput value={copies} onChange={setCopies} min={1} style={{ width: 90 }} /></Field>
          </div>
          {withoutCode.length > 0 && (
            <div className="alert alert-info">
              <span className="grow">{withoutCode.length} de los elegidos no tienen código de barras ni SKU.</span>
              <button type="button" className="btn btn-sm" onClick={generate}>Generar códigos internos</button>
            </div>
          )}
          <div className="row small">
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set(list.map((p) => p.id)))}>Elegir todos</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(new Set())}>Ninguno</button>
          </div>
          <div className="list labels-pick">
            {list.map((p) => (
              <label key={p.id} className="list-item check">
                <input type="checkbox" checked={selected.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span className="grow">{p.name}</span>
                <span className="small muted num">{labelCode(p) ?? 'sin código'}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>
      {printJob > 0 &&
        createPortal(
          <div className={`print-labels ${sheet}`} aria-hidden>
            {withCode.flatMap((p) =>
              Array.from({ length: n }, (_, i) => (
                <div key={`${p.id}:${i}`} className="label">
                  <div className="label-name">{p.name}</div>
                  <div className="label-bars" dangerouslySetInnerHTML={{ __html: code128Svg(labelCode(p)!) }} />
                  <div className="label-meta"><span>{labelCode(p)}</span><span>{lk.unit(p.unitId)}</span></div>
                </div>
              )),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
