import { useLiveQuery } from 'dexie-react-hooks';
import { Check, CheckCheck, CookingPot, Printer, Volume2, VolumeX } from 'lucide-react';
import { printComanda } from '../services/printService';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../database/db';
import { EMPTY } from '../hooks/useData';
import { minutesSince, sinceLabel, useNow } from '../hooks/useNow';
import type { Station, TableTicket } from '../models';
import { KITCHEN_LATE_MIN, KITCHEN_WARN_MIN, STATION_LABEL, markLineReady, markLinesReady, markTicketReady, stationOf, ticketLabel } from '../services/salonService';
import { useMenu } from '../components/salon/hooks';
import { useFeedback } from '../store/feedback';
import { EmptyState, PageHeader, Segmented } from '../components/ui';
import { CloudRulesNote } from '../components/salon/CloudRulesNote';
import { inLocal, useLocalScope } from '../services/localScope';
import { newIds, playAlert, readSoundPref, unlockSound, writeSoundPref } from '../utils/sound';

const WARN_MIN = KITCHEN_WARN_MIN;
const LATE_MIN = KITCHEN_LATE_MIN;
type Filter = Station | 'todo';
const STATION_KEY = 'sm.kitchen.station';
const SOUND_KEY = 'sm.kitchen.sound';
const readStation = (): Filter => { try { const v = localStorage.getItem(STATION_KEY); return v === 'cocina' || v === 'barra' ? v : 'todo'; } catch { return 'todo'; } };

/**
 * Cocina: las comandas que mandan los mozos, de la más vieja a la más nueva.
 * Tocá un plato cuando está listo (o "Todo listo"); el mozo lo ve en el salón.
 * Cada comanda nueva suena (como el monitor de cocina de Fudo); el sonido se apaga desde el botón.
 */
