import { lazy, useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router';
import { ensureBaseData } from './services/seedService';
import { FeedbackProvider } from './store/feedback';
import { SettingsProvider } from './store/settings';
import { AppLayout } from './layouts/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/DashboardPage';
import { StockPage } from './pages/StockPage';
import { CountsPage } from './pages/CountsPage';
import { OrdersPage } from './pages/OrdersPage';
import { MorePage } from './pages/MorePage';
import { NotFoundPage } from './pages/NotFoundPage';
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
      .then(() => setReady(true))
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
          <HashRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="stock" element={<StockPage />} />
                <Route path="productos" element={<ProductsPage />} />
                <Route path="familias" element={<CatalogPage key="category" kind="category" />} />
                <Route path="unidades" element={<CatalogPage key="unit" kind="unit" />} />
                <Route path="ubicaciones" element={<CatalogPage key="location" kind="location" />} />
                <Route path="proveedores" element={<CatalogPage key="supplier" kind="supplier" />} />
                <Route path="conteo" element={<CountsPage />} />
                <Route path="conteo/:id" element={<CountDetailPage />} />
                <Route path="pedidos" element={<OrdersPage />} />
                <Route path="pedidos/:id" element={<OrderEditorPage />} />
                <Route path="movimientos" element={<MovementsPage />} />
                <Route path="conciliacion" element={<ReconciliationPage />} />
                <Route path="exportar" element={<ExportPage />} />
                <Route path="configuracion" element={<SettingsPage />} />
                <Route path="integraciones" element={<IntegrationsPage />} />
                <Route path="mas" element={<MorePage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </HashRouter>
        </FeedbackProvider>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
