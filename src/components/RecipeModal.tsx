import { useEffect, useMemo, useState } from 'react';
import { useLookups, useProducts } from '../hooks/useData';
import type { Product, Recipe } from '../models';
import { saveProduct } from '../services/productService';
import { createQuickProduct } from '../services/lineProductService';
import { useFeedback } from '../store/feedback';
import { RecipeEditor } from './RecipeEditor';
import { useCosts } from '../hooks/useCosts';
import { fmtMoney, fmtNumber } from '../utils/format';
import { Modal } from './ui/Modal';

/** Editar la receta de un producto sin salir de Producción. Sólo se guarda al tocar "Guardar receta". */
export function RecipeModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm } = useFeedback();
  const [recipe, setRecipe] = useState<Recipe | undefined>();
  // Costo con la receta tal como se está editando.
  const edited = useMemo(() => (product ? { ...product, recipe } : undefined), [product, recipe]);
  const costs = useCosts(edited);

  useEffect(() => {
    if (product) setRecipe(product.recipe ? { ...product.recipe, items: product.recipe.items.map((i) => ({ ...i })) } : undefined);
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- copiar sólo al abrir

  if (!product) return null;
  const incomplete = recipe?.items.filter((i) => !(i.quantity > 0)).length ?? 0;

  const save = async () => {
    if (incomplete) return;
    const current = products.find((p) => p.id === product.id) ?? product;
    const saved = await run(() => saveProduct({ ...current, recipe }), recipe ? 'Receta guardada' : 'Receta quitada');
    if (saved) onClose();
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Quitar receta', message: `“${product.name}” queda sin receta: al anotar producción sólo se suma lo producido, sin descontar insumos.`, confirmLabel: 'Quitar receta', danger: true });
    if (!ok) return;
    const current = products.find((p) => p.id === product.id) ?? product;
    const saved = await run(() => saveProduct({ ...current, recipe: undefined }), 'Receta quitada');
    if (saved) onClose();
  };

  return (
    <Modal
      open
      wide
      title={`Receta: ${product.name}`}
      onClose={onClose}
      footer={
        <>
          {product.recipe && <button type="button" className="btn btn-danger" onClick={remove}>Quitar receta</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn btn-primary" disabled={incomplete > 0} onClick={save}>Guardar receta</button>
        </>
      }
    >
      <div className="form-grid">
        <RecipeEditor value={recipe} onChange={setRecipe} products={products} lk={lk} selfId={product.id} unit={lk.unit(product.unitId)}
          onCreate={(name, unitId) => run(() => createQuickProduct({ name, unitId, elaborated: false, categoryId: lk.categories.find((c) => /almac/i.test(c.name))?.id }), `Creado “${name}”`)} />
        {costs.visible && product && recipe?.items.length ? (() => {
          const c = costs.recipeCost(product.id);
          if (!c) return null;
          return (
            <div className="span-all recipe-cost" aria-label="Costo de la receta">
              <div className="row between wrap"><b>Costo</b><span><b className="num">{fmtMoney(c.perUnit)}</b> por {lk.unit(product.unitId) || 'u'} · {fmtMoney(c.perBatch)} la tanda</span></div>
              <ul className="small">
                {c.lines.map((l) => <li key={l.productId} className="row between"><span className="truncate">{l.name} · {fmtNumber(l.quantity)}</span><span className="num">{l.total !== undefined ? fmtMoney(l.total) : <span className="muted">sin precio</span>}</span></li>)}
              </ul>
              {c.missing.length > 0 && <p className="small muted" style={{ margin: 0 }}>Sin precio: {c.missing.join(', ')}. Se completa al cargar sus facturas (o su costo en Productos).</p>}
              {c.pct !== undefined && Math.abs(c.pct) >= 1 && <p className={`small ${c.pct > 0 ? 'neg' : 'muted'}`} style={{ margin: 0 }}>{c.pct > 0 ? 'Subió' : 'Bajó'} {Math.abs(c.pct)}% contra la compra anterior de los insumos.</p>}
            </div>
          );
        })() : null}
        {incomplete > 0 && <p className="small span-all" style={{ color: 'var(--out)' }}>Falta la cantidad de {incomplete === 1 ? 'un insumo' : `${incomplete} insumos`}.</p>}
        <p className="small muted span-all">Los cambios valen para las producciones que se anoten desde ahora; las ya anotadas no se modifican.</p>
      </div>
    </Modal>
  );
}
