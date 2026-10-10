import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Link2, PackagePlus, Pencil, ScanBarcode, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLookups, useProducts } from '../../hooks/useData';
import type { MovementType, Product } from '../../models';
import { findByCode, saveProduct } from '../../services/productService';
import { statusOf } from '../../services/stockService';
import { useFeedback } from '../../store/feedback';
import { useSession } from '../../store/session';
import { useSettings } from '../../store/settings';
import { fmtNumber, matches } from '../../utils/format';
import { MovementModal } from '../MovementModal';
import { ProductForm } from '../ProductForm';
import { StatusBadge } from '../ui';
import { Modal } from '../ui/Modal';
import { ScannerModal } from './ScannerModal';

type Step = { kind: 'scan' } | { kind: 'result'; code: string; found: Product[] } | { kind: 'assign'; code: string } | { kind: 'idle' };

/**
 * Escanear → ver el producto con su stock → elegir qué hacer (ingreso, salida, contar).
 * Nunca se registra una cantidad automáticamente: siempre la escribe la persona.
 * Si el código no existe, se ofrece crear el producto o asignarlo a uno existente, con confirmación.
 */
export function ScanFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [move, setMove] = useState<{ product: Product; type: MovementType } | null>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const products = useProducts();

  useEffect(() => {
    setStep(open ? { kind: 'scan' } : { kind: 'idle' });
  }, [open]);

  const lookup = async (code: string) => {
    const found = await findByCode(code);
    setStep({ kind: 'result', code, found });
  };

  // El resultado se mantiene al día (p. ej. después de un movimiento se ve el stock nuevo).
  const live = step.kind === 'result' ? step.found.map((f) => products.find((p) => p.id === f.id) ?? f) : [];

  return (
    <>
      <ScannerModal open={open && step.kind === 'scan'} onClose={onClose} onCode={lookup} />
      {step.kind === 'result' && !move && !creating && (
        <ScanResult
          code={step.code}
          found={live}
          onAgain={() => setStep({ kind: 'scan' })}
          onClose={onClose}
          onMove={(product, type) => setMove({ product, type })}
          onCreate={() => setCreating(step.code)}
          onAssign={() => setStep({ kind: 'assign', code: step.code })}
        />
      )}
      {step.kind === 'assign' && (
        <AssignCode code={step.code} onBack={() => lookup(step.code)} onDone={() => lookup(step.code)} />
      )}
      <MovementModal product={move ? live.find((p) => p.id === move.product.id) ?? move.product : null} initialType={move?.type} onClose={() => setMove(null)} />
      <ProductForm
        open={!!creating}
        preset={creating ? { barcode: creating } : undefined}
        onClose={(saved) => {
          const code = creating;
          setCreating(null);
          if (saved && code) void lookup(code);
        }}
      />
    </>
  );
}

