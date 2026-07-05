/**
 * Live Cast — Frontend Application
 *
 * Manages Chromecast device discovery, stream casting controls,
 * custom HTTP header configuration, live log terminal, and history presets.
 */

// ── App State ─────────────────────────────────────────────────────────────────

const state = {
  devices: [],
  history: [],
  castStatus: 'idle',
  logCount: 0,
  autoScroll: true,
  pollTimer: null,
  isScanning: false,
};

// ── DOM References ────────────────────────────────────────────────────────────

const el = {
  deps: {
    ytdlp: document.getElementById('dep-ytdlp'),
    catt: document.getElementById('dep-catt'),
    vlc: document.getElementById('dep-vlc'),
  },

  controls: {
    deviceSelect: document.getElementById('device-select'),
    btnScan: document.getElementById('btn-scan'),
    scanIcon: document.getElementById('scan-icon'),
    streamUrl: document.getElementById('stream-url'),
    headersList: document.getElementById('headers-list'),
    btnAddHeader: document.getElementById('btn-add-header'),
    savePresetCheckbox: document.getElementById('save-preset-checkbox'),
    btnCast: document.getElementById('btn-cast'),
    btnStop: document.getElementById('btn-stop'),
  },

  status: {
    label: document.getElementById('cast-status-label'),
    ip: document.getElementById('cast-ip-label'),
    activeUrl: document.getElementById('active-url-display'),
  },

  history: {
    list: document.getElementById('history-list'),
    btnCreate: document.getElementById('btn-create-preset'),
  },

  terminal: {
    body: document.getElementById('terminal-body'),
    btnClear: document.getElementById('btn-clear-logs'),
    btnAutoscroll: document.getElementById('btn-toggle-autoscroll'),
  },

  modal: {
    overlay: document.getElementById('preset-modal'),
    form: document.getElementById('preset-form'),
    title: document.getElementById('modal-title'),
    idInput: document.getElementById('preset-id'),
    nameInput: document.getElementById('preset-name'),
    urlInput: document.getElementById('preset-url'),
    headersList: document.getElementById('modal-headers-list'),
    btnAddHeader: document.getElementById('btn-modal-add-header'),
    btnClose: document.getElementById('btn-close-modal'),
    btnCancel: document.getElementById('btn-cancel-modal'),
  },
};

