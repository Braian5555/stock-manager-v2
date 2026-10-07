import { MapPin, Package, Ruler, Tags, Truck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { globalSearch, type SearchHit, type SearchKind } from '../services/searchService';
import { Modal } from './ui/Modal';
import { SearchInput } from './ui';

const ICON: Record<SearchKind, typeof Package> = { product: Package, supplier: Truck, category: Tags, location: MapPin, unit: Ruler };
const KIND: Record<SearchKind, string> = { product: 'Producto', supplier: 'Proveedor', category: 'Familia', location: 'Ubicación', unit: 'Unidad' };

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const navigate = useNavigate();

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
    navigate(h.to);
  };

  return (
    <Modal open={open} onClose={onClose} title="Buscar">
      <div className="stack">
        <SearchInput value={q} onChange={setQ} placeholder="Productos, códigos, proveedores, familias, ubicaciones…" label="Búsqueda global" />
        <div className="list card" role="listbox" aria-label="Resultados">
          {q && !hits.length && <p className="muted card-pad">Sin resultados para “{q}”.</p>}
          {!q && <p className="muted card-pad small">Escribí para buscar en toda la app.</p>}
          {hits.map((h) => {
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
