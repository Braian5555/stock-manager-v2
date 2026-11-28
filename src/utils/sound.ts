/**
 * Avisos sonoros cortos (comanda nueva en cocina, pedido listo para el mozo), hechos con Web Audio:
 * no hay archivos de sonido que descargar. Cada pantalla recuerda en el equipo si el sonido va o no.
 *
 * Los navegadores no dejan sonar nada hasta que la persona toca la pantalla una vez: por eso
 * `unlockSound()` se llama desde el botón de sonido (y desde cualquier toque, la primera vez).
 */
type Kind = 'comanda' | 'listo';

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  if (ctx) return ctx;
  const AC = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return undefined;
  try { ctx = new AC(); } catch { return undefined; }
  return ctx;
}

/** Habilita el sonido (hay que llamarlo dentro de un toque o clic). */
export function unlockSound(): void {
  const a = audio();
  if (a && a.state === 'suspended') void a.resume().catch(() => undefined);
}

// Comanda: dos tonos que suben (se distingue en una cocina con ruido). Listo: tres tonos cortos.
const NOTES: Record<Kind, [freq: number, start: number, dur: number][]> = {
  comanda: [[784, 0, 0.18], [1047, 0.2, 0.28]],
  listo: [[1047, 0, 0.12], [1319, 0.14, 0.12], [1568, 0.28, 0.22]],
};

/** Hace sonar el aviso (si el navegador no deja, no pasa nada). */
export function playAlert(kind: Kind): void {
  const a = audio();
  if (!a) return;
  if (a.state === 'suspended') void a.resume().catch(() => undefined);
  const t0 = a.currentTime + 0.02;
  for (const [freq, start, dur] of NOTES[kind]) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t0 + start);
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    osc.connect(gain).connect(a.destination);
    osc.start(t0 + start);
    osc.stop(t0 + start + dur + 0.05);
  }
}

/** Preferencia de sonido de una pantalla, guardada en el equipo (por defecto: con sonido). */
export function readSoundPref(key: string): boolean {
  try { return localStorage.getItem(key) !== 'off'; } catch { return true; }
}
export function writeSoundPref(key: string, on: boolean): void {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
}

/**
 * Ids que aparecen por primera vez en esta lista (comparando con las que ya se vieron).
 * La primera vez no avisa nada: lo que ya estaba al abrir la pantalla no es nuevo.
 */
export function newIds(seen: Set<string> | null, current: string[]): { seen: Set<string>; fresh: string[] } {
  const next = new Set(current);
  if (!seen) return { seen: next, fresh: [] };
  return { seen: next, fresh: current.filter((id) => !seen.has(id)) };
}
