import { ArrowDownToLine, ArrowUpFromLine, Camera, ChefHat, ClipboardCheck, Forklift, MessageCircle, Plus, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useLookups, useProducts } from '../hooks/useData';
import type { MovementType, Permission, Product } from '../models';
import { useSession } from '../store/session';
import { fmtNumber, matches } from '../utils/format';
import { MovementModal } from './MovementModal';
import { SupplierOrderModal } from './SupplierOrderModal';
import { Modal } from './ui/Modal';

interface QuickAction {
  key: string;
  label: string;
  icon: LucideIcon;
  perms: Permission[];
  to?: string;
  move?: MovementType;
  supplierOrder?: boolean;
}

const ACTIONS: QuickAction[] = [
  { key: 'in', label: 'Ingreso', icon: ArrowDownToLine, perms: ['stock.move'], move: 'ingreso' },
  { key: 'out', label: 'Salida', icon: ArrowUpFromLine, perms: ['stock.move'], move: 'salida' },
  { key: 'order', label: 'Pedir a proveedor', icon: MessageCircle, perms: ['orders.manage'], supplierOrder: true },
  { key: 'count', label: 'Contar', icon: ClipboardCheck, perms: ['count.do'], to: '/conteo' },
  { key: 'prod', label: 'Producción', icon: ChefHat, perms: ['production'], to: '/produccion' },
  { key: 'transfer', label: 'Remito', icon: Forklift, perms: ['transfers'], to: '/remitos/nuevo' },
  { key: 'invoice', label: 'Foto de factura', icon: Camera, perms: ['invoices'], to: '/facturas?nueva=1' },
];

/**
 * Botón "+" flotante en todas las pantallas: las acciones de todos los días a un toque.
 * Ingreso / Salida piden el producto (buscador) y abren el movimiento ya con el tipo elegido.
 */
export function QuickAdd() {
  const { canAny } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [moveType, setMoveType] = useState<MovementType | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [ordering, setOrdering] = useState(false);
  const actions = ACTIONS.filter((a) => canAny(a.perms));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  // Quien tiene una sola acción (p. ej. el panadero) ya tiene su pantalla: no hace falta el botón.
  if (actions.length < 2) return null;

  const choose = (a: QuickAction) => {
    setOpen(false);
    if (a.move) setMoveType(a.move);
    else if (a.supplierOrder) setOrdering(true);
    else if (a.to) navigate(a.to);
  };

  return (
    <>
      {open && <div className="quick-backdrop" onClick={() => setOpen(false)} aria-hidden />}
      <div className={`quick ${open ? 'open' : ''}`}>
        {open && (
          <div className="quick-menu" role="menu" aria-label="Acciones rápidas">
            {actions.map((a) => (
              <button key={a.key} type="button" role="menuitem" className="quick-item" onClick={() => choose(a)}>
                <span className="quick-item-icon"><a.icon size={20} aria-hidden /></span>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="quick-fab" aria-expanded={open} aria-label={open ? 'Cerrar acciones rápidas' : 'Acciones rápidas'} onClick={() => setOpen((o) => !o)}>
          {open ? <X size={26} aria-hidden /> : <Plus size={28} aria-hidden />}
        </button>
      </div>

      <ProductPicker
        open={!!moveType && !product}
        title={moveType === 'salida' ? 'Salida: elegí el producto' : 'Ingreso: elegí el producto'}
        onPick={setProduct}
        onClose={() => setMoveType(null)}
      />
      <MovementModal product={product} initialType={moveType ?? 'ingreso'} onClose={() => { setProduct(null); setMoveType(null); }} />
      <SupplierOrderModal open={ordering} onClose={() => setOrdering(false)} />
    </>
  );
}

/** Buscador grande de productos (para elegir rápido sobre qué producto se hace algo). */
function ProductPicker({ open, title, onPick, onClose }: { open: boolean; title: string; onPick: (p: Product) => void; onClose: () => void }) {
  const products = useProducts();
  const lk = useLookups();
  const [q, setQ] = useState('');
  useEffect(() => {
    if (open) setQ('');
  }, [open]);
  const list = useMemo(
    () => products.filter((p) => p.active && matches(q, p.name, p.sku, lk.category(p.categoryId))).sort((a, b) => a.name.localeCompare(b.name, 'es')).slice(0, 60),
    [products, q, lk],
  );
  return (
    <Modal open={open} title={title} onClose={onClose}>
      <div className="stack">
        <label className="production-search">
          <Search size={18} aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto o código" aria-label="Buscar producto" data-autofocus />
        </label>
        <div className="list">
          {list.map((p) => (
            <button key={p.id} type="button" className="list-item" onClick={() => onPick(p)}>
              <span className="grow">
                <span className="list-title">{p.name}</span>
                <span className="list-sub" style={{ display: 'block' }}>{[lk.category(p.categoryId), lk.location(p.locationId)].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="small muted num">{fmtNumber(p.stock)} {lk.unit(p.unitId)}</span>
            </button>
          ))}
          {list.length === 0 && <p className="muted small">No hay productos con ese nombre.</p>}
        </div>
      </div>
    </Modal>
  );
}