// ── Toast Notifications ───────────────────────────────────────────────────────

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const iconMap = { success: 'check-circle', error: 'alert-triangle', warning: 'alert-circle', info: 'info' };
  const iconName = iconMap[type] || 'info';

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i data-lucide="${iconName}" style="width: 18px; height: 18px; flex-shrink: 0;"></i>
    <span style="flex-grow: 1;">${message}</span>
  `;

  container.appendChild(toast);
  refreshIcons(toast);

  setTimeout(() => {
    toast.classList.add('fadeOut');
    toast.addEventListener('transitionend', () => toast.remove());
  }, 3500);
}

// ── Icon Refresh (scoped to a subtree) ────────────────────────────────────────

function refreshIcons(scope = document) {
  // Lucide handles re-scanning — passing a node constrains the scope
  if (scope === document) {
    lucide.createIcons();
  } else {
    // Re-render icons within the given subtree
    const icons = scope.querySelectorAll('[data-lucide]');
    icons.forEach((el) => {
      const name = el.getAttribute('data-lucide');
      if (name) {
        lucide.createIcons({ icons: { [name]: lucide.icons[name] } });
      }
    });
    // Fallback: full scan is safe for small scopes
    lucide.createIcons();
  }
}

// ── Skeleton Loader ──────────────────────────────────────────────────────────

function renderHistorySkeletons() {
  el.history.list.innerHTML = `
    <div class="skeleton-list">
      <div class="skeleton-item" aria-hidden="true"></div>
      <div class="skeleton-item" aria-hidden="true"></div>
      <div class="skeleton-item" aria-hidden="true"></div>
    </div>
  `;
}

// ── Dependency Status ─────────────────────────────────────────────────────────

async function checkSystemStatus() {
  try {
    const res = await fetch('/api/status');
    const status = await res.json();
    updateBadge(el.deps.ytdlp, status.ytdlp);
    updateBadge(el.deps.catt, status.catt);
    updateBadge(el.deps.vlc, status.vlc);
  } catch (err) {
    console.error('Failed to get system dependency status:', err);
  }
}

function updateBadge(element, isOk) {
  element.classList.toggle('active', isOk);
  element.classList.toggle('inactive', !isOk);
}

// ── Device Discovery ──────────────────────────────────────────────────────────

async function scanDevices() {
  if (state.isScanning) return;

  state.isScanning = true;
  el.controls.btnScan.disabled = true;
  el.controls.scanIcon.classList.add('spinner');

  el.controls.deviceSelect.innerHTML = '<option value="" disabled selected>Scanning for Chromecasts...</option>';
  appendSystemLog('Scanning for Chromecasts via catt scan...');

  try {
    const res = await fetch('/api/devices');
    const data = await res.json();

    if (data.success) {
      state.devices = data.devices;
      populateDeviceSelect();
      appendSystemLog(`Scan complete. Found ${data.devices.length} device(s).`);
      const msg = data.devices.length > 0
        ? `Discovered ${data.devices.length} Chromecast device(s)`
        : 'No Chromecast devices found.';
      showToast(msg, data.devices.length > 0 ? 'success' : 'info');
    } else {
      appendErrorLog(`Scan failed: ${data.error || 'Unknown error'}`);
      showToast('Device scan failed.', 'error');
      populateDeviceSelect();
    }
  } catch (err) {
    appendErrorLog('Scan failed: Connection error.');
    showToast('Network error scanning devices.', 'error');
    populateDeviceSelect();
  } finally {
    state.isScanning = false;
    el.controls.btnScan.disabled = false;
    el.controls.scanIcon.classList.remove('spinner');
  }
}

function populateDeviceSelect() {
  const currentVal = el.controls.deviceSelect.value;
  el.controls.deviceSelect.innerHTML = '<option value="" disabled selected>Select a device...</option>';

  if (state.devices.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No Chromecasts found';
    option.disabled = true;
    el.controls.deviceSelect.appendChild(option);
    return;
  }

  state.devices.forEach((dev) => {
    const option = document.createElement('option');
    option.value = dev.ip;
    option.textContent = `${dev.name} (${dev.ip})`;
    el.controls.deviceSelect.appendChild(option);
  });

  if (currentVal && state.devices.some((d) => d.ip === currentVal)) {
    el.controls.deviceSelect.value = currentVal;
  }
}

// ── Custom Headers Manager ────────────────────────────────────────────────────

function addHeaderRow(container, key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'header-row';

  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.placeholder = 'Header-Name (e.g. Referer)';
  keyInput.value = key;
  keyInput.required = true;

  const valInput = document.createElement('input');
  valInput.type = 'text';
  valInput.placeholder = 'Value';
  valInput.value = value;
  valInput.required = true;

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'btn-icon';
  removeBtn.setAttribute('aria-label', 'Remove custom header');
  removeBtn.innerHTML = '<i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(removeBtn);

  container.appendChild(row);
  refreshIcons(container);
}

function serializeHeaders(container) {
  const headers = {};
  container.querySelectorAll('.header-row').forEach((row) => {
    const inputs = row.querySelectorAll('input');
    const key = inputs[0].value.trim();
    const val = inputs[1].value.trim();
    if (key && val) headers[key] = val;
  });
  return headers;
}

function renderHeaders(container, headersObj) {
  container.innerHTML = '';
  if (!headersObj) return;
  Object.entries(headersObj).forEach(([key, val]) => addHeaderRow(container, key, val));
}

// ── Casting Controls ──────────────────────────────────────────────────────────

async function handleCastStart() {
  const url = el.controls.streamUrl.value.trim();
  const ip = el.controls.deviceSelect.value;

  if (!ip) {
    showToast('Please select a Chromecast device first.', 'warning');
    return;
  }
  if (!url) {
    showToast('Please enter a stream URL.', 'warning');
    return;
  }

  const headers = serializeHeaders(el.controls.headersList);

  el.controls.btnCast.disabled = true;
  el.controls.btnCast.innerHTML = '<span class="spinner"></span> Casting...';

  try {
    const res = await fetch('/api/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, ip, headers }),
    });
    const data = await res.json();

    if (data.success) {
      state.castStatus = 'casting';
      state.logCount = 0;
      el.controls.btnStop.disabled = false;
      startStatusPolling();

      if (el.controls.savePresetCheckbox.checked) {
        saveUrlToHistory(url, headers);
      }
    } else {
      appendErrorLog(`Casting failed to start: ${data.error}`);
      showToast(`Cast failed: ${data.error}`, 'error');
      resetCastButtons();
    }
  } catch (err) {
    appendErrorLog('Casting failed: Server connection error.');
    showToast('Server connection error.', 'error');
    resetCastButtons();
  }
}

async function handleCastStop() {
  try {
    const res = await fetch('/api/cast/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      appendSystemLog('Casting session stopped.');
      state.castStatus = 'idle';
      resetCastButtons();
      stopStatusPolling();
    }
  } catch (err) {
    console.error('Failed to stop casting:', err);
  }
}

function resetCastButtons() {
  el.controls.btnCast.disabled = false;
  el.controls.btnCast.innerHTML = '<i data-lucide="play-circle"></i> Start Cast';
  el.controls.btnStop.disabled = true;
  refreshIcons(el.controls.btnCast);
}

// ── Status Polling (only while casting) ───────────────────────────────────────

function startStatusPolling() {
  stopStatusPolling(); // Clear any existing timer

  state.pollTimer = setInterval(async () => {
    try {
      const res = await fetch('/api/cast/status');
      const data = await res.json();
      updateSessionStatusUI(data);

      // Stop polling if session ended server-side
      if (data.status !== 'casting') {
        stopStatusPolling();
        resetCastButtons();
      }
    } catch (e) {
      console.error('Status poll error:', e);
    }
  }, 1500);
}

function stopStatusPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function updateSessionStatusUI(session) {
  state.castStatus = session.status;

  el.status.label.textContent = session.status.toUpperCase();
  el.status.label.className = `status-value ${session.status}`;
  el.status.ip.textContent = session.ip || '-';
  el.status.activeUrl.value = session.url || '-';

  if (session.status === 'casting') {
    el.controls.btnCast.disabled = true;
    el.controls.btnCast.innerHTML = '<span class="spinner"></span> Casting...';
    el.controls.btnStop.disabled = false;

    if (!el.controls.streamUrl.value.trim()) {
      el.controls.streamUrl.value = session.url;
    }
  } else {
    resetCastButtons();
  }

  // Render only new log lines
  if (session.logs && session.logs.length > state.logCount) {
    const newLogs = session.logs.slice(state.logCount);
    state.logCount = session.logs.length;
    appendLogsToTerminal(newLogs);
  }
}

// ── Terminal Log Rendering ────────────────────────────────────────────────────

function appendLogsToTerminal(logLines) {
  const frag = document.createDocumentFragment();

  logLines.forEach((line) => {
    const logEl = document.createElement('div');
    logEl.className = 'log-line';

    if (line.includes('[System]')) logEl.classList.add('log-system');
    else if (line.includes('[yt-dlp]') || line.includes('[yt-dlp-error]')) logEl.classList.add('log-ytdlp');
    else if (line.includes('[VLC]') || line.includes('[VLC-error]')) logEl.classList.add('log-vlc');
    else if (line.includes('Error') || line.includes('error') || line.includes('[System-Error]')) logEl.classList.add('log-error');

    logEl.textContent = line;
    frag.appendChild(logEl);
  });

  el.terminal.body.appendChild(frag);

  if (state.autoScroll) {
    el.terminal.body.scrollTop = el.terminal.body.scrollHeight;
  }
}

function appendSystemLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  appendLogsToTerminal([`[${timestamp}] [System] ${message}`]);
}

function appendErrorLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  appendLogsToTerminal([`[${timestamp}] [Error] ${message}`]);
}

function clearTerminal() {
  el.terminal.body.innerHTML = '<div class="log-line log-system">[System] Console cleared.</div>';
  state.logCount = 0;
}

function toggleAutoscroll() {
  state.autoScroll = !state.autoScroll;
  el.terminal.btnAutoscroll.classList.toggle('active', state.autoScroll);
  el.terminal.btnAutoscroll.innerHTML = state.autoScroll
    ? '<i data-lucide="check" class="icon-sm"></i> Auto Scroll'
    : '<i data-lucide="x" class="icon-sm"></i> Manual Scroll';
  refreshIcons(el.terminal.btnAutoscroll);
}

// ── History Presets ──────────────────────────────────────────────────────────

async function fetchHistory() {
  renderHistorySkeletons();
  try {
    const res = await fetch('/api/history');
    state.history = await res.json();
    renderHistoryList();
  } catch (err) {
    console.error('Failed to fetch history presets:', err);
    el.history.list.innerHTML = '<div class="empty-state">Failed to load presets.</div>';
  }
}

function renderHistoryList() {
  el.history.list.innerHTML = '';

  if (state.history.length === 0) {
    el.history.list.innerHTML = '<div class="empty-state">No presets saved yet.</div>';
    return;
  }

  const frag = document.createDocumentFragment();

  state.history.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'history-item';

    const meta = document.createElement('div');
    meta.className = 'history-meta';

    const name = document.createElement('div');
    name.className = 'history-name';
    name.textContent = item.name;

    const url = document.createElement('div');
    url.className = 'history-url';
    url.textContent = item.url;

    meta.appendChild(name);
    meta.appendChild(url);

    const actions = document.createElement('div');
    actions.className = 'history-actions';

    // Quick-load and Cast
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn-history-play';
    playBtn.setAttribute('aria-label', `Cast preset ${item.name}`);
    playBtn.innerHTML = '<i data-lucide="play"></i> Cast';
    playBtn.addEventListener('click', () => {
      el.controls.streamUrl.value = item.url;
      renderHeaders(el.controls.headersList, item.headers);
      el.controls.savePresetCheckbox.checked = false;
      el.controls.streamUrl.scrollIntoView({ behavior: 'smooth' });
      if (el.controls.deviceSelect.value) {
        handleCastStart();
      } else {
        appendSystemLog(`Loaded preset "${item.name}". Select a device and start casting.`);
        showToast(`Loaded preset: ${item.name}`, 'info');
      }
    });

    // Edit
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-icon';
    editBtn.setAttribute('aria-label', `Edit preset ${item.name}`);
    editBtn.innerHTML = '<i data-lucide="edit-2"></i>';
    editBtn.addEventListener('click', () => openPresetModal(item));

    // Delete
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn-icon';
    deleteBtn.setAttribute('aria-label', `Delete preset ${item.name}`);
    deleteBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    deleteBtn.addEventListener('click', () => deletePreset(item.id));

    actions.appendChild(playBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(meta);
    card.appendChild(actions);
    frag.appendChild(card);
  });

  el.history.list.appendChild(frag);
  refreshIcons(el.history.list);
}

async function saveUrlToHistory(url, headers) {
  if (state.history.some((item) => item.url === url)) {
    showToast('URL already exists in presets.', 'info');
    return;
  }

  const name = `Stream - ${new Date().toLocaleDateString()}`;
  try {
    const res = await fetch('/api/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, url, headers }),
    });
    if (res.ok) {
      await fetchHistory();
    }
  } catch (err) {
    console.error('Failed to auto-save preset:', err);
  }
}

// ── Preset Modal ──────────────────────────────────────────────────────────────

function openPresetModal(item = null) {
  if (item) {
    el.modal.title.textContent = 'Edit Stream Preset';
    el.modal.idInput.value = item.id;
    el.modal.nameInput.value = item.name;
    el.modal.urlInput.value = item.url;
    renderHeaders(el.modal.headersList, item.headers);
  } else {
    el.modal.title.textContent = 'Add Stream Preset';
    el.modal.idInput.value = '';
    el.modal.nameInput.value = '';
    el.modal.urlInput.value = '';
    el.modal.headersList.innerHTML = '';
  }
  el.modal.overlay.classList.add('open');
}

function closePresetModal() {
  el.modal.overlay.classList.remove('open');
}

async function savePreset() {
  const id = el.modal.idInput.value;
  const name = el.modal.nameInput.value.trim();
  const url = el.modal.urlInput.value.trim();
  const headers = serializeHeaders(el.modal.headersList);

  try {
    let res;
    if (id) {
      res = await fetch(`/api/history/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, headers }),
      });
    } else {
      res = await fetch('/api/history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, headers }),
      });
    }

    if (res.ok) {
      closePresetModal();
      await fetchHistory();
      appendSystemLog(`Preset "${name}" saved successfully.`);
      showToast(`Preset "${name}" saved!`, 'success');
    } else {
      const errData = await res.json();
      showToast(`Failed to save preset: ${errData.error}`, 'error');
    }
  } catch (err) {
    console.error('Failed to save preset:', err);
    showToast('Server error saving preset.', 'error');
  }
}

