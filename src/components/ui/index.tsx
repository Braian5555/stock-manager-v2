import { Search } from 'lucide-react';
import { cloneElement, isValidElement, useEffect, useId, useState, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import type { StockStatus } from '../../models';
import { STATUS_LABEL } from '../../services/stockService';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/**
 * Campo con etiqueta asociada por id (label for=…). Si el hijo no es un control
 * (p. ej. un grupo de botones), se usa un grupo con aria-labelledby.
 */
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const isControl = isValidElement(children) && typeof children.type === 'string' ? ['input', 'select', 'textarea'].includes(children.type) : isValidElement(children) && [Input, Select, Textarea, NumberInput, CommitInput].includes(children.type as never);
  const labelNode = (
    <span className="field-label" id={`${id}-l`}>
      {label} {hint && <span className="hint">· {hint}</span>}
    </span>
  );
  if (isControl) {
    const child = children as ReactElement<{ id?: string }>;
    return (
      <div className={`field ${className ?? ''}`}>
        <label htmlFor={child.props.id ?? id}>{labelNode}</label>
        {cloneElement(child, { id: child.props.id ?? id })}
      </div>
    );
  }
  return (
    <div className={`field ${className ?? ''}`} role="group" aria-labelledby={`${id}-l`}>
      {labelNode}
      {children}
    </div>
  );
}

export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`input ${p.className ?? ''}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`select ${p.className ?? ''}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`textarea ${p.className ?? ''}`} />;

export function SearchInput({ value, onChange, placeholder = 'Buscar…', label = 'Buscar' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div className="search">
      <Search size={18} aria-hidden />
      <input className="input" type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} />
    </div>
  );
}

const STATUS_EMOJI: Record<StockStatus, string> = { normal: '🟢', bajo: '🟡', critico: '🟠', sin_stock: '🔴' };

export function StatusBadge({ status }: { status: StockStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      <span aria-hidden>{STATUS_EMOJI[status]}</span>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Badge({ tone = '', children }: { tone?: string; children: ReactNode }) {
  return <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>;
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Input numérico que acepta coma decimal. */
export function NumberInput({ value, onChange, min, step = 'any', ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <input
      {...rest}
      className={`input num ${rest.className ?? ''}`}
      type="number"
      inputMode="decimal"
      min={min}
      step={step}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
    />
  );
}

/** Input de texto que guarda al salir del campo (o con Enter) y no pierde lo tipeado si los datos cambian. */
export function CommitInput({ value, onCommit, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);
  return (
    <input
      {...rest}
      className={`input ${rest.className ?? ''}`}
      value={text}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      onBlur={() => {
        setEditing(false);
        if (text !== value) onCommit(text);
      }}
    />
  );
}
