import { Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { loadDemoData } from '../services/seedService';
import { useFeedback } from '../store/feedback';

export function WelcomeCard() {
  const { run } = useFeedback();
  return (
    <section className="card card-pad stack" style={{ marginBottom: 16 }} aria-labelledby="bienvenida">
      <h2 id="bienvenida" className="row"><Sparkles size={18} aria-hidden /> ¡Bienvenido!</h2>
      <p className="muted">
        Ya están creadas las unidades, familias y ubicaciones más comunes (podés cambiarlas cuando quieras).
        Empezá cargando tus productos o probá la app con datos de ejemplo genéricos.
      </p>
      <div className="row wrap">
        <Link to="/productos?nuevo=1" className="btn btn-primary">Crear mi primer producto</Link>
        <button type="button" className="btn" onClick={() => run(loadDemoData, 'Datos de ejemplo cargados')}>
          Cargar datos de ejemplo
        </button>
      </div>
    </section>
  );
}
