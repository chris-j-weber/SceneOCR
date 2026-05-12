const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  backendPort:      () => ipcRenderer.sendSync('get-backend-port'),
  getBackendStatus: () => ipcRenderer.sendSync('get-backend-status'),
  onBackendLog:     (cb) => ipcRenderer.on('backend-log', (_e, line) => cb(line)),
  onBackendReady:   (cb) => ipcRenderer.once('backend-ready', () => cb()),
  onBackendError:   (cb) => ipcRenderer.once('backend-error', (_e, msg) => cb(msg)),
  offBackendLog:    ()   => ipcRenderer.removeAllListeners('backend-log'),
})