export function KitchenPage() {
  const { run } = useFeedback();
  const now = useNow(20_000);
  const lid = useLocalScope().current?.id;
  const openRaw = useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').filter(inLocal).toArray(), [lid]);
  const open = (openRaw ?? EMPTY) as TableTicket[];
  const loaded = openRaw !== undefined;
  // Barra: si hay platos que se preparan en la barra, cada puesto puede ver sólo lo suyo (se recuerda en este equipo).
  const hasBar = useMenu().some((m) => m.kitchen && m.station === 'barra') || open.some((t) => t.lines.some((l) => l.station === 'barra' && l.status === 'cocina'));
  const [stationState, setStationState] = useState<Filter>(readStation);
  const station: Filter = hasBar ? stationState : 'todo';
  const setStation = (v: Filter) => { setStationState(v); try { localStorage.setItem(STATION_KEY, v); } catch { /* sin almacenamiento */ } };
  const cards = useMemo(() => open
    .map((t) => {
      const lines = t.lines.filter((l) => l.status === 'cocina' && (station === 'todo' || stationOf(l) === station));
      return { t, lines, since: lines.map((l) => l.sentAt ?? t.openedAt).sort()[0] };
    })
    .filter((c) => c.lines.length)
    .sort((a, b) => (a.since ?? '').localeCompare(b.since ?? '')), [open, station]);
  // Sonido: suena cuando llega un plato nuevo a este puesto (no con lo que ya estaba al abrir la pantalla).
  const [sound, setSoundState] = useState(() => readSoundPref(SOUND_KEY));
  const setSound = (on: boolean) => { unlockSound(); setSoundState(on); writeSoundPref(SOUND_KEY, on); if (on) playAlert('comanda'); };
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const ids = cards.flatMap((c) => c.lines.filter((l) => l.qty > 0).map((l) => l.id));
    const r = newIds(seen.current, ids);
    seen.current = r.seen;
    if (r.fresh.length && sound) playAlert('comanda');
  }, [cards, sound, loaded]);
  useEffect(() => {
    // Los navegadores no dejan sonar hasta el primer toque: cualquier toque en la pantalla lo habilita.
    const on = () => unlockSound();
    window.addEventListener('pointerdown', on, { once: true });
    return () => window.removeEventListener('pointerdown', on);
  }, []);
  const title = station === 'todo' ? (hasBar ? 'Cocina y barra' : 'Cocina') : STATION_LABEL[station];
  const dishes = cards.reduce((s, c) => s + c.lines.reduce((x, l) => x + l.qty, 0), 0);

  return (
    <div className="kitchen">
      <PageHeader title={title} subtitle={cards.length ? `${cards.length} ${cards.length === 1 ? 'comanda' : 'comandas'} · ${dishes} ${dishes === 1 ? 'plato' : 'platos'} por hacer` : 'Las comandas de los mozos aparecen acá.'}
        actions={<button type="button" className={`btn${sound ? '' : ' btn-ghost'}`} aria-pressed={sound} onClick={() => setSound(!sound)}>
          {sound ? <Volume2 size={18} aria-hidden /> : <VolumeX size={18} aria-hidden />} {sound ? 'Sonido activado' : 'Sin sonido'}
        </button>} />
      {hasBar && <div style={{ marginBottom: 12 }}><Segmented<Filter> label="Puesto" value={station} onChange={setStation} options={[{ value: 'todo', label: 'Todo' }, { value: 'cocina', label: 'Cocina' }, { value: 'barra', label: 'Barra' }]} /></div>}
      <CloudRulesNote />
      {cards.length === 0 ? (
        <div className="card"><EmptyState icon={<CookingPot size={40} />} title="Sin comandas pendientes">Cuando un mozo manda un pedido a cocina, aparece acá al instante.</EmptyState></div>
      ) : (
        <ul className="kitchen-board" aria-label="Comandas">
          {cards.map(({ t, lines, since }) => {
            const min = minutesSince(since, now);
            const tone = min >= LATE_MIN ? 'is-late' : min >= WARN_MIN ? 'is-warn' : '';
            return (
              <li key={t.id} className={`kitchen-ticket ${tone}`} aria-label={ticketLabel(t)}>
                <header className="kitchen-head">
                  <span className="kitchen-table">{ticketLabel(t)}</span>
                  <span className="kitchen-time num">{sinceLabel(since, now)}</span>
                  <button type="button" className="kitchen-print" aria-label={`Imprimir comanda: ${ticketLabel(t)}`} onClick={() => void run(() => printComanda(t, lines))}><Printer size={18} aria-hidden /></button>
                </header>
                <p className="kitchen-meta">#{t.number}{t.guests ? ` · ${t.guests} comensales` : ''}{t.openedBy ? ` · Mozo: ${t.openedBy.name}` : ''}</p>
                <ul className="kitchen-lines">
                  {lines.map((l) => (
                    <li key={l.id}>
                      <button type="button" className={`kitchen-line${l.qty === 0 ? ' is-void' : ''}`} onClick={() => void run(() => markLineReady(t.id, l.id))}
                        aria-label={l.qty === 0 ? `${l.name} anulado: sacar de la lista` : `Listo: ${l.qty} ${l.name}`}>
                        <b className="kitchen-qty num">{l.qty === 0 ? '✕' : l.qty}</b>
                        <span className="kitchen-name">
                          {l.name}{l.qty === 0 && <em> anulado</em>}
                          {station === 'todo' && hasBar && <span className="kitchen-station">{STATION_LABEL[stationOf(l)]}</span>}
                          {l.notes && <span className="kitchen-note">{l.notes}</span>}
                        </span>
                        <Check size={20} aria-hidden className="kitchen-check" />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" className="btn btn-block kitchen-done" onClick={() => void run(() => (station === 'todo' ? markTicketReady(t.id) : markLinesReady(t.id, lines.map((l) => l.id))), `${ticketLabel(t)}: listo`)}>
                  <CheckCheck size={18} aria-hidden /> Todo listo
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
