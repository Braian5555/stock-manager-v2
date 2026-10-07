import { Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { round3 } from '../utils/format';

/** Control [-] [ n ] [+] grande, pensado para usar con el pulgar. */
export function Stepper({ value, onChange, label, step = 1 }: { value: number | undefined; onChange: (v: number | undefined) => void; label: string; step?: number }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = (t: string) => {
    const n = t.trim() === '' ? undefined : Number(t.replace(',', '.'));
    if (n === undefined || (Number.isFinite(n) && n >= 0)) onChange(n === undefined ? undefined : round3(n));
  };
  return (
    <div className="stepper">
      <button type="button" aria-label={`Restar 1 a ${label}`} onClick={() => onChange(Math.max(0, round3((value ?? 0) - step)))}>
        <Minus size={20} aria-hidden />
      </button>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`Cantidad contada de ${label}`}
        value={text}
        placeholder="—"
        onChange={(e) => {
          setText(e.target.value);
          if (/^\d*([.,]\d*)?$/.test(e.target.value)) commit(e.target.value);
        }}
        onFocus={(e) => e.target.select()}
      />
      <button type="button" aria-label={`Sumar 1 a ${label}`} onClick={() => onChange(round3((value ?? 0) + step))}>
        <Plus size={20} aria-hidden />
      </button>
    </div>
  );
}
