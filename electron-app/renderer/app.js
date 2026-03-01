/* ─── Battery Tester — Renderer App ──────────────────────────────────────── */
/* global Chart, batttest */

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  connected: false,
  testState: 'idle', // idle | running | complete | error
  dataPoints: [],    // { time, voltage, current }
  lastMessage: null,
  hasUnsavedData: false,
  testSaved: false,
  startVoltage: null,
  historyOverlays: [], // loaded historical datasets
};

// ─── DOM References ─────────────────────────────────────────────────────────

const dom = {
  connectionStatus: document.getElementById('connection-status'),
  reconnectInfo: document.getElementById('reconnect-info'),
  mVoltage: document.getElementById('m-voltage'),
  mCurrent: document.getElementById('m-current'),
  mPower: document.getElementById('m-power'),
  mCapacity: document.getElementById('m-capacity'),
  mEnergy: document.getElementById('m-energy'),
  mIntR: document.getElementById('m-intr'),
  mElapsed: document.getElementById('m-elapsed'),
  mState: document.getElementById('m-state'),
  gradeOverlay: document.getElementById('grade-overlay'),
  gradeLetter: document.getElementById('grade-letter'),
  gradeLabel: document.getElementById('grade-label'),
  btnStart: document.getElementById('btn-start'),
  btnStop: document.getElementById('btn-stop'),
  btnReset: document.getElementById('btn-reset'),
  btnExport: document.getElementById('btn-export'),
  btnHistory: document.getElementById('btn-history'),
  btnConnectDialog: document.getElementById('btn-connect-dialog'),
  historyPanel: document.getElementById('history-panel'),
  historyList: document.getElementById('history-list'),
  btnCloseHistory: document.getElementById('btn-close-history'),
  connectDialog: document.getElementById('connect-dialog'),
  discoveredDevices: document.getElementById('discovered-devices'),
  inputIp: document.getElementById('input-ip'),
  inputPort: document.getElementById('input-port'),
  btnManualConnect: document.getElementById('btn-manual-connect'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  btnCloseDialog: document.getElementById('btn-close-dialog'),
  chartCanvas: document.getElementById('discharge-chart'),
  inputRated: document.getElementById('input-rated'),
};

// ─── Chart Setup ────────────────────────────────────────────────────────────

const chartColors = {
  voltage: '#ffb400',
  current: '#4488ff',
  history: [
    'rgba(255, 180, 0, 0.35)',
    'rgba(68, 136, 255, 0.35)',
    'rgba(68, 255, 102, 0.35)',
    'rgba(255, 68, 68, 0.35)',
  ],
};

const chart = new Chart(dom.chartCanvas, {
  type: 'line',
  data: {
    datasets: [
      {
        label: 'Voltage (V)',
        data: [],
        borderColor: chartColors.voltage,
        backgroundColor: 'rgba(255, 180, 0, 0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
        yAxisID: 'yVoltage',
      },
      {
        label: 'Current (mA)',
        data: [],
        borderColor: chartColors.current,
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 1.5,
        yAxisID: 'yCurrent',
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: {
      mode: 'index',
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        labels: {
          color: '#888888',
          font: { family: "'JetBrains Mono', monospace", size: 10 },
          boxWidth: 12,
          padding: 12,
        },
      },
      tooltip: {
        backgroundColor: '#1a1a1a',
        titleColor: '#e0e0e0',
        bodyColor: '#e0e0e0',
        borderColor: '#333333',
        borderWidth: 1,
        titleFont: { family: "'JetBrains Mono', monospace", size: 10 },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 10 },
        callbacks: {
          title: (items) => {
            if (items.length > 0) {
              const sec = items[0].parsed.x;
              return formatTime(sec * 1000);
            }
            return '';
          },
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        title: {
          display: true,
          text: 'Time (min)',
          color: '#555555',
          font: { family: "'JetBrains Mono', monospace", size: 10 },
        },
        ticks: {
          color: '#555555',
          font: { family: "'JetBrains Mono', monospace", size: 9 },
          callback: (val) => (val / 60).toFixed(0),
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      yVoltage: {
        type: 'linear',
        position: 'left',
        title: {
          display: true,
          text: 'Voltage (V)',
          color: chartColors.voltage,
          font: { family: "'JetBrains Mono', monospace", size: 10 },
        },
        ticks: {
          color: chartColors.voltage,
          font: { family: "'JetBrains Mono', monospace", size: 9 },
          callback: (val) => val.toFixed(1),
        },
        grid: { color: 'rgba(255,255,255,0.04)' },
        min: 2.5,
        max: 4.5,
      },
      yCurrent: {
        type: 'linear',
        position: 'right',
        title: {
          display: true,
          text: 'Current (mA)',
          color: chartColors.current,
          font: { family: "'JetBrains Mono', monospace", size: 10 },
        },
        ticks: {
          color: chartColors.current,
          font: { family: "'JetBrains Mono', monospace", size: 9 },
        },
        grid: { drawOnChartArea: false },
        min: 0,
      },
    },
  },
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function gradeForCapacity(mAh) {
  if (mAh >= 700) return { letter: 'A', label: 'Excellent', class: 'grade-a' };
  if (mAh >= 500) return { letter: 'B', label: 'Good', class: 'grade-b' };
  if (mAh >= 300) return { letter: 'C', label: 'Fair', class: 'grade-c' };
  return { letter: 'D', label: 'Poor', class: 'grade-d' };
}

function validateIp(ip) {
  // Accept IPv4 or hostname
  if (!ip || ip.trim().length === 0) return false;
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  const hostname = /^[a-zA-Z0-9][a-zA-Z0-9\-.]*$/;
  if (ipv4.test(ip)) {
    return ip.split('.').every(p => { const n = parseInt(p); return n >= 0 && n <= 255; });
  }
  return hostname.test(ip);
}

// ─── UI Updates ─────────────────────────────────────────────────────────────

function updateMetrics(msg) {
  dom.mVoltage.textContent = msg.voltage != null ? msg.voltage.toFixed(3) : '-.---';
  dom.mCurrent.textContent = msg.current != null ? msg.current.toFixed(1) : '---.-';
  dom.mPower.textContent = msg.power != null ? msg.power.toFixed(1) : '----.-';
  dom.mCapacity.textContent = msg.capacity != null ? msg.capacity.toFixed(1) : '---.-';
  dom.mEnergy.textContent = msg.energy != null ? msg.energy.toFixed(1) : '---.-';
  dom.mIntR.textContent = msg.intR != null ? msg.intR.toFixed(1) : '--.-';
  dom.mElapsed.textContent = msg.elapsed != null ? formatTime(msg.elapsed) : '--:--';

  const stateText = (msg.state || 'idle').toUpperCase();
  dom.mState.textContent = stateText;
  dom.mState.className = 'metric-value state-value state-' + (msg.state || 'idle');
}

function updateButtonStates() {
  const s = state.testState;
  const c = state.connected;

  dom.btnStart.disabled = !(c && (s === 'idle' || s === 'complete' || s === 'error'));
  dom.btnStop.disabled = !(c && s === 'running');
  dom.btnReset.disabled = (s === 'running' || state.dataPoints.length === 0);
  dom.btnExport.disabled = (state.dataPoints.length === 0);

  // Show/hide start vs stop
  dom.btnStart.style.display = (s === 'running') ? 'none' : '';
  dom.btnStop.style.display = (s === 'running') ? '' : 'none';

  dom.btnDisconnect.disabled = !c;
}

function showGrade(capacity) {
  const grade = gradeForCapacity(capacity);
  dom.gradeOverlay.className = 'grade-overlay ' + grade.class;
  dom.gradeLetter.textContent = grade.letter;

  const rated = parseInt(dom.inputRated.value) || 0;
  let labelText = grade.label + ' (' + capacity.toFixed(0) + ' mAh)';
  if (rated > 0) {
    const health = ((capacity / rated) * 100).toFixed(0);
    const loss = (rated - capacity).toFixed(0);
    labelText += `\n${health}% health | ${loss} mAh lost`;
  }
  dom.gradeLabel.textContent = labelText;

  // Re-trigger animation
  dom.gradeOverlay.style.animation = 'none';
  dom.gradeOverlay.offsetHeight; // force reflow
  dom.gradeOverlay.style.animation = '';
}

function hideGrade() {
  dom.gradeOverlay.className = 'grade-overlay hidden';
}

function updateConnectionStatus(info) {
  state.connected = info.connected;

  if (info.connected) {
    dom.connectionStatus.textContent = 'CONNECTED';
    dom.connectionStatus.className = 'status-badge connected';
    dom.reconnectInfo.textContent = '';
    dom.reconnectInfo.classList.add('hidden');
  } else if (info.reconnecting) {
    dom.connectionStatus.textContent = 'RECONNECTING';
    dom.connectionStatus.className = 'status-badge reconnecting';
    dom.reconnectInfo.classList.remove('hidden');
  } else if (info.gaveUp) {
    dom.connectionStatus.textContent = 'DISCONNECTED';
    dom.connectionStatus.className = 'status-badge disconnected';
    dom.reconnectInfo.textContent = 'Reconnection failed';
    dom.reconnectInfo.classList.remove('hidden');
  } else {
    dom.connectionStatus.textContent = 'DISCONNECTED';
    dom.connectionStatus.className = 'status-badge disconnected';
    dom.reconnectInfo.textContent = '';
    dom.reconnectInfo.classList.add('hidden');
  }

  updateButtonStates();
}

// ─── Chart Data ─────────────────────────────────────────────────────────────

function addDataPoint(msg) {
  if (msg.state !== 'running') return;

  const timeSec = (msg.elapsed || 0) / 1000;
  state.dataPoints.push({
    time: timeSec,
    voltage: msg.voltage,
    current: msg.current,
  });

  chart.data.datasets[0].data.push({ x: timeSec, y: msg.voltage });
  chart.data.datasets[1].data.push({ x: timeSec, y: msg.current });
  chart.update('none');
}

function clearChart() {
  state.dataPoints = [];
  chart.data.datasets[0].data = [];
  chart.data.datasets[1].data = [];

  // Remove history overlays
  while (chart.data.datasets.length > 2) {
    chart.data.datasets.pop();
  }
  state.historyOverlays = [];

  chart.update();
}

function overlayHistoricalTest(testData) {
  const idx = state.historyOverlays.length;
  const colorIdx = idx % chartColors.history.length;
  const color = chartColors.history[colorIdx];

  const dateStr = new Date(testData.timestamp).toLocaleDateString();
  const grade = gradeForCapacity(testData.capacity_mAh);

  const dataset = {
    label: `${dateStr} (${grade.letter}, ${testData.capacity_mAh.toFixed(0)} mAh)`,
    data: testData.data.map(d => ({ x: d.time, y: d.voltage })),
    borderColor: color,
    backgroundColor: 'transparent',
    fill: false,
    tension: 0.3,
    pointRadius: 0,
    borderWidth: 1.5,
    borderDash: [6, 3],
    yAxisID: 'yVoltage',
  };

  chart.data.datasets.push(dataset);
  state.historyOverlays.push(testData._filename);
  chart.update();
}

// ─── Test Completion ────────────────────────────────────────────────────────

let previousState = 'idle';

async function handleStateTransition(msg) {
  const newState = msg.state || 'idle';

  // Detect transition to "complete"
  if (newState === 'complete' && previousState === 'running') {
    showGrade(msg.capacity || 0);
    state.hasUnsavedData = false;
    state.testSaved = true;

    // Auto-save test result
    const rated = parseInt(dom.inputRated.value) || 0;
    const measuredCap = msg.capacity || 0;
    const testResult = {
      timestamp: new Date().toISOString(),
      capacity_mAh: measuredCap,
      energy_mWh: msg.energy || 0,
      internal_resistance_mOhm: msg.intR || 0,
      duration_s: (msg.elapsed || 0) / 1000,
      start_voltage: state.startVoltage || msg.voltage,
      end_voltage: msg.voltage || 0,
      cutoff_voltage: msg.cutoff || 2.8,
      grade: gradeForCapacity(measuredCap).letter,
      rated_capacity_mAh: rated > 0 ? rated : null,
      health_pct: rated > 0 ? Math.round((measuredCap / rated) * 100) : null,
      capacity_loss_mAh: rated > 0 ? Math.round(rated - measuredCap) : null,
      data: state.dataPoints.map(d => ({
        time: d.time,
        voltage: d.voltage,
        current: d.current,
      })),
    };

    try {
      await batttest.saveTest(testResult);
    } catch (e) {
      console.error('Failed to save test:', e);
    }
  }

  // Track start voltage on transition to running
  if (newState === 'running' && previousState !== 'running') {
    state.startVoltage = msg.voltage;
    state.hasUnsavedData = true;
    state.testSaved = false;
  }

  previousState = newState;
  state.testState = newState;
  updateButtonStates();
}

// ─── WebSocket Message Handler ──────────────────────────────────────────────

batttest.onWsMessage((msg) => {
  state.lastMessage = msg;
  updateMetrics(msg);
  addDataPoint(msg);
  handleStateTransition(msg);
});

batttest.onWsStatus((info) => {
  updateConnectionStatus(info);
});

batttest.onReconnectAttempt((info) => {
  dom.reconnectInfo.textContent = `Retry ${info.attempt}/${info.max}...`;
});

// ─── Device Discovery ───────────────────────────────────────────────────────

const knownDevices = new Map();

batttest.onDeviceFound((device) => {
  const key = `${device.ip}:${device.port}`;
  knownDevices.set(key, device);
  renderDeviceList();
});

batttest.onDeviceLost((info) => {
  for (const [key, dev] of knownDevices) {
    if (dev.ip === info.ip) {
      knownDevices.delete(key);
    }
  }
  renderDeviceList();
});

function renderDeviceList() {
  if (knownDevices.size === 0) {
    dom.discoveredDevices.innerHTML = '<p class="discovery-status">Searching for devices...</p>';
    return;
  }

  dom.discoveredDevices.innerHTML = '';
  for (const [, device] of knownDevices) {
    const div = document.createElement('div');
    div.className = 'device-item';
    div.innerHTML = `
      <div class="device-item-info">
        <div class="device-item-name">${escapeHtml(device.name)}</div>
        <div class="device-item-addr">${escapeHtml(device.ip)}:${device.port}</div>
      </div>
    `;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'CONNECT';
    btn.addEventListener('click', () => {
      batttest.connect(`ws://${device.ip}:${device.port}`);
      dom.connectDialog.classList.add('hidden');
    });
    div.appendChild(btn);
    dom.discoveredDevices.appendChild(div);
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── History Panel ──────────────────────────────────────────────────────────

async function loadHistoryPanel() {
  const tests = await batttest.loadHistory();
  if (!tests || tests.length === 0) {
    dom.historyList.innerHTML = '<p class="history-empty">No saved tests</p>';
    return;
  }

  dom.historyList.innerHTML = '';
  for (const test of tests) {
    const grade = gradeForCapacity(test.capacity_mAh);
    const date = new Date(test.timestamp);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-item-header">
        <span class="history-date">${escapeHtml(dateStr)}</span>
        <span class="history-grade ${grade.class}">${grade.letter}</span>
      </div>
      <div class="history-stats">
        <span>${test.capacity_mAh.toFixed(0)} mAh</span>
        <span>${test.energy_mWh.toFixed(0)} mWh</span>
        <span>${test.internal_resistance_mOhm.toFixed(0)} m\u03A9</span>
        <span>${formatTime(test.duration_s * 1000)}</span>
        ${test.health_pct != null ? `<span class="history-health">${test.health_pct}% health</span>` : ''}
      </div>
      <div class="history-actions"></div>
    `;

    const actions = div.querySelector('.history-actions');

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-primary';
    loadBtn.textContent = 'OVERLAY';
    loadBtn.addEventListener('click', async () => {
      const full = await batttest.loadTest(test._filename);
      if (full) overlayHistoricalTest(full);
    });
    actions.appendChild(loadBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = 'DELETE';
    delBtn.addEventListener('click', async () => {
      await batttest.deleteTest(test._filename);
      loadHistoryPanel();
    });
    actions.appendChild(delBtn);

    dom.historyList.appendChild(div);
  }
}

// ─── CSV Export ──────────────────────────────────────────────────────────────

async function exportCSV() {
  if (state.dataPoints.length === 0) return;

  const result = await batttest.showSaveDialog({
    title: 'Export Test Data',
    defaultPath: `battery_test_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });

  if (result.canceled || !result.filePath) return;

  let csv = 'Time (s),Voltage (V),Current (mA)\n';
  for (const dp of state.dataPoints) {
    csv += `${dp.time.toFixed(1)},${dp.voltage.toFixed(3)},${dp.current.toFixed(1)}\n`;
  }

  try {
    await batttest.writeFile(result.filePath, csv);
  } catch (e) {
    console.error('Failed to export:', e);
  }
}

// ─── Button Handlers ────────────────────────────────────────────────────────

dom.btnStart.addEventListener('click', async () => {
  // Confirm if there's unsaved data from a previous test
  if (state.dataPoints.length > 0 && !state.testSaved) {
    const confirmed = await batttest.showConfirmDialog({
      title: 'Start New Test',
      message: 'Previous test data has not been exported. Start a new test anyway?',
    });
    if (!confirmed) return;
  }
  clearChart();
  hideGrade();
  batttest.sendCommand('start');
});

dom.btnStop.addEventListener('click', () => {
  batttest.sendCommand('stop');
});

dom.btnReset.addEventListener('click', () => {
  clearChart();
  hideGrade();
  state.hasUnsavedData = false;
  state.testSaved = false;
  state.startVoltage = null;
  updateButtonStates();
  // Reset displayed metrics
  dom.mVoltage.textContent = '-.---';
  dom.mCurrent.textContent = '---.-';
  dom.mPower.textContent = '----.-';
  dom.mCapacity.textContent = '---.-';
  dom.mEnergy.textContent = '---.-';
  dom.mIntR.textContent = '--.-';
  dom.mElapsed.textContent = '--:--';
  dom.mState.textContent = 'IDLE';
  dom.mState.className = 'metric-value state-value state-idle';
});

dom.btnExport.addEventListener('click', () => {
  exportCSV();
});

// ─── History Panel Buttons ──────────────────────────────────────────────────

dom.btnHistory.addEventListener('click', () => {
  const isHidden = dom.historyPanel.classList.contains('hidden');
  if (isHidden) {
    dom.historyPanel.classList.remove('hidden');
    loadHistoryPanel();
  } else {
    dom.historyPanel.classList.add('hidden');
  }
});

dom.btnCloseHistory.addEventListener('click', () => {
  dom.historyPanel.classList.add('hidden');
});

// ─── Connect Dialog ─────────────────────────────────────────────────────────

dom.btnConnectDialog.addEventListener('click', () => {
  dom.connectDialog.classList.remove('hidden');
  batttest.startDiscovery();
});

dom.btnCloseDialog.addEventListener('click', () => {
  dom.connectDialog.classList.add('hidden');
});

dom.btnManualConnect.addEventListener('click', () => {
  const ip = dom.inputIp.value.trim();
  const port = parseInt(dom.inputPort.value) || 81;

  if (!validateIp(ip)) {
    dom.inputIp.classList.add('invalid');
    return;
  }
  dom.inputIp.classList.remove('invalid');

  batttest.connect(`ws://${ip}:${port}`);
  dom.connectDialog.classList.add('hidden');
});

dom.inputIp.addEventListener('input', () => {
  dom.inputIp.classList.remove('invalid');
});

dom.inputIp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    dom.btnManualConnect.click();
  }
});

dom.btnDisconnect.addEventListener('click', () => {
  batttest.disconnect();
});

// Close dialog on overlay click
dom.connectDialog.addEventListener('click', (e) => {
  if (e.target === dom.connectDialog) {
    dom.connectDialog.classList.add('hidden');
  }
});

// ─── Keyboard Shortcuts ─────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Don't trigger shortcuts when typing in inputs
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      if (state.testState === 'running') {
        dom.btnStop.click();
      } else if (!dom.btnStart.disabled) {
        dom.btnStart.click();
      }
      break;
    case 'KeyR':
      if (!dom.btnReset.disabled) {
        dom.btnReset.click();
      }
      break;
    case 'KeyE':
      if (!dom.btnExport.disabled) {
        dom.btnExport.click();
      }
      break;
    case 'KeyH':
      dom.btnHistory.click();
      break;
    case 'Escape':
      dom.connectDialog.classList.add('hidden');
      dom.historyPanel.classList.add('hidden');
      break;
  }
});

// ─── Initialization ─────────────────────────────────────────────────────────

updateButtonStates();
