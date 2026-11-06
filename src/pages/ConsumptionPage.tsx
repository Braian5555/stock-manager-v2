import { ArrowLeft, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState, PageHeader, SearchInput, Segmented } from '../components/ui';
import { useCosts } from '../hooks/useCosts';
import { useLookups, useProducts } from '../hooks/useData';
import { useUsage } from '../hooks/useUsage';
import { daysLabel } from '../services/consumptionService';
import { useFeedback } from '../store/feedback';
import { fmtMoney, fmtNumber, matches } from '../utils/format';

type Days = 7 | 14 | 30;
type Sort = 'pronto' | 'uso' | 'merma';

/**
 * Consumo y mermas: cuánto se usa de verdad cada producto, para cuántos días alcanza lo que hay
 * y cuánto se pierde (vencido, roto, mal estado), con su valor.
 */
export function ConsumptionPage() {
  const { run, notify } = useFeedback();
  const [days, setDays] = useState<Days>(30);
  const [sort, setSort] = useState<Sort>('pronto');
  const [q, setQ] = useState('');
  const usage = useUsage(days);
  const products = useProducts();
  const lk = useLookups();
  const costs = useCosts();

  const rows = useMemo(() => products
    .filter((p) => p.active && usage.has(p.id) && matches(q, p.name, p.sku))
    .map((p) => {
      const u = usage.get(p.id)!;
      const cost = costs.visible ? costs.costOf(p.id)?.cost : undefined;
      return { p, u, unit: lk.unit(p.unitId), usedValue: cost !== undefined ? u.used * cost : undefined, wasteValue: cost !== undefined ? u.waste * cost : undefined };
    })
    .filter((r) => r.u.used > 0 || r.u.waste > 0)
    .sort((a, b) => sort === 'uso' ? (b.usedValue ?? b.u.used) - (a.usedValue ?? a.u.used)
      : sort === 'merma' ? (b.wasteValue ?? b.u.waste) - (a.wasteValue ?? a.u.waste)
        : (a.u.daysLeft ?? Infinity) - (b.u.daysLeft ?? Infinity)), [products, usage, q, sort, costs, lk]);

  const wasteTotal = rows.reduce((s, r) => s + (r.wasteValue ?? 0), 0);
  const usedTotal = rows.reduce((s, r) => s + (r.usedValue ?? 0), 0);
  const anyCost = rows.some((r) => (r.usedValue ?? 0) > 0);
  const soon = rows.filter((r) => r.p.stock > 0 && r.u.daysLeft !== undefined && r.u.daysLeft <= 3).length;

  const excel = () => void run(async () => {
    const [{ toXlsx }, { downloadBlob }] = await Promise.all([import('../exports/writers'), import('../exports/download')]);
    const blob = await toXlsx(`Consumo y mermas (últimos ${days} días)`, [{
      title: 'Consumo',
      columns: ['Producto', 'Unidad', 'Usado', 'Por día', 'Stock', 'Alcanza (días)', 'Mermas', ...(costs.visible ? ['Valor usado', 'Valor mermas'] : [])],
      rows: rows.map((r) => [r.p.name, r.unit, r.u.used, r.u.perDay, r.p.stock, r.u.daysLeft ?? '', r.u.waste, ...(costs.visible ? [r.usedValue ?? '', r.wasteValue ?? ''] : [])]),
    }]);
    downloadBlob(blob, `consumo_${days}d.xlsx`);
    notify('Excel de consumo descargado');
  });

  return (
    <>
      <PageHeader title="Consumo y mermas" subtitle={`Lo que se usó en los últimos ${days} días (ventas, producción, salidas, mermas y faltantes de los conteos).`}
        actions={<><Link to="/stock" className="btn"><ArrowLeft size={18} aria-hidden /> Stock</Link><button type="button" className="btn" onClick={excel} disabled={!rows.length}><FileSpreadsheet size={18} aria-hidden /> Excel</button></>} />
      <div className="sales-period">
        <Segmented<string> label="Período" value={String(days)} onChange={(v) => setDays(Number(v) as Days)} options={[{ value: '7', label: '7 días' }, { value: '14', label: '14 días' }, { value: '30', label: '30 días' }]} />
        <Segmented<Sort> label="Ordenar" value={sort} onChange={setSort} options={[{ value: 'pronto', label: 'Se termina antes' }, { value: 'uso', label: 'Más usado' }, { value: 'merma', label: 'Más merma' }]} />
      </div>
      <div className="salon-stats" aria-label="Resumen del consumo">
        <div className="salon-stat"><span className="num">{soon}</span><span>se terminan en 3 días o menos</span></div>
        {anyCost && <div className="salon-stat"><span className="num">{fmtMoney(usedTotal)}</span><span>valor de lo usado</span></div>}
        {anyCost && <div className="salon-stat"><span className="num">{fmtMoney(wasteTotal)}</span><span>valor de las mermas</span></div>}
        <div className="salon-stat"><span className="num">{rows.length}</span><span>productos con movimiento</span></div>
      </div>
      <div className="toolbar"><SearchInput value={q} onChange={setQ} placeholder="Buscar producto" label="Buscar productos" /></div>
      {rows.length === 0 ? (
        <div className="card"><EmptyState title="Todavía no hay consumo para calcular">Se calcula con las ventas del salón (con receta), la producción, las salidas, las mermas y los conteos.</EmptyState></div>
      ) : (
        <section className="card" aria-label="Consumo por producto">
          <div className="table-wrap">
            <table className="table sales-table">
              <thead><tr><th>Producto</th><th className="num">Usado</th><th className="num">Por día</th><th className="num">Stock</th><th>Alcanza</th><th className="num">Mermas</th>{costs.visible && <th className="num">Valor mermas</th>}</tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.p.id} className={r.p.stock > 0 && (r.u.daysLeft ?? 99) <= 3 ? 'is-soon' : undefined}>
                    <td>{r.p.name}</td>
                    <td className="num">{fmtNumber(r.u.used)} {r.unit}</td>
                    <td className="num">{fmtNumber(r.u.perDay)}</td>
                    <td className="num">{fmtNumber(r.p.stock)}</td>
                    <td>{r.p.stock <= 0 ? 'sin stock' : daysLabel(r.u.daysLeft) || '—'}</td>
                    <td className="num">{r.u.waste ? `${fmtNumber(r.u.waste)} ${r.unit}` : '—'}</td>
                    {costs.visible && <td className="num">{r.wasteValue ? fmtMoney(r.wasteValue) : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="small muted">Para anotar una merma: en Stock, “Registrar movimiento” → Pérdida, con el motivo (vencido, roto, mal estado).</p>
    </>
  );
}
