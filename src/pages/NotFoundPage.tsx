import { Link } from 'react-router';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  return <EmptyState title="Página no encontrada" action={<Link to="/" className="btn btn-primary">Ir al inicio</Link>}>La dirección no existe.</EmptyState>;
}
