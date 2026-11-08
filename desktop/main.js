/**
 * Orillas para Windows.
 *
 * Abre Orillas (la app web publicada) en su propia ventana y le agrega lo que el navegador no deja:
 * imprimir directo, sin el cuadro de impresión, en la impresora que corresponde a cada cosa
 * (tickets y facturas, comandas de cocina, comandas de barra). Las impresoras se eligen en Orillas,
 * en Configuración → Impresión de tickets, y quedan guardadas en esta compu.
 *
 * El programa se actualiza solo (GitHub Releases). Lo de Orillas se actualiza como siempre, con cada
 * versión nueva de la app web.
 */
const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const APP_URL = 'https://stock-manager-a7cf7.web.app/';
const APP_ORIGIN = new URL(APP_URL).origin;
const KINDS = ['ticket', 'cocina', 'barra'];

// ───────────── Configuración de esta compu (impresoras) ─────────────
const configFile = () => path.join(app.getPath('userData'), 'orillas-config.json');
function readConfig() {
  try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return { printers: {} }; }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2));
}

// ───────────── Ventana principal ─────────────
let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: 'Orillas',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    backgroundColor: '#ebe6dc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.maximize();
  win.loadURL(`${APP_URL}#/salon`);

  // Lo que no es Orillas (ayuda de ARCA, WhatsApp, etc.) se abre en el navegador de siempre.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_ORIGIN)) { void shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) { e.preventDefault(); void shell.openExternal(url); }
  });
}

// ───────────── Impresión directa ─────────────
const fromApp = (e) => {
  try { return new URL(e.senderFrame.url).origin === APP_ORIGIN; } catch { return false; }
};

ipcMain.handle('orillas:printers', async (e) => {
  if (!fromApp(e)) throw new Error('No permitido');
  const list = await win.webContents.getPrintersAsync();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!p.isDefault }));
});

ipcMain.handle('orillas:get-printers', (e) => {
  if (!fromApp(e)) throw new Error('No permitido');
  return readConfig().printers ?? {};
});

ipcMain.handle('orillas:set-printers', (e, printers) => {
  if (!fromApp(e)) throw new Error('No permitido');
  const clean = {};
  for (const k of KINDS) if (typeof printers?.[k] === 'string' && printers[k]) clean[k] = printers[k];
  writeConfig({ ...readConfig(), printers: clean });
  return clean;
});

/** Imprime el HTML de un ticket sin cuadro, en la impresora elegida para ese tipo (o la predeterminada). */
ipcMain.handle('orillas:print', async (e, { html, kind }) => {
  if (!fromApp(e)) throw new Error('No permitido');
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Ticket inválido');
  const printers = readConfig().printers ?? {};
  const deviceName = printers[KINDS.includes(kind) ? kind : 'ticket'] || printers.ticket || undefined;
  const job = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, javascript: false } });
  try {
    await job.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      job.webContents.print(
        { silent: true, printBackground: true, deviceName, margins: { marginType: 'none' } },
        (ok, reason) => (ok ? resolve() : reject(new Error(reason === 'cancelled' ? 'Impresión cancelada' : `No se pudo imprimir${deviceName ? ` en ${deviceName}` : ''}: ${reason}`))),
      );
    });
    return { ok: true, printer: deviceName ?? 'predeterminada' };
  } finally {
    job.destroy();
  }
});

ipcMain.handle('orillas:info', (e) => {
  if (!fromApp(e)) throw new Error('No permitido');
  return { version: app.getVersion(), platform: process.platform };
});

// ───────────── Arranque ─────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    createWindow();
    // Actualizaciones del programa (si falla, sigue funcionando igual).
    try {
      const { autoUpdater } = require('electron-updater');
      autoUpdater.autoDownload = true;
      void autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
    } catch { /* sin actualizador */ }
  });
  app.on('window-all-closed', () => app.quit());
}
