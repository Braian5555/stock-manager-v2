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
      'Definí el stock mínimo de cada producto: con eso la app avisa qué reponer. En Productos → Elegir varios se carga a muchos de una vez.',
      'Hacé un conteo inicial para que el stock de la app sea el real.',
    ],
  },
  {
    title: 'Contar stock',
    steps: [
      'Tocá Contar en el Inicio (o Conteo en el menú) y elegí qué contar.',
      'Cargá las cantidades con los botones + y − o escribiéndolas. También podés escanear el código de barras.',
      'Al terminar, aplicá el conteo: la diferencia queda registrada como ajuste, con quién contó cada producto.',
    ],
  },
  {
    title: 'Panadería',
    steps: [
      'En Producción → Plan, el encargado carga qué hay que hacer hoy o mañana y cuánto.',
      'El panadero toca lo que hizo y la cantidad: se suma al stock y, si tiene receta, se descuentan los insumos.',
      'En Producción → Resumen ves lo producido y los insumos usados, y lo bajás en Excel para el administrativo.',
    ],
  },
  {
    title: 'Facturas',
    steps: [
      'En Facturas tocá Nueva factura y sacale fotos (hasta varias hojas).',
      'Elegí o escribí el proveedor, la fecha y el número: queda guardada para el administrativo.',
      'Con la lectura con IA activada, “Leer con IA” trae los productos de la foto. Revisá los amarillos y rojos: elegí el producto, creálo ahí mismo o marcá “No va al stock”.',
      'Si un renglón viene por bulto o caja (ej. “1 B”), poné cuántas unidades trae: la app lo recuerda para la próxima.',
      '“Guardar y cargar al stock” suma todo de una vez (nunca dos veces). Si te equivocaste, abrí la factura y tocá “Deshacer carga”.',
    ],
  },
  {
    title: 'Asistente IA',
    steps: [
      'Tocá el botón con destellos (arriba) o “Asistente IA” en el Inicio. Escribí o dictá con el micrófono lo que necesitás.',
      'Podés preguntar (“¿qué tengo que reponer?”, “¿cuánta harina se usó esta semana?”, “¿qué aumentó?”) o pedir cosas: cargar un remito con una foto, anotar un conteo dictado, pasar una receta, anotar producción.',
      'Antes de cambiar algo te muestra exactamente qué va a hacer y espera que toques Confirmar. Si después ves que se equivocó, tocá Deshacer en esa misma tarjeta. Sólo puede hacer lo que tu perfil tiene permitido.',
      'Si cargás un remito con el asistente, después no cargues la factura de la misma mercadería: la app te avisa si parece repetida.',
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
