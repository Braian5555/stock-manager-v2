import { useLiveQuery } from 'dexie-react-hooks';
import { Building } from 'lucide-react';
import { useMemo } from 'react';
import { db } from '../../database/db';
import { EMPTY } from '../../hooks/useData';
import type { CashSession, FiscalDoc, ID, TableTicket } from '../../models';
import { outletOf, setCentralView, useLocalScope } from '../../services/localScope';
import { fmtMoney } from '../../utils/format';

interface Row { id: ID; code?: string; name: string; sold: number; orders: number; open: number; cash: CashSession | undefined; invoiced: number; unbilled: number }

const ymd = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const docYmd = (f?: string) => (f && f.length === 8 ? `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}` : '');

/**
 * La Central ("aplicación madre"): hoy, local por local. Vendido, pedidos, mesas abiertas, caja,
 * facturado en ARCA y cobrado sin factura. Tocar un local lo abre (para verlo u operarlo).
 */
export function LocalsOverview() {
  const scope = useLocalScope();
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const tickets = (useLiveQuery(() => db.tickets.where('openedAt').aboveOrEqual(new Date(Date.parse(since) - 864e5).toISOString()).toArray(), [since]) ?? EMPTY) as TableTicket[];
  const open = (useLiveQuery(() => db.tickets.where('status').anyOf('abierta', 'cuenta').toArray(), []) ?? EMPTY) as TableTicket[];
  const cash = (useLiveQuery(() => db.cashSessions.where('status').equals('abierta').toArray(), []) ?? EMPTY) as CashSession[];
  const docs = (useLiveQuery(() => db.fiscalDocs.where('createdAt').aboveOrEqual(new Date(Date.parse(since) - 864e5).toISOString()).toArray(), [since]) ?? EMPTY) as FiscalDoc[];

  const rows = useMemo(() => {
    const today = ymd(new Date().toISOString());
    const out = new Map<ID, Row>(scope.outlets.map((o) => [o.id, { id: o.id, code: o.code, name: o.name, sold: 0, orders: 0, open: 0, cash: undefined, invoiced: 0, unbilled: 0 }]));
    const get = (r: { outletId?: ID }) => { const id = outletOf(r); return id ? out.get(id) : undefined; };
    const authorized = new Set(docs.filter((d) => d.status === 'autorizada').map((d) => d.id));
    for (const t of tickets) {
      const r = get(t);
      if (!r || t.status !== 'cerrada' || !t.closedAt || ymd(t.closedAt) !== today) continue;
      r.sold += t.total;
      r.orders++;
      const billed = t.charges?.length ? t.charges.every((c) => c.fiscalDocId && authorized.has(c.fiscalDocId)) : !!(t.fiscalDocId && authorized.has(t.fiscalDocId));
      if (!billed) r.unbilled += t.total;
    }
    for (const t of open) { const r = get(t); if (r) r.open++; }
    for (const c of cash) { const r = get(c); if (r) r.cash = c; }
    for (const d of docs) {
      const r = get(d);
      if (!r || d.status !== 'autorizada' || d.ambiente !== 'produccion' || docYmd(d.fecha) !== today) continue;
      r.invoiced += d.kind === 'nc' ? -d.impTotal : d.impTotal;
    }
    return [...out.values()];
  }, [scope.outlets, tickets, open, cash, docs]);

  if (!scope.central || scope.current || !scope.outlets.length) return null;
  const total = rows.reduce((a, r) => ({ sold: a.sold + r.sold, orders: a.orders + r.orders, open: a.open + r.open, invoiced: a.invoiced + r.invoiced, unbilled: a.unbilled + r.unbilled }), { sold: 0, orders: 0, open: 0, invoiced: 0, unbilled: 0 });
  return (
    <section className="hm-block" aria-labelledby="central-title">
      <h2 id="central-title" className="hm-block-title row" style={{ gap: 8 }}><Building size={20} aria-hidden /> Central · hoy en cada local</h2>
      <div className="card">
        <div className="table-wrap">
          <table className="table" aria-label="Locales hoy">
            <thead><tr><th>Local</th><th className="num">Vendido</th><th className="num">Pedidos</th><th className="num">Mesas abiertas</th><th>Caja</th><th className="num">Facturado ARCA</th><th className="num">Sin factura</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><button type="button" className="link-btn" onClick={() => setCentralView(r.id)} title={`Ver ${r.name}`}>{r.code ? `${r.code} · ` : ''}{r.name}</button></td>
                  <td className="num">{fmtMoney(r.sold)}</td>
                  <td className="num">{r.orders}</td>
                  <td className="num">{r.open || '—'}</td>
                  <td>{r.cash ? `Abierta (#${r.cash.number})` : 'Cerrada'}</td>
                  <td className="num">{r.invoiced ? fmtMoney(r.invoiced) : '—'}</td>
                  <td className="num">{r.unbilled ? fmtMoney(r.unbilled) : '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th>Todos</th><th className="num">{fmtMoney(total.sold)}</th><th className="num">{total.orders}</th><th className="num">{total.open || '—'}</th><th /><th className="num">{total.invoiced ? fmtMoney(total.invoiced) : '—'}</th><th className="num">{total.unbilled ? fmtMoney(total.unbilled) : '—'}</th></tr></tfoot>
          </table>
        </div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Tocá un local para verlo (y operarlo). Arriba, en el selector de la Central, volvés a “todos”. Los reportes, ventas y comprobantes con “todos” suman todos los locales.</p>
    </section>
  );
}
