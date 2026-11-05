import { CloudOff } from 'lucide-react';
import { useCloud } from '../../cloud/cloudService';

const SALON_TABLES = ['diningTables', 'menuItems', 'tickets'];

/** Aviso cuando la nube todavía no deja guardar mesas y pedidos (faltan publicar las reglas). */
export function CloudRulesNote() {
  const cloud = useCloud();
  const missing = cloud.phase === 'linked' && (cloud.status.missingRules ?? []).some((t) => SALON_TABLES.includes(t));
  if (!missing) return null;
  return (
    <div className="alert alert-warn" role="note">
      <CloudOff size={18} aria-hidden />
      <span>Las mesas y los pedidos se están guardando sólo en este dispositivo: falta publicar las reglas nuevas de Firebase. Cuando estén, se suben solos y los ven la cocina y los demás mozos.</span>
    </div>
  );
}
