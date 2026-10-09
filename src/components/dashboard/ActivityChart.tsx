import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { StockMovement } from '../../models';
import { MOVEMENT_GROUPS } from '../../services/stockService';
import { localYmd } from '../../utils/format';

const IN_TYPES = new Set<string>(MOVEMENT_GROUPS.ingresos.types);
const OUT_TYPES = new Set<string>([...MOVEMENT_GROUPS.salidas.types, ...MOVEMENT_GROUPS.perdidas.types]);

interface Day { ymd: string; label: string; weekday: string; ins: number; outs: number }

/** Últimos `days` días (incluido hoy), con la cantidad de ingresos y de salidas+pérdidas registrados. */
export function activityByDay(movements: StockMovement[], days = 14, today = new Date()): Day[] {
  const out: Day[] = [];
  const idx = new Map<string, Day>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const day: Day = {
      ymd: localYmd(d),
      label: d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }).replace('.', ''),
      weekday: d.toLocaleDateString('es-AR', { weekday: 'short' }).replace('.', ''),
      ins: 0,
      outs: 0,
    };
    out.push(day);
    idx.set(day.ymd, day);
  }
  for (const m of movements) {
    const day = idx.get(localYmd(new Date(m.createdAt)));
    if (!day) continue;
    if (IN_TYPES.has(m.type)) day.ins++;
    else if (OUT_TYPES.has(m.type)) day.outs++;
  }
  return out;
}

const W = 560;
const H = 176;
const PAD_X = 6;
const MID = 84; // línea base: ingresos hacia arriba, salidas hacia abajo
const AMP = 66;

/**
 * Actividad de los últimos 14 días: cantidad de movimientos (no de unidades, porque se mezclan
 * kilos, litros y unidades). Ingresos hacia arriba, salidas y pérdidas hacia abajo.
 * Cada día lleva a Movimientos filtrado por esa fecha.
 */
export function ActivityChart({ movements }: { movements: StockMovement[] }) {
  const navigate = useNavigate();
  const data = useMemo(() => activityByDay(movements), [movements]);
  const [hover, setHover] = useState<number | null>(null);
  const totalIn = data.reduce((a, d) => a + d.ins, 0);
  const totalOut = data.reduce((a, d) => a + d.outs, 0);
  if (totalIn + totalOut === 0) return null;

  const max = Math.max(1, ...data.map((d) => Math.max(d.ins, d.outs)));
  const slot = (W - PAD_X * 2) / data.length;
  const barW = Math.min(18, slot * 0.46);
  const h = (v: number) => (v === 0 ? 0 : Math.max(3, (v / max) * AMP));
  const hd = hover === null ? null : data[hover];

  return (
    <section className="card activity" aria-labelledby="actividad">
      <div className="card-head">
        <h2 id="actividad">Actividad · últimos 14 días</h2>
        <div className="chart-legend small" aria-hidden>
          <span><i className="lg-in" /> Ingresos <b className="num">{totalIn}</b></span>
          <span><i className="lg-out" /> Salidas y pérdidas <b className="num">{totalOut}</b></span>
        </div>
      </div>
      <div className="activity-body">
        <div className="activity-tip small" aria-live="polite">
          {hd ? (
            <><b>{hd.weekday} {hd.label}</b> · {hd.ins} {hd.ins === 1 ? 'ingreso' : 'ingresos'} · {hd.outs} {hd.outs === 1 ? 'salida' : 'salidas'}</>
          ) : (
            <span className="muted">Cantidad de movimientos por día. Tocá un día para verlos.</span>
          )}
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="activity-svg" role="img" aria-label={`Movimientos de los últimos 14 días: ${totalIn} ingresos y ${totalOut} salidas o pérdidas.`}>
          <line x1={0} x2={W} y1={MID} y2={MID} className="axis" />
          {data.map((d, i) => {
            const cx = PAD_X + slot * i + slot / 2;
            const hi = h(d.ins);
            const ho = h(d.outs);
            return (
              <g
                key={d.ymd}
                className={`day ${hover === i ? 'on' : ''}`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onClick={() => navigate(`/movimientos?desde=${d.ymd}&hasta=${d.ymd}`)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && navigate(`/movimientos?desde=${d.ymd}&hasta=${d.ymd}`)}
                tabIndex={0}
                role="link"
                aria-label={`${d.weekday} ${d.label}: ${d.ins} ingresos, ${d.outs} salidas`}
              >
                <rect className="hit" x={cx - slot / 2} y={0} width={slot} height={H} />
                {hi > 0 && <path className="bar-in" d={roundedTop(cx - barW / 2, MID - 1 - hi, barW, hi)} />}
                {ho > 0 && <path className="bar-out" d={roundedBottom(cx - barW / 2, MID + 1, barW, ho)} />}
                {(i === 0 || i === data.length - 1 || i % 7 === 6) && (
                  <text x={cx} y={H - 4} textAnchor="middle" className="tick">{i === data.length - 1 ? 'Hoy' : d.label}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

/** Barra con las esquinas superiores redondeadas (el extremo de datos) y la base recta. */
function roundedTop(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function roundedBottom(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}
