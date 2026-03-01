const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const { Bonjour } = require('bonjour-service');

// ─── Globals ────────────────────────────────────────────────────────────────

let mainWindow = null;
let tray = null;
let ws = null;
let bonjour = null;
let discoveredDevices = [];
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_INTERVAL_MS = 3000;
let currentDeviceUrl = null;
let intentionalClose = false;
const iconPath = path.join(__dirname, 'icon.ico');

// Latest stats for tray tooltip and notification
let latestStats = { state: 'idle', voltage: 0, current: 0, capacity: 0, energy: 0, elapsed: 0 };
let previousTrayState = 'idle';

// ─── Test History ───────────────────────────────────────────────────────────

function getTestsDir() {
  const dir = path.join(app.getPath('userData'), 'tests');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveTestResult(testData) {
  const dir = getTestsDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `test_${timestamp}.json`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, JSON.stringify(testData, null, 2), 'utf-8');
  return filepath;
}

function loadTestHistory() {
  const dir = getTestsDir();
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().reverse();
  const tests = [];
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      data._filename = file;
      tests.push(data);
    } catch (e) {
      // skip corrupt files
    }
  }
  return tests;
}

function loadTestByFilename(filename) {
  const filepath = path.join(getTestsDir(), filename);
  if (!fs.existsSync(filepath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function deleteTestByFilename(filename) {
  const filepath = path.join(getTestsDir(), filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    return true;
  }
  return false;
}

// ─── WebSocket Connection ───────────────────────────────────────────────────

function connectToDevice(url) {
  disconnectFromDevice();
  intentionalClose = false;
  currentDeviceUrl = url;
  reconnectAttempts = 0;

  _createWebSocket(url);
}

function _createWebSocket(url) {
  if (ws) {
    try { ws.terminate(); } catch (e) { /* ignore */ }
    ws = null;
  }

  ws = new WebSocket(url);

  ws.on('open', () => {
    reconnectAttempts = 0;
    clearReconnectTimer();
    send('ws-status', { connected: true, url, reconnecting: false });
    // Request initial status
    ws.send(JSON.stringify({ cmd: 'status' }));
  });

  ws.on('message', (data) => {
    try {
      const parsed = JSON.parse(data.toString());
      send('ws-message', parsed);
      handleStatsUpdate(parsed);
    } catch (e) {
      // ignore non-JSON
    }
  });

  ws.on('close', () => {
    ws = null;
    if (!intentionalClose && currentDeviceUrl) {
      send('ws-status', { connected: false, url: currentDeviceUrl, reconnecting: true });
      scheduleReconnect();
    } else {
      send('ws-status', { connected: false, url: null, reconnecting: false });
    }
  });

  ws.on('error', (err) => {
    // error is followed by close, so reconnect logic is in close handler
  });
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    send('ws-status', { connected: false, url: currentDeviceUrl, reconnecting: false, gaveUp: true });
    currentDeviceUrl = null;
    return;
  }
  clearReconnectTimer();
  reconnectAttempts++;
  send('ws-reconnect-attempt', { attempt: reconnectAttempts, max: MAX_RECONNECT_ATTEMPTS });
  reconnectTimer = setTimeout(() => {
    if (currentDeviceUrl) {
      _createWebSocket(currentDeviceUrl);
    }
  }, RECONNECT_INTERVAL_MS);
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function disconnectFromDevice() {
  intentionalClose = true;
  clearReconnectTimer();
  currentDeviceUrl = null;
  reconnectAttempts = 0;
  if (ws) {
    try { ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  }
  send('ws-status', { connected: false, url: null, reconnecting: false });
}

function sendCommand(cmd) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ cmd }));
  }
}

// ─── mDNS Discovery ─────────────────────────────────────────────────────────

function startDiscovery() {
  stopDiscovery();
  discoveredDevices = [];
  bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'batttest' });

  browser.on('up', (service) => {
    const device = {
      name: service.name || service.host,
      host: service.host,
      ip: service.addresses && service.addresses.length > 0
        ? service.addresses.find(a => a.includes('.')) || service.addresses[0]
        : service.host,
      port: service.port || 81,
    };
    // Avoid duplicates
    if (!discoveredDevices.find(d => d.ip === device.ip && d.port === device.port)) {
      discoveredDevices.push(device);
      send('device-found', device);
    }
  });

  browser.on('down', (service) => {
    const ip = service.addresses && service.addresses.find(a => a.includes('.'));
    discoveredDevices = discoveredDevices.filter(d => d.ip !== ip);
    send('device-lost', { ip });
  });
}