function ScanResult({ code, found, onAgain, onClose, onMove, onCreate, onAssign }: {
  code: string;
  found: Product[];
  onAgain: () => void;
  onClose: () => void;
  onMove: (p: Product, t: MovementType) => void;
  onCreate: () => void;
  onAssign: () => void;
}) {
  const lk = useLookups();
  const settings = useSettings();
  const { can } = useSession();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<string | null>(null);
  const product = found.length === 1 ? found[0] : found.find((p) => p.id === chosen);

  return (
    <Modal
      open
      title={product ? product.name : found.length > 1 ? 'Código repetido' : 'Código no encontrado'}
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onAgain}><ScanBarcode size={18} aria-hidden /> Escanear otro</button>}
    >
      {product ? (
        <div className="stack">
          <div className="scan-card">
            <div className="scan-stock">
              <span className="scan-stock-num num">{fmtNumber(product.stock)}</span>
              <span className="muted">{lk.unit(product.unitId) || 'unidades'}</span>
            </div>
            <div className="stack" style={{ gap: 4 }}>
              <StatusBadge status={statusOf(product, settings)} />
              <span className="small muted">{[lk.category(product.categoryId), lk.location(product.locationId)].filter(Boolean).join(' · ') || 'Sin familia ni ubicación'}</span>
              <span className="small muted">Código {product.barcode ?? product.sku ?? code}</span>
              {!product.active && <span className="small" style={{ color: 'var(--out)' }}>Producto inactivo</span>}
            </div>
          </div>
          {can('stock.move') && (
            <div className="scan-actions">
              <button type="button" className="btn btn-primary" onClick={() => onMove(product, 'ingreso')}><ArrowDownToLine size={18} aria-hidden /> Ingreso</button>
              <button type="button" className="btn" onClick={() => onMove(product, 'salida')}><ArrowUpFromLine size={18} aria-hidden /> Salida</button>
              <button type="button" className="btn" onClick={() => onMove(product, 'ajuste')}><ClipboardCheck size={18} aria-hidden /> Contar</button>
            </div>
          )}
          {can('catalog.manage') && (
            <button type="button" className="btn btn-ghost" onClick={() => { onClose(); navigate(`/productos?editar=${product.id}`); }}><Pencil size={16} aria-hidden /> Ver o editar producto</button>
          )}
          {found.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChosen(null)}>Elegir otro de los {found.length}</button>}
        </div>
      ) : found.length > 1 ? (
        <div className="stack">
          <div className="alert alert-warn"><AlertTriangle size={18} aria-hidden /> <span>El código {code} está cargado en {found.length} productos (pasa si se cargó en dos dispositivos sin conexión). Elegí el correcto y corregí el otro desde Productos.</span></div>
          <div className="list">
            {found.map((p) => (
              <button key={p.id} type="button" className="list-item" onClick={() => setChosen(p.id)}>
                <span className="grow list-title">{p.name}</span>
                <span className="small muted num">{fmtNumber(p.stock)} {lk.unit(p.unitId)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="stack">
          <p>No hay ningún producto con el código <strong className="num">{code}</strong>.</p>
          {can('catalog.manage') ? (
            <>
              <p className="small muted">Si es un producto que ya tenés cargado, asignale este código. Si es nuevo, podés crearlo: no se guarda nada hasta que confirmes.</p>
              <div className="scan-actions">
                <button type="button" className="btn btn-primary" onClick={onAssign}><Link2 size={18} aria-hidden /> Asignar a un producto</button>
                <button type="button" className="btn" onClick={onCreate}><PackagePlus size={18} aria-hidden /> Crear producto</button>
              </div>
            </>
          ) : (
            <p className="small muted">Pedile a quien administra el catálogo que cargue este código en el producto.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Elegir un producto existente (sin código) y asignarle el código escaneado, con confirmación. */
function AssignCode({ code, onBack, onDone }: { code: string; onBack: () => void; onDone: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm } = useFeedback();
  const [q, setQ] = useState('');
  const list = useMemo(
    () => products.filter((p) => p.active && matches(q, p.name, p.sku, lk.category(p.categoryId))).sort((a, b) => Number(!!a.barcode) - Number(!!b.barcode) || a.name.localeCompare(b.name, 'es')).slice(0, 60),
    [products, q, lk],
  );
  const pick = async (p: Product) => {
    const ok = await confirm({
      title: '¿Asignar el código?',
      message: p.barcode
        ? <>“{p.name}” ya tiene el código <strong>{p.barcode}</strong>. Se reemplaza por <strong>{code}</strong>.</>
        : <>Se guarda el código <strong>{code}</strong> en “{p.name}”. La próxima vez que lo escanees, aparece directo.</>,
      confirmLabel: 'Asignar código',
    });
    if (!ok) return;
    const saved = await run(() => saveProduct({ ...p, barcode: code }), 'Código asignado');
    if (saved) onDone();
  };
  return (
    <Modal open title={`Asignar ${code}`} onClose={onBack} footer={<button type="button" className="btn" onClick={onBack}>Volver</button>}>
      <div className="stack">
        <label className="production-search">
          <Search size={18} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" aria-label="Buscar producto para asignar" data-autofocus />
        </label>
        <div className="list">
          {list.map((p) => (
            <button key={p.id} type="button" className="list-item" onClick={() => pick(p)}>
              <span className="grow">
                <span className="list-title">{p.name}</span>
                <span className="list-sub" style={{ display: 'block' }}>{[lk.category(p.categoryId), p.barcode && `ya tiene ${p.barcode}`].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="muted small">No hay productos con ese nombre.</p>}
        </div>
      </div>
    </Modal>
  );
}
