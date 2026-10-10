import { useEffect, useState } from 'react';
import { useLookups, useProducts } from '../hooks/useData';
import type { Product, Recipe } from '../models';
import { saveProduct } from '../services/productService';
import { useFeedback } from '../store/feedback';
import { RecipeEditor } from './RecipeEditor';
import { Modal } from './ui/Modal';

/** Editar la receta de un producto sin salir de Producción. Sólo se guarda al tocar "Guardar receta". */
export function RecipeModal({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const { run, confirm } = useFeedback();
  const [recipe, setRecipe] = useState<Recipe | undefined>();

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
        <RecipeEditor value={recipe} onChange={setRecipe} products={products} lk={lk} selfId={product.id} unit={lk.unit(product.unitId)} />
        {incomplete > 0 && <p className="small span-all" style={{ color: 'var(--out)' }}>Falta la cantidad de {incomplete === 1 ? 'un insumo' : `${incomplete} insumos`}.</p>}
        <p className="small muted span-all">Los cambios valen para las producciones que se anoten desde ahora; las ya anotadas no se modifican.</p>
      </div>
    </Modal>
  );
}
