/**
 * Live Cast — Express server entry point
 *
 * Serves the web UI and REST API for Chromecast device discovery,
 * stream casting (yt-dlp → VLC pipeline), and preset/history management.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

const castManager = require('./services/castManager');
const historyStore = require('./services/historyStore');

const app = express();
const PORT = process.env.PORT || 3000;
const VLC_PATH = '/Applications/VLC.app/Contents/MacOS/VLC';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost'],
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware (query string redacted to prevent credential leaks)
app.use((req, res, next) => {
  const safePath = req.path + (Object.keys(req.query).length ? '?...' : '');
  castManager.appendLog('System', `Incoming HTTP Request: ${req.method} ${safePath} from ${req.ip}`);
  next();
});

// ── System Dependency Cache (checked once at startup) ─────────────────────────
const systemStatus = { ytdlp: false, catt: false, vlc: false, atvremote: false };

try {
  execSync('which yt-dlp', { stdio: 'ignore' });
  systemStatus.ytdlp = true;
} catch (e) { /* yt-dlp not found */ }

try {
  execSync('which catt', { stdio: 'ignore' });
  systemStatus.catt = true;
} catch (e) { /* catt not found */ }

try {
  execSync('which atvremote', { stdio: 'ignore' });
  systemStatus.atvremote = true;
} catch (e) { /* atvremote not found */ }

if (fs.existsSync(VLC_PATH)) {
  systemStatus.vlc = true;
}

console.log('System dependency check:', JSON.stringify(systemStatus));

// ── Routes ────────────────────────────────────────────────────────────────────

// GET: System dependency status (cached from startup)
app.get('/api/status', (_req, res) => {
  res.json(systemStatus);
});

// POST: Store custom headers and return a single-use token (prevents credential leaks in URLs)
app.post('/api/headers', (req, res) => {
  const { headers } = req.body;
  if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) {
    return res.status(400).json({ success: false, error: 'Headers must be a plain object.' });
  }
  const token = castManager.storeHeaders(headers || {});
  res.json({ success: true, token });
});

// ── Device scan cache (prevents duplicate process spawns) ──────────────────────
const SCAN_CACHE_TTL_MS = 30_000; // 30 seconds
let scanCache = { data: null, timestamp: 0, inProgress: false };

