import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CURRENT_DB_VERSION, db } from '../database/db';
import { useSession } from '../store/session';
import { useSettings } from '../store/settings';
import { PageHeader } from '../components/ui';
import { useSyncView } from '../components/SyncBadge';

const GUIDES: { title: string; steps: string[] }[] = [
  {
    title: 'Primeros pasos',
    steps: [
      'Cargá tus productos en Productos (o importalos desde Excel en Configuración → Importar y exportar).',
      'Definí el stock mínimo de cada producto: con eso la app avisa qué reponer.',
      'Cargá a tus proveedores y asignáselos a cada producto para armar pedidos sugeridos.',
    ],
  },
  {
    title: 'Contar stock',
    steps: [
      'Tocá Contar en el Inicio (o Conteo en el menú) y elegí qué contar.',
      'Cargá las cantidades con los botones + y − o escribiéndolas.',
      'Al terminar, aplicá el conteo: la diferencia queda registrada como ajuste.',
    ],
  },
  {
    title: 'Pedidos a proveedores',
    steps: [
      'En Pedidos usá "Pedido sugerido" para armar un pedido con lo que falta.',
      'Cuando llega la mercadería, abrí el pedido y tocá Recibir: el stock se suma solo.',
    ],
  },
  {
    title: 'Remitos internos y Maxirest',
    steps: [
      'En Remitos creá el envío del Depósito Central a cada punto.',
      'Después cargalo en Maxirest y marcalo como "Cargado" para llevar el control.',
    ],
  },
  {
    title: 'Trabajar con varios dispositivos',
    steps: [
      'En Cuenta y nube iniciá sesión y usá el mismo espacio en todos los dispositivos.',
      'Sin Internet podés seguir trabajando: los cambios se envían solos al volver la conexión.',
      'El estado de sincronización está siempre arriba a la derecha.',
    ],
  },
  {
    title: 'Instalar la app',
    steps: [
      'Android o computadora: en Chrome/Edge, menú ⋮ → Instalar app.',
      'iPhone: en Safari, botón Compartir → Agregar a inicio.',
    ],
  },
];

export function HelpPage() {
  return (
    <>
      <PageHeader title="Ayuda" subtitle="Guías rápidas para el trabajo de todos los días." />
      <div className="help-grid">
        {GUIDES.map((g) => (
          <section key={g.title} className="card card-pad stack-sm">
            <h2>{g.title}</h2>
            <ol className="help-steps">
              {g.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
          </section>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>¿Algo no funciona? Revisá <Link to="/acerca">Información de la aplicación</Link> y pasale esos datos a quien administra la app.</p>
    </>
  );
}

/** Información de la aplicación (visible para todos). */
export function AboutPage() {
  const settings = useSettings();
  const { can } = useSession();
  const sync = useSyncView();
  const products = useLiveQuery(() => db.products.count(), []) ?? 0;
  const [storage, setStorage] = useState<string>('—');
  useEffect(() => {
    void navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setStorage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`);
    }).catch(() => undefined);
  }, []);
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  return (
    <>
      <PageHeader title="Información de la aplicación" />
      <section className="card card-pad stack">
        <dl className="kv">
          <dt>Aplicación</dt><dd>Stock Manager v{__APP_VERSION__}</dd>
          <dt>Negocio</dt><dd>{settings.businessName}</dd>
          <dt>Instalada como app</dt><dd>{installed ? 'Sí' : 'No (se usa desde el navegador)'}</dd>
          <dt>Conexión y nube</dt><dd>{sync.label}</dd>
          <dt>Productos en este dispositivo</dt><dd>{products}</dd>
          <dt>Espacio usado</dt><dd>{storage}</dd>
          <dt>Base de datos local</dt><dd>IndexedDB v{CURRENT_DB_VERSION}</dd>
        </dl>
        {can('admin') && <div><Link to="/configuracion/diagnostico" className="btn btn-sm">Ver diagnóstico completo</Link></div>}
      </section>
    </>
  );
}
