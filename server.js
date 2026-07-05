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

// ── System Dependency Cache (checked once at startup) ─────────────────────────
const systemStatus = { ytdlp: false, catt: false, vlc: false };

try {
  execSync('which yt-dlp', { stdio: 'ignore' });
  systemStatus.ytdlp = true;
} catch (e) { /* yt-dlp not found */ }

try {
  execSync('which catt', { stdio: 'ignore' });
  systemStatus.catt = true;
} catch (e) { /* catt not found */ }

if (fs.existsSync(VLC_PATH)) {
  systemStatus.vlc = true;
}

console.log('System dependency check:', JSON.stringify(systemStatus));

// ── Routes ────────────────────────────────────────────────────────────────────

// GET: System dependency status (cached from startup)
app.get('/api/status', (_req, res) => {
  res.json(systemStatus);
});

// GET: Discover Chromecast devices via catt scan
app.get('/api/devices', (req, res) => {
  const catt = spawn('catt', ['scan']);
  let stdoutData = '';
  let stderrData = '';

  // Timeout: kill catt if scan takes longer than 30 seconds
  const scanTimeout = setTimeout(() => {
    catt.kill('SIGKILL');
    if (!res.headersSent) {
      res.status(504).json({
        success: false,
        error: 'Device scan timed out after 30 seconds.',
      });
    }
  }, 30000);

  catt.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  catt.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  catt.on('close', (code) => {
    clearTimeout(scanTimeout);
    if (res.headersSent) return;

    const devices = [];
    const lines = stdoutData.split('\n');

    // Pattern: "IP - Name - Info" or "IP - Name"
    const regex = /^\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*-\s*([^-]+)(?:\s*-\s*(.+))?$/;

    lines.forEach((line) => {
      const match = line.match(regex);
      if (match) {
        devices.push({
          ip: match[1].trim(),
          name: match[2].trim(),
          info: match[3] ? match[3].trim() : 'Unknown Device',
        });
      }
    });

    res.json({
      success: true,
      devices,
      rawOutput: stdoutData,
      exitCode: code,
    });
  });

  catt.on('error', (err) => {
    clearTimeout(scanTimeout);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: err.message,
      });
    }
  });
});

// POST: Start casting a stream to a selected Chromecast
app.post('/api/cast', (req, res) => {
  const { url, ip, headers } = req.body;

  if (!url || !ip) {
    return res.status(400).json({
      success: false,
      error: 'URL and Chromecast IP are required.',
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

  const result = castManager.startCast(url, ip, headers);

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
app.get('/api/cast/status', (_req, res) => {
  res.json(castManager.getSessionStatus());
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
