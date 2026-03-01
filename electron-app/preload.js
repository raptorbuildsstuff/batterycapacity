const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('batttest', {
  // WebSocket / connection
  connect: (url) => ipcRenderer.invoke('connect', url),
  disconnect: () => ipcRenderer.invoke('disconnect'),
  sendCommand: (cmd) => ipcRenderer.invoke('send-command', cmd),

  // mDNS discovery
  startDiscovery: () => ipcRenderer.invoke('start-discovery'),
  stopDiscovery: () => ipcRenderer.invoke('stop-discovery'),
  getDevices: () => ipcRenderer.invoke('get-devices'),

  // Test history
  saveTest: (data) => ipcRenderer.invoke('save-test', data),
  loadHistory: () => ipcRenderer.invoke('load-history'),
  loadTest: (filename) => ipcRenderer.invoke('load-test', filename),
  deleteTest: (filename) => ipcRenderer.invoke('delete-test', filename),

  // File I/O
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),

  // Dialogs
  showSaveDialog: (opts) => ipcRenderer.invoke('show-save-dialog', opts),
  showConfirmDialog: (opts) => ipcRenderer.invoke('show-confirm-dialog', opts),

  // Event listeners
  onWsMessage: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('ws-message', handler);
    return () => ipcRenderer.removeListener('ws-message', handler);
  },
  onWsStatus: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('ws-status', handler);
    return () => ipcRenderer.removeListener('ws-status', handler);
  },
  onDeviceFound: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('device-found', handler);
    return () => ipcRenderer.removeListener('device-found', handler);
  },
  onDeviceLost: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('device-lost', handler);
    return () => ipcRenderer.removeListener('device-lost', handler);
  },
  onReconnectAttempt: (cb) => {
    const handler = (_, data) => cb(data);
    ipcRenderer.on('ws-reconnect-attempt', handler);
    return () => ipcRenderer.removeListener('ws-reconnect-attempt', handler);
  },
});
