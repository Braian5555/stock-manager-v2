import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installErrorLog } from './services/diagnosticsService';
import { applyA11y } from './services/a11yService';
import './styles/fonts.css';
import './styles/global.css';
import './styles/salon.css';

installErrorLog();
applyA11y();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