// Helper functions for scanning devices
function runChromecastScan() {
  return new Promise((resolve) => {
    if (!systemStatus.catt) {
      return resolve([]);
    }

    const catt = spawn('catt', ['scan']);
    let stdoutData = '';

    const timeout = setTimeout(() => {
      catt.kill('SIGKILL');
    }, 20000); // Scan up to 20s

    catt.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    catt.on('close', () => {
      clearTimeout(timeout);
      const devices = [];
      const lines = stdoutData.split('\n');
      const regex = /^\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*-\s*([^-]+)(?:\s*-\s*(.+))?$/;

      lines.forEach((line) => {
        const match = line.match(regex);
        if (match) {
          devices.push({
            ip: match[1].trim(),
            name: match[2].trim(),
            info: match[3] ? match[3].trim() : 'Chromecast Device',
            type: 'chromecast',
          });
        }
      });
      resolve(devices);
    });

    catt.on('error', () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

function parseAtvremoteScan(stdout) {
  const devices = [];
  const lines = stdout.split('\n');
  let currentDevice = null;

  lines.forEach((line) => {
    const nameMatch = line.match(/^\s*Name:\s*(.+)$/i);
    const modelMatch = line.match(/^\s*Model\/SW:\s*(.+)$/i);
    const addressMatch = line.match(/^\s*Address:\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
    const idMatch = line.match(/^\s*-\s*(.+)$/);

    if (nameMatch) {
      if (currentDevice && currentDevice.ip && currentDevice.name) {
        devices.push(currentDevice);
      }
      currentDevice = {
        name: nameMatch[1].trim(),
        ip: '',
        id: '',
        info: 'AirPlay Device',
        type: 'airplay',
      };
    } else if (modelMatch && currentDevice) {
      currentDevice.info = `${modelMatch[1].trim()} (AirPlay)`;
    } else if (addressMatch && currentDevice) {
      currentDevice.ip = addressMatch[1].trim();
    } else if (idMatch && currentDevice && !currentDevice.id) {
      currentDevice.id = idMatch[1].trim();
    }
  });

  if (currentDevice && currentDevice.ip && currentDevice.name) {
    devices.push(currentDevice);
  }

  return devices;
}

function runAirPlayScan() {
  return new Promise((resolve) => {
    if (!systemStatus.atvremote) {
      return resolve([]);
    }

    const atv = spawn('atvremote', ['scan']);
    let stdoutData = '';

    const timeout = setTimeout(() => {
      atv.kill('SIGKILL');
    }, 20000); // Scan up to 20s

    atv.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    atv.on('close', () => {
      clearTimeout(timeout);
      const devices = parseAtvremoteScan(stdoutData);
      resolve(devices);
    });

    atv.on('error', () => {
      clearTimeout(timeout);
      resolve([]);
    });
  });
}

// GET: Discover devices (Chromecast and AirPlay) — cached for 30s
app.get('/api/devices', async (req, res) => {
  // Return cached result if fresh
  const now = Date.now();
  if (scanCache.data && (now - scanCache.timestamp) < SCAN_CACHE_TTL_MS) {
    return res.json(scanCache.data);
  }

  // Prevent concurrent scans
  if (scanCache.inProgress) {
    // Return stale cache if available, otherwise wait
    if (scanCache.data) {
      return res.json(scanCache.data);
    }
    return res.status(503).json({ success: false, error: 'Scan already in progress. Please retry.' });
  }

  scanCache.inProgress = true;
  try {
    const [chromecasts, airplays] = await Promise.all([
      runChromecastScan(),
      runAirPlayScan(),
    ]);

    const allDevices = [...chromecasts, ...airplays];

    scanCache.data = { success: true, devices: allDevices };
    scanCache.timestamp = Date.now();

    res.json(scanCache.data);
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err.message,
    });
  } finally {
    scanCache.inProgress = false;
  }
});

// POST: Start casting a stream to a selected device (Chromecast/AirPlay)
app.post('/api/cast', async (req, res) => {
  const { url, ip, headers, deviceType, deviceId } = req.body;

  if (!url || !ip) {
    return res.status(400).json({
      success: false,
      error: 'URL and device IP are required.',
    });
  }

  if (deviceType && deviceType !== 'chromecast' && deviceType !== 'airplay') {
    return res.status(400).json({
      success: false,
      error: 'Invalid device type. Supported: chromecast, airplay',
    });
  }

  // Validate headers is a plain object (prevent prototype pollution / deep nesting)
  if (headers !== undefined && (typeof headers !== 'object' || headers === null || Array.isArray(headers))) {
    return res.status(400).json({
      success: false,
      error: 'Headers must be a plain object of key-value pairs.',
    });
  }

  // Validate each header key and value are strings
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Header keys and values must be strings.',
        });
      }
      if (key.length > 256 || value.length > 4096) {
        return res.status(400).json({
          success: false,
          error: `Header "${key}" exceeds maximum length.`,
        });
      }
    }
  }

  // Validate URL length
  if (url.length > 4096) {
    return res.status(400).json({
      success: false,
      error: 'URL exceeds maximum length of 4096 characters.',
    });
  }

  const result = await castManager.startCast(url, ip, headers, deviceType || 'chromecast', deviceId || '');

  if (!result.success) {
    return res.status(400).json(result);
  }

  res.json({
    success: true,
    message: 'Casting started',
    status: 'casting',
  });
});

// POST: Stop the active casting session
app.post('/api/cast/stop', (_req, res) => {
  castManager.stopCasting('User requested stop');
  res.json({ success: true, message: 'Casting stopped' });
});

// GET: Current casting session status & logs
app.get('/api/cast/status', (req, res) => {
  const since = parseInt(req.query.since, 10) || 0;
  res.json(castManager.getSessionStatus(since));
});

