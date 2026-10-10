import { ScanBarcode } from 'lucide-react';
import { useState } from 'react';
import { ScanFlow } from './ScanFlow';
import { ScannerModal } from './ScannerModal';

/**
 * Botón "Escanear". Sin `onCode` abre el flujo completo (producto + stock + acciones);
 * con `onCode` sólo lee el código y lo entrega (p. ej. para ubicar el renglón en un conteo).
 */
export function ScanButton({ onCode, label = 'Escanear', title, className = 'btn' }: { onCode?: (code: string) => void; label?: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} aria-label={label === '' ? 'Escanear código' : undefined}>
        <ScanBarcode size={18} aria-hidden />
        {label && <span className="scan-btn-label">{label}</span>}
      </button>
      {onCode ? (
        <ScannerModal open={open} title={title} onClose={() => setOpen(false)} onCode={(c) => { setOpen(false); onCode(c); }} />
      ) : (
        <ScanFlow open={open} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