function stopDiscovery() {
  if (bonjour) {
    try { bonjour.destroy(); } catch (e) { /* ignore */ }
    bonjour = null;
  }
  discoveredDevices = [];
}

// ─── Stats Tracking & Tray ──────────────────────────────────────────────────

function handleStatsUpdate(msg) {
  const newState = msg.state || 'idle';
  latestStats = {
    state: newState,
    voltage: msg.voltage || 0,
    current: msg.current || 0,
    capacity: msg.capacity || 0,
    energy: msg.energy || 0,
    elapsed: msg.elapsed || 0,
  };

  // Detect test completion — notify if window is hidden
  if (newState === 'complete' && previousTrayState === 'running') {
    if (mainWindow === null || !mainWindow.isVisible()) {
      showTestCompleteNotification(latestStats);
    }
  }
  previousTrayState = newState;

  updateTrayTooltip();
}

function formatTrayTime(ms) {
  const sec = Math.floor(ms / 1000) % 60;
  const min = Math.floor(ms / 60000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function updateTrayTooltip() {
  if (!tray) return;
  const s = latestStats;
  const lines = [
    `Battery Tester — ${s.state.toUpperCase()}`,
    `${s.voltage.toFixed(3)}V  ${s.current.toFixed(1)}mA`,
    `${s.capacity.toFixed(1)} mAh  ${s.energy.toFixed(1)} mWh`,
  ];
  if (s.state === 'running') {
    lines.push(`Elapsed: ${formatTrayTime(s.elapsed)}`);
  }
  tray.setToolTip(lines.join('\n'));
}

function showTestCompleteNotification(stats) {
  if (!Notification.isSupported()) return;
  const notif = new Notification({
    title: 'Battery Test Complete',
    body: `Capacity: ${stats.capacity.toFixed(1)} mAh\nEnergy: ${stats.energy.toFixed(1)} mWh\nTime: ${formatTrayTime(stats.elapsed)}`,
    icon: iconPath,
  });
  notif.on('click', () => {
    showWindow();
  });
  notif.show();
}

function createTray() {
  tray = new Tray(iconPath);
  tray.setToolTip('Battery Tester');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => showWindow(),
    },
    { type: 'separator' },
    {
      label: 'Start Test',
      click: () => sendCommand('start'),
    },
    {
      label: 'Stop Test',
      click: () => sendCommand('stop'),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        tray = null;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

// ─── IPC Handlers ───────────────────────────────────────────────────────────

function setupIPC() {
  ipcMain.handle('connect', (_, url) => {
    connectToDevice(url);
  });

  ipcMain.handle('disconnect', () => {
    disconnectFromDevice();
  });

  ipcMain.handle('send-command', (_, cmd) => {
    sendCommand(cmd);
  });

  ipcMain.handle('start-discovery', () => {
    startDiscovery();
    return discoveredDevices;
  });

  ipcMain.handle('stop-discovery', () => {
    stopDiscovery();
  });

  ipcMain.handle('get-devices', () => {
    return discoveredDevices;
  });

  ipcMain.handle('save-test', (_, testData) => {
    return saveTestResult(testData);
  });

  ipcMain.handle('load-history', () => {
    return loadTestHistory();
  });

  ipcMain.handle('load-test', (_, filename) => {
    return loadTestByFilename(filename);
  });

  ipcMain.handle('delete-test', (_, filename) => {
    return deleteTestByFilename(filename);
  });

  ipcMain.handle('show-save-dialog', async (_, options) => {
    return dialog.showSaveDialog(mainWindow, options);
  });

  ipcMain.handle('write-file', async (_, filePath, content) => {
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  });

  ipcMain.handle('show-confirm-dialog', async (_, options) => {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Cancel', 'Continue'],
      defaultId: 0,
      title: options.title || 'Confirm',
      message: options.message || 'Are you sure?',
    });
    return result.response === 1;
  });
}

// ─── Helper to send to renderer ─────────────────────────────────────────────

function send(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── Window ─────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#111111',
    title: 'Battery Tester',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  // Minimize to tray on close instead of quitting
  mainWindow.on('close', (e) => {
    if (tray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(() => {
  setupIPC();
  createTray();
  createWindow();
  startDiscovery();

  app.on('activate', () => {
    showWindow();
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  disconnectFromDevice();
  stopDiscovery();
});

app.on('window-all-closed', () => {
  // Don't quit — tray keeps the app alive
});
