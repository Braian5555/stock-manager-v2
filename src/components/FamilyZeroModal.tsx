import { useEffect, useState } from 'react';
import { familyZeroPreview, undoFamilyZero, zeroFamilyStock, type FamilyZeroPreview } from '../services/familyZeroService';
import { useFeedback } from '../store/feedback';
import { useLookups } from '../hooks/useData';
import { fmtNumber } from '../utils/format';
import { Modal } from './ui/Modal';

/** Familias → "Poner en 0": muestra qué cambia y deja elegir si se tocan los productos que tienen receta. */
export function FamilyZeroModal({ categoryId, onClose }: { categoryId: string | null; onClose: () => void }) {
  const { run, notify } = useFeedback();
  const lk = useLookups();
  const [preview, setPreview] = useState<FamilyZeroPreview | null>(null);
  const [skipRecipes, setSkipRecipes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    setSkipRecipes(false);
    if (categoryId) void familyZeroPreview(categoryId).then(setPreview);
  }, [categoryId]);

  if (!categoryId) return null;
  const affected = preview ? preview.withStock.filter((p) => !(skipRecipes && p.recipe?.items.length)) : [];

  const apply = async () => {
    if (busy || !affected.length) return;
    setBusy(true);
    const moves = await run(() => zeroFamilyStock(categoryId, { skipWithRecipe: skipRecipes }));
    setBusy(false);
    if (!moves) return;
    onClose();
    notify(`${preview?.family}: ${moves.length} ${moves.length === 1 ? 'producto quedó' : 'productos quedaron'} en 0. Las recetas no se tocaron.`, { undo: () => void undoFamilyZero(moves) });
  };

  return (
    <Modal open title={`Poner en 0: ${preview?.family ?? ''}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={onClose}>Cancelar</button><button type="button" className="btn btn-danger" disabled={busy || !affected.length} onClick={apply}>Poner {affected.length || ''} en 0</button></>}>
      {!preview ? <p className="muted">Calculando…</p> : (
        <div className="stack">
          <p style={{ margin: 0 }}>
            El stock del Depósito Central de {preview.withStock.length ? <b>{affected.length} de {preview.products}</b> : 'ningún'} producto{preview.products === 1 ? '' : 's'} de la familia queda en 0.
            {' '}Las recetas, los productos y el historial no se borran: cada uno queda como un ajuste en Movimientos y se puede deshacer.
          </p>
          {preview.withStockAndRecipe > 0 && (
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={skipRecipes} onChange={(e) => setSkipRecipes(e.target.checked)} />
              No tocar los que tienen receta ({preview.withStockAndRecipe})
            </label>
          )}
          {affected.length > 0 && (
            <div className="card list" style={{ maxHeight: 260, overflow: 'auto' }} aria-label="Productos que quedan en 0">
              {affected.map((p) => (
                <div key={p.id} className="list-item">
                  <span className="grow truncate">{p.name}</span>
                  <span className="num muted">{fmtNumber(p.stock)} {lk.unit(p.unitId) || 'u'} → 0</span>
                </div>
              ))}
            </div>
          )}
          {!preview.withStock.length && <p className="muted small">Todos los productos de esta familia ya están en 0.</p>}
        </div>
      )}
    </Modal>
  );
}
