import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installErrorLog } from './services/diagnosticsService';
import { applyA11y } from './services/a11yService';
import { startLocalScope } from './services/localScope';
import './styles/fonts.css';
import './styles/global.css';
import './styles/salon.css';

installErrorLog();
applyA11y();
// Cada equipo trabaja en su local (mesas, carta, ventas, caja y comprobantes separados).
startLocalScope();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
