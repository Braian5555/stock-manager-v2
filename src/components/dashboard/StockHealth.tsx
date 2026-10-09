import { ClipboardCheck } from 'lucide-react';
import { Link } from 'react-router';
import type { StockStatus } from '../../models';

export type HealthCounts = Record<StockStatus, number>;

const ORDER: StockStatus[] = ['normal', 'bajo', 'critico', 'sin_stock'];
const NAME: Record<StockStatus, string> = { normal: 'Normal', bajo: 'Bajo', critico: 'Crítico', sin_stock: 'Sin stock' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Estado del stock: una barra con la distribución por estado y las líneas que llevan a cada
 * filtro de Stock. Si ningún producto tiene stock cargado, en lugar de alarmar con
 * "todo sin stock" explica que falta el conteo inicial.
 */
export function StockHealth({ counts, canCount, hasMovements, compact }: { counts: HealthCounts; canCount: boolean; hasMovements: boolean; compact?: boolean }) {
  const total = ORDER.reduce((a, k) => a + counts[k], 0);
  if (total === 0) return null;
  const low = counts.bajo + counts.critico;
  // Todo en 0 y sin ningún movimiento registrado: falta el stock inicial (no es un faltante real).
  const noStockLoaded = counts.sin_stock === total && !hasMovements;

  return (
    <section className={`card health ${compact ? 'health-compact' : ''}`} aria-labelledby="estado-stock">
      <div className="card-head">
        <h2 id="estado-stock">Estado del stock</h2>
        <span className="small muted num">{plural(total, 'producto activo', 'productos activos')}</span>
      </div>
      <div className="health-body">
        {noStockLoaded ? (
          <div className="health-empty">
            <p>
              <strong>Todavía no hay stock cargado.</strong> Los {total} productos figuran en 0 porque nunca se registró un conteo ni un ingreso.
              Hacé un conteo inicial y el estado del stock se calcula solo.
            </p>
            <div className="row wrap">
              {canCount && <Link to="/conteo" className="btn btn-primary btn-sm"><ClipboardCheck size={16} aria-hidden /> Hacer conteo inicial</Link>}
              <Link to="/stock?estado=sin_stock" className="btn btn-sm">{plural(counts.sin_stock, 'producto está sin stock', 'productos están sin stock')}</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="health-bar" role="img" aria-label={ORDER.map((k) => `${NAME[k]}: ${counts[k]}`).join(', ')}>
              {ORDER.filter((k) => counts[k] > 0).map((k) => (
                <i key={k} className={`hb-${k}`} style={{ flexGrow: counts[k] }} title={`${NAME[k]}: ${counts[k]}`} />
              ))}
            </div>
            <ul className="health-list">
              {counts.sin_stock > 0 && (
                <li><Link to="/stock?estado=sin_stock"><span className="hdot hb-sin_stock" aria-hidden />{plural(counts.sin_stock, 'producto está sin stock', 'productos están sin stock')}</Link></li>
              )}
              {low > 0 && (
                <li>
                  <Link to="/stock?estado=bajo"><span className="hdot hb-bajo" aria-hidden />{plural(low, 'producto tiene stock bajo', 'productos tienen stock bajo')}</Link>
                  {counts.critico > 0 && <Link to="/stock?estado=critico" className="health-note">{plural(counts.critico, 'crítico', 'críticos')}</Link>}
                </li>
              )}
              <li><Link to="/stock?estado=normal"><span className="hdot hb-normal" aria-hidden />{plural(counts.normal, 'producto con stock normal', 'productos con stock normal')}</Link></li>
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
