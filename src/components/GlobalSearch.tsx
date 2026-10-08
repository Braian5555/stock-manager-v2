import type { ModuleKey } from '../models';
import { MODULE_PERMISSIONS } from '../layouts/modules';
import { MapPin, Package, Ruler, Tags, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSession } from '../store/session';
import { globalSearch, type SearchHit, type SearchKind } from '../services/searchService';
import { Modal } from './ui/Modal';
import { SearchInput } from './ui';

const ICON: Record<SearchKind, typeof Package> = { product: Package, supplier: Truck, category: Tags, location: MapPin, unit: Ruler };
const KIND: Record<SearchKind, string> = { product: 'Producto', supplier: 'Proveedor', category: 'Familia', location: 'Ubicación', unit: 'Unidad' };

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const navigate = useNavigate();
  const { canAny } = useSession();
  const allowed = (m: ModuleKey) => canAny(MODULE_PERMISSIONS[m]);
  // Destino de cada resultado según los permisos (sin permiso, el resultado no se muestra).
  const target = (h: SearchHit): string | null => {
    if (h.kind === 'product') return allowed('products') ? h.to : allowed('stock') ? '/stock' : null;
    if (h.kind === 'supplier') return allowed('suppliers') ? h.to : null;
    if (h.kind === 'unit') return allowed('units') ? h.to : null;
    return allowed('stock') ? h.to : null;
  };

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => globalSearch(q).then((h) => alive && setHits(h)), 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const go = (h: SearchHit) => {
    onClose();
    setQ('');
    const to = target(h);
    if (to) navigate(to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Buscar">
      <div className="stack">
        <SearchInput value={q} onChange={setQ} placeholder="Productos, códigos, proveedores, familias, ubicaciones…" label="Búsqueda global" />
        <div className="list card" role="listbox" aria-label="Resultados">
          {q && !hits.filter((h) => target(h)).length && <p className="muted card-pad">Sin resultados para “{q}”.</p>}
          {!q && <p className="muted card-pad small">Escribí para buscar en toda la app.</p>}
          {hits.filter((h) => target(h)).map((h) => {
            const Icon = ICON[h.kind];
            return (
              <button key={`${h.kind}:${h.id}`} type="button" role="option" aria-selected={false} className="list-item" onClick={() => go(h)}>
                <Icon size={18} aria-hidden className="muted" />
                <div className="grow">
                  <div className="list-title truncate">{h.title}</div>
                  {h.subtitle && <div className="list-sub truncate">{h.subtitle}</div>}
                </div>
                <span className="badge">{KIND[h.kind]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
