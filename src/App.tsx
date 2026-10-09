import { lazyPage } from './utils/lazyPage';
import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { ensureBaseData } from './services/seedService';
import { initCloud } from './cloud/cloudService';
import { FeedbackProvider } from './store/feedback';
import { SettingsProvider } from './store/settings';
import { SessionProvider, useSession } from './store/session';
import { CloudDisabledScreen, CloudLoginScreen, CloudWorkspaceScreen, LockScreen, SetupScreen } from './components/auth/AuthScreens';
import { Guard } from './components/auth/Guard';
import { AppLayout } from './layouts/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { StockPage } from './pages/StockPage';
const CountsPage = lazyPage(() => import('./pages/CountsPage'), 'CountsPage');
const OrdersPage = lazyPage(() => import('./pages/OrdersPage'), 'OrdersPage');
const InvoicesPage = lazyPage(() => import('./pages/InvoicesPage'), 'InvoicesPage');
const TransfersPage = lazyPage(() => import('./pages/TransfersPage'), 'TransfersPage');
const TransferEditorPage = lazyPage(() => import('./pages/TransferEditorPage'), 'TransferEditorPage');
const MorePage = lazyPage(() => import('./pages/MorePage'), 'MorePage');
import { NotFoundPage } from './pages/NotFoundPage';
const UsersPage = lazyPage(() => import('./pages/UsersPage'), 'UsersPage');
const CloudPage = lazyPage(() => import('./pages/CloudPage'), 'CloudPage');
const OrderEditorPage = lazyPage(() => import('./pages/OrderEditorPage'), 'OrderEditorPage');
const CountDetailPage = lazyPage(() => import('./pages/CountDetailPage'), 'CountDetailPage');
const ProductsPage = lazyPage(() => import('./pages/ProductsPage'), 'ProductsPage');
const CatalogPage = lazyPage(() => import('./pages/CatalogPage'), 'CatalogPage');
const ReconciliationPage = lazyPage(() => import('./pages/ReconciliationPage'), 'ReconciliationPage');
const IntegrationsPage = lazyPage(() => import('./pages/IntegrationsPage'), 'IntegrationsPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const ExportPage = lazyPage(() => import('./pages/ExportPage'), 'ExportPage');
const ReportsPage = lazyPage(() => import('./pages/ReportsPage'), 'ReportsPage');
const HelpPage = lazyPage(() => import('./pages/HelpPages'), 'HelpPage');
const AboutPage = lazyPage(() => import('./pages/HelpPages'), 'AboutPage');
const MovementsPage = lazyPage(() => import('./pages/MovementsPage'), 'MovementsPage');

/**
 * HashRouter: las rutas viven después de "#", así GitHub Pages siempre sirve
 * index.html (sin 404 en recargas profundas) y el service worker no necesita
 * reescrituras de URL.
 */
export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureBaseData()
      .then(() => {
        setReady(true);
        // La nube se inicia en segundo plano: la app nunca espera a Internet.
        void initCloud();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    // Pide al navegador que no borre los datos locales bajo presión de espacio.
    void navigator.storage?.persist?.().catch(() => undefined);
  }, []);

  if (error)
    return (
      <div className="splash" role="alert">
        <div className="card card-pad stack" style={{ maxWidth: 440 }}>
          <h1>No se pudo abrir la base de datos local</h1>
          <p className="muted">{error}</p>
          <p className="small muted">Si estás en modo incógnito, algunos navegadores bloquean el almacenamiento local. Probá en una ventana normal.</p>
        </div>
      </div>
    );
  if (!ready) return <div className="splash" aria-busy="true">Cargando…</div>;

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <FeedbackProvider>
          <SessionProvider>
          <HashRouter>
            <SessionGate>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<Guard module="dashboard"><DashboardPage /></Guard>} />
                <Route path="stock" element={<Guard module="stock"><StockPage /></Guard>} />
                <Route path="productos" element={<Guard module="products"><ProductsPage /></Guard>} />
                <Route path="familias" element={<Guard module="categories"><CatalogPage key="category" kind="category" /></Guard>} />
                <Route path="unidades" element={<Guard module="units"><CatalogPage key="unit" kind="unit" /></Guard>} />
                <Route path="ubicaciones" element={<Guard module="locations"><CatalogPage key="location" kind="location" /></Guard>} />
                <Route path="proveedores" element={<Guard module="suppliers"><CatalogPage key="supplier" kind="supplier" /></Guard>} />
                <Route path="conteo" element={<Guard module="count"><CountsPage /></Guard>} />
                <Route path="conteo/:id" element={<Guard module="count"><CountDetailPage /></Guard>} />
                <Route path="pedidos" element={<Guard module="orders"><OrdersPage /></Guard>} />
                <Route path="pedidos/:id" element={<Guard module="orders"><OrderEditorPage /></Guard>} />
                <Route path="remitos" element={<Guard module="transfers"><TransfersPage /></Guard>} />
                <Route path="remitos/nuevo" element={<Guard module="transfers"><TransferEditorPage /></Guard>} />
                <Route path="facturas" element={<Guard module="invoices"><InvoicesPage /></Guard>} />
                <Route path="movimientos" element={<Guard module="movements"><MovementsPage /></Guard>} />
                <Route path="conciliacion" element={<Guard module="reconciliation"><ReconciliationPage /></Guard>} />
                <Route path="exportar" element={<Guard module="export"><ExportPage /></Guard>} />
                <Route path="configuracion" element={<Guard module="settings"><SettingsPage /></Guard>} />
                <Route path="configuracion/:section" element={<Guard module="settings"><SettingsPage /></Guard>} />
                <Route path="reportes" element={<Guard module="reports"><ReportsPage /></Guard>} />
                <Route path="ayuda" element={<HelpPage />} />
                <Route path="acerca" element={<AboutPage />} />
                <Route path="integraciones" element={<Guard module="integrations"><IntegrationsPage /></Guard>} />
                <Route path="usuarios" element={<Guard module="users"><UsersPage /></Guard>} />
                <Route path="nube" element={<Guard module="cloud"><CloudPage /></Guard>} />
                <Route path="mas" element={<MorePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
            </SessionGate>
          </HashRouter>
          </SessionProvider>
        </FeedbackProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}

/** Muestra el inicio de sesión (nube o PIN) hasta que haya un usuario con sesión. */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { status, loadingText } = useSession();
  if (status === 'loading') return <div className="splash" aria-busy="true">{loadingText ?? 'Cargando…'}</div>;
  if (status === 'cloud_login') return <CloudLoginScreen />;
  if (status === 'cloud_workspace') return <CloudWorkspaceScreen />;
  if (status === 'cloud_disabled') return <CloudDisabledScreen />;
  if (status === 'setup') return <SetupScreen />;
  if (status === 'locked') return <LockScreen />;
  return <>{children}</>;
}
