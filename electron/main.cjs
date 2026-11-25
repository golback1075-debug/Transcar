const { app, BrowserWindow, ipcMain, Notification, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const SERVER_URL = process.env.TRANSCAR_SERVER_URL || 'http://127.0.0.1:3000';
let mainWindow = null;
let embeddedServerProcess = null;

function startEmbeddedBackendIfNeeded() {
  if (process.env.TRANSCAR_REMOTE_ONLY === 'true') {
    return;
  }
  const serverEntry = path.resolve(__dirname, '..', 'server.ts');
  if (fs.existsSync(serverEntry)) {
    embeddedServerProcess = spawn(process.execPath, [serverEntry], {
      env: { ...process.env, NODE_ENV: 'production', PORT: '3000' },
      stdio: 'ignore',
      detached: false,
    });
  }
}

function createWindow() {
  const iconPath = path.resolve(__dirname, 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: 'TRANSCAR — Gestion de Location Automobile (Blida)',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    autoHideMenuBar: true,
    backgroundColor: '#FBF8FC',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startEmbeddedBackendIfNeeded();
  setTimeout(createWindow, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (embeddedServerProcess) {
    embeddedServerProcess.kill();
    embeddedServerProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('transcar:notify', (_event, payload) => {
  if (Notification.isSupported() && payload?.title) {
    new Notification({
      title: String(payload.title),
      body: String(payload.body || ''),
      icon: path.resolve(__dirname, 'icon.png'),
    }).show();
  }
});

ipcMain.on('transcar:print-current', () => {
  if (mainWindow) {
    mainWindow.webContents.print({ silent: false, printBackground: true });
  }
});

ipcMain.handle('transcar:print-to-pdf', async (_event, suggestedFilename) => {
  if (!mainWindow) return { ok: false };
  const safeName = String(suggestedFilename || 'TRANSCAR-Document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: 'Document PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false };

  const pdfBuffer = await mainWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    landscape: false,
    preferCSSPageSize: true,
  });
  fs.writeFileSync(filePath, pdfBuffer);
  return { ok: true, filePath };
});
