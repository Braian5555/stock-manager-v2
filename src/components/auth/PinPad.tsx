import { Delete } from 'lucide-react';
import { useEffect } from 'react';

/** Teclado numérico grande para el PIN (también acepta el teclado físico). */
export function PinPad({ value, onChange, onSubmit, max = 6, disabled, label = 'PIN' }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  max?: number;
  disabled?: boolean;
  label?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled || (e.target instanceof HTMLInputElement && e.target.type !== 'password')) return;
      if (/^\d$/.test(e.key) && value.length < max) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= 4) onSubmit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, max, disabled]);

  return (
    <div className="pinpad">
      <div className="pin-dots" role="status" aria-label={`${label}: ${value.length} dígitos ingresados`}>
        {Array.from({ length: Math.max(4, Math.min(max, value.length + 1)) }).map((_, i) => (
          <span key={i} className={i < value.length ? 'on' : ''} />
        ))}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" disabled={disabled || value.length >= max} onClick={() => onChange(value + d)} aria-label={`Número ${d}`}>{d}</button>
        ))}
        <button type="button" disabled={disabled || !value} onClick={() => onChange(value.slice(0, -1))} aria-label="Borrar"><Delete size={22} aria-hidden /></button>
        <button type="button" disabled={disabled || value.length >= max} onClick={() => onChange(value + '0')} aria-label="Número 0">0</button>
        <button type="button" className="pin-ok" disabled={disabled || value.length < 4} onClick={onSubmit}>Entrar</button>
      </div>
    </div>
  );
}
