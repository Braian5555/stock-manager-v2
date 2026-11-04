import { useLiveQuery } from 'dexie-react-hooks';
import { LogIn, LogOut, MonitorSmartphone, RefreshCw, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../database/db';
import { EMPTY } from '../hooks/useData';
import type { AccessEntry, AccessKind } from '../models';
import { cloudLinked, fetchAccessLog } from '../cloud/cloudService';
import { ACCESS_KIND_LABEL } from '../services/accessService';
import { fmtTime, localYmd } from '../utils/format';
import { Badge, EmptyState, PageHeader, Segmented, Select } from './ui';

type Period = '1' | '7' | '30';
const PERIOD_LABEL: Record<Period, string> = { '1': 'Hoy', '7': '7 días', '30': '30 días' };

const sinceFor = (p: Period) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (Number(p) - 1));
  return d.toISOString();
};

const dayLabel = (ymd: string) => {
  const today = localYmd();
  const yesterday = localYmd(new Date(Date.now() - 86_400_000));
  if (ymd === today) return 'Hoy';
  if (ymd === yesterday) return 'Ayer';
  const s = new Date(`${ymd}T12:00:00`).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const KIND_TONE: Record<AccessKind, string> = { ingreso: 'ok', apertura: 'info', salida: '' };

/**
 * Configuración → Registro de ingresos: quién entró a la app, cuándo y desde qué dispositivo.
 * Con la nube se ven los ingresos de todos los dispositivos; sin nube, los de este.
 */
export function AccessLogSection() {
  const [period, setPeriod] = useState<Period>('7');
  const [who, setWho] = useState('');
  const since = useMemo(() => sinceFor(period), [period]);
  const local = (useLiveQuery(() => db.accessLog.where('at').aboveOrEqual(since).toArray(), [since]) ?? EMPTY) as AccessEntry[];
  const [remote, setRemote] = useState<AccessEntry[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const linked = cloudLinked();

  const load = useCallback(async () => {
    if (!cloudLinked()) return;
    setLoading(true);
    try {
      setRemote(await fetchAccessLog(since));
      setError('');
    } catch (e) {
      const denied = (e as { code?: string }).code === 'permission-denied';
      setError(denied
        ? 'La nube no deja leer el registro: falta publicar las reglas nuevas en Firebase, y sólo el dueño o los administradores del espacio lo pueden ver. Mientras tanto se ven los ingresos de este dispositivo.'
        : 'No se pudo traer el registro de la nube (¿sin conexión?). Se ven los ingresos de este dispositivo.');
    } finally {
      setLoading(false);
    }
  }, [since]);
  useEffect(() => { void load(); }, [load]);

  // Lo de la nube más lo de este dispositivo que todavía no se subió.
  const all = useMemo(() => {
    const byId = new Map<string, AccessEntry>();
    for (const e of remote ?? []) byId.set(e.id, e);
    for (const e of local) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()].sort((a, b) => b.at.localeCompare(a.at));
  }, [remote, local]);

  const people = useMemo(() => {
    const m = new Map<string, { id: string; name: string; last: AccessEntry; ingresos: number; devices: Set<string> }>();
    for (const e of all) {
      const p = m.get(e.userId) ?? { id: e.userId, name: e.userName, last: e, ingresos: 0, devices: new Set<string>() };
      if (e.kind !== 'salida') p.ingresos++;
      p.devices.add(e.deviceId);
      m.set(e.userId, p);
    }
    return [...m.values()].sort((a, b) => b.last.at.localeCompare(a.last.at));
  }, [all]);

  const shown = who ? all.filter((e) => e.userId === who) : all;
  const days = useMemo(() => {
    const g = new Map<string, AccessEntry[]>();
    for (const e of shown) {
      const k = localYmd(new Date(e.at));
      g.set(k, [...(g.get(k) ?? []), e]);
    }
    return [...g.entries()];
  }, [shown]);

  return (
    <>
      <PageHeader title="Registro de ingresos" subtitle="Quién entró a la app, cuándo y desde qué dispositivo."
        actions={linked && <button type="button" className="btn btn-sm" onClick={() => void load()} disabled={loading}><RefreshCw size={16} aria-hidden className={loading ? 'spin-icon' : ''} /> Actualizar</button>} />

      {!linked && <p className="small muted" style={{ marginTop: 0 }}>Este dispositivo no está conectado a la nube: se ven sólo los ingresos hechos acá.</p>}
      {error && <div className="alert alert-warn" role="note"><span>{error}</span></div>}

      <div className="row wrap access-tools">
        <Segmented<Period> label="Período" value={period} onChange={setPeriod} options={(['1', '7', '30'] as Period[]).map((v) => ({ value: v, label: PERIOD_LABEL[v] }))} />
        {people.length > 1 && (
          <Select aria-label="Persona" value={who} onChange={(e) => setWho(e.target.value)} style={{ maxWidth: 240 }}>
            <option value="">Todas las personas</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
      </div>

      {all.length === 0 ? (
        <div className="card"><EmptyState icon={<LogIn size={40} />} title="Sin ingresos en este período">Cada vez que alguien entra o abre la app queda anotado acá.</EmptyState></div>
      ) : (<>
        <section className="card access-people" aria-labelledby="access-people">
          <div className="card-head"><h2 id="access-people">Última vez de cada persona</h2></div>
          <ul className="list">
            {people.map((p) => (
              <li key={p.id} className="list-item">
                <div className="grow">
                  <div className="list-title truncate">{p.name}</div>
                  <div className="list-sub">{p.ingresos} {p.ingresos === 1 ? 'vez' : 'veces'} · {p.devices.size} {p.devices.size === 1 ? 'dispositivo' : 'dispositivos'}</div>
                </div>
                <div className="access-when">
                  <b>{dayLabel(localYmd(new Date(p.last.at)))}</b>
                  <span>{fmtTime(p.last.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {days.map(([ymd, list]) => (
          <section key={ymd} className="card access-day" aria-label={dayLabel(ymd)}>
            <div className="card-head"><h2>{dayLabel(ymd)}</h2><span className="small muted">{list.length} {list.length === 1 ? 'registro' : 'registros'}</span></div>
            <ul className="list">
              {list.map((e) => {
                const Icon = e.kind === 'salida' ? LogOut : /iPhone|Android|iPad/.test(e.device) ? Smartphone : e.kind === 'ingreso' ? LogIn : MonitorSmartphone;
                return (
                  <li key={e.id} className="list-item access-row">
                    <span className="access-time num">{fmtTime(e.at)}</span>
                    <Icon size={18} aria-hidden className="muted" />
                    <div className="grow">
                      <div className="list-title truncate">{e.userName}</div>
                      <div className="list-sub truncate">{e.device}{e.email ? ` · ${e.email}` : ''}</div>
                    </div>
                    <Badge tone={KIND_TONE[e.kind]}>{ACCESS_KIND_LABEL[e.kind]}</Badge>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </>)}
    </>
  );
}
