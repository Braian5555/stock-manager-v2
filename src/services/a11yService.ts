/**
 * Accesibilidad de ESTE dispositivo (no de todo el negocio): tamaño de letra y más contraste.
 * Se guarda en el navegador y se aplica como clases en <html> (el CSS usa rem, así que todo escala).
 */
export type TextSize = 'normal' | 'grande' | 'muy-grande';
export interface A11yPrefs { text: TextSize; contrast: boolean }

const KEY = 'sm:a11y';
export const TEXT_SIZE_LABEL: Record<TextSize, string> = { normal: 'Normal', grande: 'Grande', 'muy-grande': 'Muy grande' };
const DEFAULT: A11yPrefs = { text: 'normal', contrast: false };
const listeners = new Set<() => void>();

export function readA11y(): A11yPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<A11yPrefs> | null;
    const text = raw?.text && raw.text in TEXT_SIZE_LABEL ? raw.text : DEFAULT.text;
    return { text, contrast: !!raw?.contrast };
  } catch {
    return DEFAULT;
  }
}

export function applyA11y(p: A11yPrefs = readA11y()) {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.toggle('text-grande', p.text === 'grande');
  html.classList.toggle('text-muy-grande', p.text === 'muy-grande');
  html.classList.toggle('high-contrast', p.contrast);
}

export function saveA11y(p: A11yPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* sin almacenamiento: vale hasta cerrar la app */
  }
  applyA11y(p);
  listeners.forEach((l) => l());
}

export function onA11yChange(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
