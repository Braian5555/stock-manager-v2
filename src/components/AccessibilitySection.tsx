import { useSyncExternalStore } from 'react';
import { onA11yChange, readA11y, saveA11y, TEXT_SIZE_LABEL, type TextSize } from '../services/a11yService';
import { Segmented } from './ui';

let cache = readA11y();
const subscribe = (cb: () => void) => onA11yChange(() => { cache = readA11y(); cb(); });
const snapshot = () => cache;

/** Letra más grande y más contraste para quien la usa en este celular o compu. */
export function AccessibilitySection({ compact }: { compact?: boolean }) {
  const p = useSyncExternalStore(subscribe, snapshot);
  return (
    <div className="stack" aria-label="Accesibilidad">
      <div className="stack" style={{ gap: 6 }}>
        <span className={compact ? 'list-title' : 'field-label'}>Tamaño de letra</span>
        <Segmented<TextSize> label="Tamaño de letra" value={p.text} onChange={(text) => saveA11y({ ...p, text })}
          options={(Object.keys(TEXT_SIZE_LABEL) as TextSize[]).map((v) => ({ value: v, label: TEXT_SIZE_LABEL[v] }))} />
      </div>
      <label className="check">
        <input type="checkbox" checked={p.contrast} onChange={(e) => saveA11y({ ...p, contrast: e.target.checked })} />
        <span>Más contraste <span className="small muted">(textos y bordes más marcados)</span></span>
      </label>
      {!compact && <p className="small muted" style={{ margin: 0 }}>Vale sólo para este dispositivo: cada uno lo deja como le resulta más cómodo.</p>}
    </div>
  );
}
