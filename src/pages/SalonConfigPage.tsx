import { Armchair, BookOpen, ChevronRight, Printer, UserCog } from 'lucide-react';
import { Link } from 'react-router';
import { FiscalSettingsSection } from '../components/FiscalSettingsSection';
import { useSession } from '../store/session';

/**
 * Configuración del Salón: todo lo del salón en un solo lugar. La facturación electrónica (ARCA)
 * y accesos a mesas, carta y usuarios (mozos). La configuración general de la app queda en el área de Stock.
 */
export function SalonConfigPage() {
  const { can } = useSession();
  const links = [
    { to: '/salon', icon: Armchair, title: 'Mesas y plano', sub: 'Crear mesas y sectores, y acomodarlas en el plano (botón “Editar plano”).' },
    { to: '/salon?vista=carta', icon: BookOpen, title: 'Carta', sub: 'Platos, precios, adicionales, IVA y código de Maxirest.' },
    ...(can('admin') ? [{ to: '/usuarios', icon: UserCog, title: 'Mozos y permisos', sub: 'Usuarios con rol Mozo (sólo Salón y Cocina) o con permiso para cobrar y facturar.' }] : []),
  ];
  return (
    <div className="stack salon-config">
      <section className="card" aria-labelledby="salon-config-links">
        <div className="card-head"><h2 id="salon-config-links">Salón</h2></div>
        <nav className="list">
          {links.map(({ to, icon: Icon, title, sub }) => (
            <Link key={to} to={to} className="list-item more-row">
              <span className="stat-icon" aria-hidden><Icon size={19} /></span>
              <span className="grow"><span className="list-title">{title}</span><span className="list-sub">{sub}</span></span>
              <ChevronRight size={18} className="muted" aria-hidden />
            </Link>
          ))}
        </nav>
      </section>
      <p className="small muted row" style={{ margin: 0 }}><Printer size={16} aria-hidden /> Los tickets (factura, pre-cuenta, comanda y arqueo) se imprimen en 80 mm desde el diálogo de impresión del dispositivo.</p>
      <FiscalSettingsSection />
    </div>
  );
}
