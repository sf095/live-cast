/**
 * Cast Session Manager
 *
 * Manages the lifecycle of yt-dlp → VLC streaming pipeline:
 * - Spawn and pipe yt-dlp stdout into VLC stdin
 * - Capture logs from both processes
 * - Graceful process termination with timeout cleanup
 */

const { spawn } = require('child_process');
const path = require('path');

const VLC_PATH = '/Applications/VLC.app/Contents/MacOS/VLC';
const LOG_CAP = 1000;

// IP address validation regex
const IP_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidIP(ip) {
  const match = ip.match(IP_REGEX);
  if (!match) return false;
  return match.slice(1).every(octet => {
    const n = parseInt(octet, 10);
    return n >= 0 && n <= 255;
  });
}

function isValidURL(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

let activeSession = {
  ytdlpProc: null,
  vlcProc: null,
  exitTimeoutId: null,
  url: null,
  ip: null,
  headers: null,
  status: 'idle', // 'idle' | 'casting' | 'error'
  logs: [],
  startTime: null,
};

function appendLog(source, data) {
  const lines = data.toString().split('\n');
  lines.forEach((line) => {
    if (line.trim()) {
      const timestamp = new Date().toLocaleTimeString();
      activeSession.logs.push(`[${timestamp}] [${source}] ${line}`);
    }
  });
  if (activeSession.logs.length > LOG_CAP) {
    activeSession.logs = activeSession.logs.slice(activeSession.logs.length - LOG_CAP);
  }
}

function appendLogSafe(source, message) {
  appendLog(source, message);
}

/**
 * Stop any active casting session and kill child processes.
 * @param {string} reason - Why the session is being stopped
 */
function stopCasting(reason = 'cleanup') {
  const ytRunning =
    activeSession.ytdlpProc && activeSession.ytdlpProc.exitCode === null;
  const vlcRunning =
    activeSession.vlcProc && activeSession.vlcProc.exitCode === null;

  if (activeSession.status === 'idle' && !ytRunning && !vlcRunning) {
    return;
  }

  appendLog('System', `Stopping cast session. Reason: ${reason}`);

  // Clear any pending exit timeout
  if (activeSession.exitTimeoutId) {
    clearTimeout(activeSession.exitTimeoutId);
    activeSession.exitTimeoutId = null;
  }

  if (activeSession.ytdlpProc) {
    try {
      activeSession.ytdlpProc.kill('SIGKILL');
    } catch (e) {
      // Process may already be dead
    }
    activeSession.ytdlpProc = null;
  }

  if (activeSession.vlcProc) {
    try {
      activeSession.vlcProc.kill('SIGKILL');
    } catch (e) {
      // Process may already be dead
    }
    activeSession.vlcProc = null;
  }

  activeSession.status = 'idle';
}

/**
 * Start a new casting session.
 * Stops any existing session first.
 *
 * @param {string} url - Stream URL (must be http/https)
 * @param {string} ip - Chromecast IP address
 * @param {object} headers - Custom HTTP headers for yt-dlp
 * @returns {{ success: boolean, error?: string }}
 */
function startCast(url, ip, headers) {
  // Validate inputs
  if (!url || !ip) {
    return { success: false, error: 'URL and Chromecast IP are required.' };
  }

  if (!isValidIP(ip)) {
    return { success: false, error: 'Invalid IP address format.' };
  }

  if (!isValidURL(url)) {
    return { success: false, error: 'Invalid URL. Only http/https URLs are supported.' };
  }

  // Stop any active session first
  stopCasting();

  activeSession = {
    ytdlpProc: null,
    vlcProc: null,
    exitTimeoutId: null,
    url,
    ip,
    headers,
    status: 'casting',
    logs: [],
    startTime: new Date(),
  };

  appendLog('System', `Initiating cast to ${ip}`);
  appendLog('System', `Source URL: ${url}`);

  // Build yt-dlp arguments
  const ytdlpArgs = [];
  const headerKeys = [];
  if (headers && typeof headers === 'object') {
    Object.entries(headers).forEach(([key, value]) => {
      if (key.trim() && value.trim()) {
        ytdlpArgs.push('--add-header', `${key.trim()}: ${value.trim()}`);
        headerKeys.push(key.trim());
      }
    });
  }
  ytdlpArgs.push('-o', '-', url);

  // Log only header keys, not values (security: prevent secret leakage)
  appendLog(
    'System',
    `Spawning yt-dlp with URL and ${headerKeys.length} custom header(s): ${headerKeys.join(', ') || 'none'}`
  );

  const vlcArgs = ['-', `--sout=#chromecast{ip=${ip}}`, '--demux-filter=demux_chromecast'];

  try {
    activeSession.ytdlpProc = spawn('yt-dlp', ytdlpArgs);
    activeSession.vlcProc = spawn(VLC_PATH, vlcArgs);

    // Pipe yt-dlp stdout into VLC stdin
    activeSession.ytdlpProc.stdout.pipe(activeSession.vlcProc.stdin);

    // Capture stderr logs
    activeSession.ytdlpProc.stderr.on('data', (data) => appendLog('yt-dlp', data));
    activeSession.vlcProc.stderr.on('data', (data) => appendLog('VLC', data));

    // Handle yt-dlp exit
    activeSession.ytdlpProc.on('exit', (code, signal) => {
      appendLog('yt-dlp', `Process exited with code ${code} and signal ${signal}`);
      if (activeSession.status === 'casting') {
        // Give VLC a short window to buffer remaining data, then stop
        activeSession.exitTimeoutId = setTimeout(() => {
          if (activeSession.status === 'casting') {
            stopCasting('yt-dlp exit');
          }
        }, 2000);
      }
    });

    // Handle VLC exit
    activeSession.vlcProc.on('exit', (code, signal) => {
      appendLog('VLC', `Process exited with code ${code} and signal ${signal}`);
      if (activeSession.status === 'casting') {
        stopCasting('VLC exit');
      }
    });

    // Handle spawn errors
    activeSession.ytdlpProc.on('error', (err) => {
      appendLog('yt-dlp-error', err.message);
      activeSession.status = 'error';
    });

    activeSession.vlcProc.on('error', (err) => {
      appendLog('VLC-error', err.message);
      activeSession.status = 'error';
    });

    return { success: true };
  } catch (err) {
    appendLog('System-Error', err.message);
    activeSession.status = 'error';
    return { success: false, error: err.message };
  }
}

/**
 * Get current session status for the API.
 */
function getSessionStatus() {
  return {
    status: activeSession.status,
    url: activeSession.url,
    ip: activeSession.ip,
    startTime: activeSession.startTime,
    logs: activeSession.logs,
  };
}

/**
 * Cleanup all processes on server shutdown.
 */
function shutdown() {
  stopCasting('Server shutdown');
}

module.exports = {
  startCast,
  stopCasting,
  getSessionStatus,
  appendLog: appendLogSafe,
  shutdown,
  isValidIP,
  isValidURL,
};
