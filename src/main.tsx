import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installErrorLog } from './services/diagnosticsService';
import './styles/fonts.css';
import './styles/global.css';

installErrorLog();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
