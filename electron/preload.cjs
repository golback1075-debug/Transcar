const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  notify: (title, body) => ipcRenderer.send('transcar:notify', { title, body }),
  printToPdf: (filename) => ipcRenderer.invoke('transcar:print-to-pdf', filename),
  printCurrent: () => ipcRenderer.send('transcar:print-current'),
});
