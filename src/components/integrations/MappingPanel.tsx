import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { db } from '../../database/db';
import type { ExternalEntityType, ExternalReference } from '../../models';
import { createProductFromExternal, link, suggestMatch, unlink } from '../../integrations/core/linking';
import { useFeedback } from '../../store/feedback';
import { Badge, SearchInput, Segmented, Select } from '../ui';
import { fmtNumber, matches } from '../../utils/format';

const NEW = '__new__';
const NO_REFS: ExternalReference[] = [];
const NO_LOCALS: LocalItem[] = [];
const TYPE_LABEL: Record<ExternalEntityType, string> = { product: 'Insumos ↔ Productos', category: 'Rubros ↔ Familias', unit: 'Unidades', location: 'Depósitos ↔ Ubicaciones' };

interface LocalItem { id: string; name: string; sku?: string; externalSystems?: { maxirest?: { id: string } } }

/**
 * Vincula registros de Maxirest con entidades locales. Las coincidencias por código/nombre
 * se proponen pero NUNCA se aplican sin que el usuario confirme con "Guardar vínculos".
 */
export function MappingPanel({ initialType = 'product', onSaved }: { initialType?: ExternalEntityType; onSaved?: () => void }) {
  const [type, setType] = useState<ExternalEntityType>(initialType);
  const [q, setQ] = useState('');
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const { run, notify } = useFeedback();
  const refs = useLiveQuery(() => db.externalReferences.where({ system: 'maxirest', entityType: type }).sortBy('name'), [type]) ?? NO_REFS;
  const locals = (useLiveQuery(() => ({ product: db.products, category: db.categories, unit: db.units, location: db.locations })[type].toArray() as Promise<LocalItem[]>, [type]) ?? NO_LOCALS);
  const [sel, setSel] = useState<Record<string, string>>({});

  const linkedTo = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of locals) if (l.externalSystems?.maxirest) m.set(l.externalSystems.maxirest.id, l.id);
    return m;
  }, [locals]);

  useEffect(() => {
    const init: Record<string, string> = {};
    for (const r of refs) init[r.externalId] = linkedTo.get(r.externalId) ?? suggestMatch(r, locals)?.id ?? '';
    setSel(init);
  }, [refs, locals, linkedTo]);

  const changed = refs.filter((r) => (sel[r.externalId] ?? '') !== (linkedTo.get(r.externalId) ?? ''));
  const shown = refs.filter((r) => matches(q, r.name, r.code) && (!onlyUnlinked || !linkedTo.has(r.externalId)));
  const unlinkedCount = refs.filter((r) => !linkedTo.has(r.externalId)).length;

  const saveLinks = async () => {
    const used = new Map<string, string>();
    for (const r of refs) {
      const v = sel[r.externalId];
      if (v && v !== NEW) {
        if (used.has(v)) return notify(`Un mismo elemento local no puede vincularse a dos registros de Maxirest (${r.name}).`, { tone: 'error' });
        used.set(v, r.externalId);
      }
    }
    const res = await run(async () => {
      let n = 0;
      for (const r of changed) {
        const target = sel[r.externalId];
        const prev = linkedTo.get(r.externalId);
        if (prev) await unlink(type, prev);
        if (target === NEW) await createProductFromExternal(r);
        else if (target) await link(type, target, r);
        n++;
      }
      return n;
    });
    if (res !== undefined) {
      notify(`${res} ${res === 1 ? 'vínculo actualizado' : 'vínculos actualizados'}.`);
      onSaved?.();
    }
  };

  return (
    <div className="stack">
      <Segmented<ExternalEntityType> label="Tipo de vínculo" value={type} onChange={setType} options={(Object.keys(TYPE_LABEL) as ExternalEntityType[]).map((t) => ({ value: t, label: TYPE_LABEL[t] }))} />
      {refs.length === 0 ? (
        <p className="muted small">No hay datos de Maxirest para este tipo. Sincronizá o importá un Excel primero.</p>
      ) : (
        <>
          {unlinkedCount > 0 && <p className="alert alert-warn small">{unlinkedCount} {unlinkedCount === 1 ? 'registro de Maxirest no está vinculado' : 'registros de Maxirest no están vinculados'}.</p>}
          <div className="toolbar">
            <SearchInput value={q} onChange={setQ} placeholder="Buscar por código o nombre" />
            <label className="check small"><input type="checkbox" checked={onlyUnlinked} onChange={(e) => setOnlyUnlinked(e.target.checked)} /> Sólo sin vincular</label>
          </div>
          <div className="card">
            {shown.map((r) => {
              const current = sel[r.externalId] ?? '';
              const isLinked = linkedTo.has(r.externalId);
              const suggested = !isLinked && current && current !== NEW;
              return (
                <div key={r.id} className="count-item">
                  <div className="grow" style={{ minWidth: 180 }}>
                    <div className="list-title">{r.name}</div>
                    <div className="list-sub">
                      {r.code && `Cód. ${r.code}`} {r.stock !== undefined && ` · stock ${fmtNumber(r.stock)}`} {r.unitName && ` · ${r.unitName}`}
                      {' '}{isLinked ? <Badge tone="ok">Vinculado</Badge> : suggested ? <Badge tone="warn">Sugerido</Badge> : <Badge>Sin vincular</Badge>}
                    </div>
                  </div>
                  <Select aria-label={`Vincular ${r.name}`} value={current} onChange={(e) => setSel((s) => ({ ...s, [r.externalId]: e.target.value }))} style={{ maxWidth: 300 }}>
                    <option value="">— Sin vincular —</option>
                    {type === 'product' && !isLinked && <option value={NEW}>+ Crear producto nuevo</option>}
                    {locals.map((l) => <option key={l.id} value={l.id}>{l.name}{l.sku ? ` (${l.sku})` : ''}</option>)}
                  </Select>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <span className="small muted grow">{changed.length} cambios sin guardar</span>
            <button type="button" className="btn btn-primary" disabled={!changed.length} onClick={saveLinks}>Guardar vínculos</button>
          </div>
        </>
      )}
    </div>
  );
}
