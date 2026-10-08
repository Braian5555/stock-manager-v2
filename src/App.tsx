import { lazy, useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { ensureBaseData } from './services/seedService';
import { initCloud } from './cloud/cloudService';
import { FeedbackProvider } from './store/feedback';
import { SettingsProvider } from './store/settings';
import { SessionProvider, useSession } from './store/session';
import { LockScreen, SetupScreen, WaitingCloudScreen } from './components/auth/AuthScreens';
import { Guard } from './components/auth/Guard';
import { AppLayout } from './layouts/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { StockPage } from './pages/StockPage';
import { CountsPage } from './pages/CountsPage';
import { OrdersPage } from './pages/OrdersPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { TransfersPage } from './pages/TransfersPage';
import { TransferEditorPage } from './pages/TransferEditorPage';
import { MorePage } from './pages/MorePage';
import { NotFoundPage } from './pages/NotFoundPage';
const UsersPage = lazy(() => import('./pages/UsersPage').then((m) => ({ default: m.UsersPage })));
const CloudPage = lazy(() => import('./pages/CloudPage').then((m) => ({ default: m.CloudPage })));
const OrderEditorPage = lazy(() => import('./pages/OrderEditorPage').then((m) => ({ default: m.OrderEditorPage })));
const CountDetailPage = lazy(() => import('./pages/CountDetailPage').then((m) => ({ default: m.CountDetailPage })));
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const CatalogPage = lazy(() => import('./pages/CatalogPage').then((m) => ({ default: m.CatalogPage })));
const ReconciliationPage = lazy(() => import('./pages/ReconciliationPage').then((m) => ({ default: m.ReconciliationPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const ExportPage = lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })));
const MovementsPage = lazy(() => import('./pages/MovementsPage').then((m) => ({ default: m.MovementsPage })));

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

/** Muestra crear administrador / bloqueo con PIN hasta que haya un usuario con sesión. */
function SessionGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  if (status === 'loading') return <div className="splash" aria-busy="true">Cargando…</div>;
  if (status === 'waiting') return <WaitingCloudScreen />;
  if (status === 'setup') return <SetupScreen />;
  if (status === 'locked') return <LockScreen />;
  return <>{children}</>;
}