// GET: Local stream proxy for AirPlay
app.get(['/api/stream', '/api/stream.m3u8', '/api/stream.mp4', '/api/stream.ts'], (req, res) => {
  const { url, token } = req.query;

  if (!url) {
    return res.status(400).send('URL query parameter is required.');
  }

  // Validate URL length
  if (url.length > 4096) {
    return res.status(400).send('URL exceeds maximum length of 4096 characters.');
  }

  // Validate URL scheme to prevent SSRF (only http/https allowed)
  if (!castManager.isValidURL(url)) {
    return res.status(400).send('Invalid URL. Only http/https URLs are supported.');
  }

  // Retrieve headers from token store (secure, single-use)
  let parsedHeaders = {};
  if (token) {
    const stored = castManager.retrieveHeaders(token);
    if (stored) {
      parsedHeaders = stored;
    }
    // If token not found (expired/used), proceed with no headers
  }

  // Build yt-dlp arguments
  const ytdlpArgs = [];
  const headerKeys = [];
  if (parsedHeaders && typeof parsedHeaders === 'object') {
    Object.entries(parsedHeaders).forEach(([key, value]) => {
      if (key.trim() && value.trim()) {
        ytdlpArgs.push('--add-header', `${key.trim()}: ${value.trim()}`);
        headerKeys.push(key.trim());
      }
    });
  }
  ytdlpArgs.push('-o', '-', url);

  castManager.appendLog('System', `Stream Proxy: Spawning yt-dlp for ${url} with headers: ${headerKeys.join(', ') || 'none'}`);

  try {
    const ytdlpProc = spawn('yt-dlp', ytdlpArgs);
    castManager.registerProxyProc(ytdlpProc);

    if (url.includes('m3u8')) {
      res.setHeader('Content-Type', 'video/mp2t');
    } else {
      res.setHeader('Content-Type', 'video/mp4');
    }

    // Pipe yt-dlp stdout directly to Express response
    ytdlpProc.stdout.pipe(res);

    // Capture stderr logs
    ytdlpProc.stderr.on('data', (data) => {
      castManager.appendLog('yt-dlp-proxy', data);
    });

    // Handle process exits
    ytdlpProc.on('exit', (code, signal) => {
      castManager.appendLog('yt-dlp-proxy', `Process exited with code ${code} and signal ${signal}`);
    });

    // Handle connection close (Apple TV disconnects or stops playing)
    req.on('close', () => {
      castManager.appendLog('System', `Stream Proxy: Client disconnected. Killing proxy yt-dlp process.`);
      ytdlpProc.kill('SIGKILL');
    });

    ytdlpProc.on('error', (err) => {
      castManager.appendLog('yt-dlp-proxy-error', err.message);
      if (!res.headersSent) {
        res.status(500).send(`Streaming error: ${err.message}`);
      }
    });
  } catch (err) {
    castManager.appendLog('System-Error', `Failed to start stream proxy: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).send(`Failed to start stream proxy: ${err.message}`);
    }
  }
});

// ── History CRUD ──────────────────────────────────────────────────────────────

// GET: All saved presets
app.get('/api/history', async (_req, res) => {
  try {
    const items = await historyStore.getAll();
    res.json(items);
  } catch (err) {
    console.error('Failed to read history:', err);
    res.status(500).json({ success: false, error: 'Failed to read history.' });
  }
});

// POST: Add a new preset
app.post('/api/history', async (req, res) => {
  const { name, url, headers } = req.body;

  if (!name || !url) {
    return res.status(400).json({ success: false, error: 'Name and URL are required.' });
  }

  if (typeof name !== 'string' || typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'Name and URL must be strings.' });
  }

  if (name.length > 256 || url.length > 4096) {
    return res.status(400).json({ success: false, error: 'Name or URL exceeds maximum length.' });
  }

  try {
    const item = await historyStore.add({ name, url, headers });
    res.status(201).json(item);
  } catch (err) {
    console.error('Failed to add history:', err);
    res.status(500).json({ success: false, error: 'Failed to save preset.' });
  }
});

// PUT: Update an existing preset
app.put('/api/history/:id', async (req, res) => {
  const { id } = req.params;
  const { name, url, headers } = req.body;

  if (name !== undefined && typeof name !== 'string') {
    return res.status(400).json({ success: false, error: 'Name must be a string.' });
  }
  if (url !== undefined && typeof url !== 'string') {
    return res.status(400).json({ success: false, error: 'URL must be a string.' });
  }

  try {
    const updated = await historyStore.update(id, { name, url, headers });
    if (!updated) {
      return res.status(404).json({ success: false, error: 'History item not found.' });
    }
    res.json(updated);
  } catch (err) {
    console.error('Failed to update history:', err);
    res.status(500).json({ success: false, error: 'Failed to update preset.' });
  }
});

// DELETE: Remove a preset
app.delete('/api/history/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const deleted = await historyStore.remove(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'History item not found.' });
    }
    res.json({ success: true, message: 'History item deleted.' });
  } catch (err) {
    console.error('Failed to delete history:', err);
    res.status(500).json({ success: false, error: 'Failed to delete preset.' });
  }
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('SIGINT received, cleaning up...');
  castManager.shutdown();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, cleaning up...');
  castManager.shutdown();
  process.exit();
});

// Note: process.on('exit') removed — child processes are already dying during
// the exit phase; SIGINT/SIGTERM handlers above are sufficient for cleanup.

// ── Start Server ──────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Live Cast server running at http://localhost:${PORT}`);
});