async function deletePreset(id) {
  if (!confirm('Are you sure you want to delete this preset?')) return;

  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await fetchHistory();
      appendSystemLog('Preset deleted.');
      showToast('Preset deleted.', 'success');
    } else {
      showToast('Failed to delete preset.', 'error');
    }
  } catch (err) {
    console.error('Failed to delete preset:', err);
    showToast('Error deleting preset.', 'error');
  }
}

// ── Initialization ────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkSystemStatus();
  fetchHistory();
  scanDevices();

  // Event listeners
  el.controls.btnScan.addEventListener('click', scanDevices);
  el.controls.btnAddHeader.addEventListener('click', () => addHeaderRow(el.controls.headersList));
  el.modal.btnAddHeader.addEventListener('click', () => addHeaderRow(el.modal.headersList));
  el.controls.btnCast.addEventListener('click', handleCastStart);
  el.controls.btnStop.addEventListener('click', handleCastStop);
  el.terminal.btnClear.addEventListener('click', clearTerminal);
  el.terminal.btnAutoscroll.addEventListener('click', toggleAutoscroll);

  // Modal events
  el.history.btnCreate.addEventListener('click', () => openPresetModal());
  el.modal.btnClose.addEventListener('click', closePresetModal);
  el.modal.btnCancel.addEventListener('click', closePresetModal);
  el.modal.form.addEventListener('submit', savePreset);
});
