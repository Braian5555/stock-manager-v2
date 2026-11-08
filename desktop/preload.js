/**
 * Puente entre Orillas (la página) y el programa de Windows: sólo para la página de Orillas.
 * Expone window.orillasDesktop con la impresión directa y la elección de impresoras.
 */
const { contextBridge, ipcRenderer } = require('electron');

const APP_ORIGIN = 'https://stock-manager-a7cf7.web.app';

if (location.origin === APP_ORIGIN) {
  contextBridge.exposeInMainWorld('orillasDesktop', {
    /** Impresoras instaladas en esta compu. */
    printers: () => ipcRenderer.invoke('orillas:printers'),
    /** Impresora elegida para cada cosa: { ticket, cocina, barra }. */
    getPrinters: () => ipcRenderer.invoke('orillas:get-printers'),
    setPrinters: (printers) => ipcRenderer.invoke('orillas:set-printers', printers),
    /** Imprime directo (sin cuadro). kind: 'ticket' | 'cocina' | 'barra'. */
    print: (html, kind) => ipcRenderer.invoke('orillas:print', { html, kind }),
    info: () => ipcRenderer.invoke('orillas:info'),
  });
}
