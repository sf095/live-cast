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
const http = require('http');
const crypto = require('crypto');

const VLC_PATH = '/Applications/VLC.app/Contents/MacOS/VLC';
const LOG_CAP = 1000;
const SERVER_PORT = process.env.PORT || 3000;

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
  deviceType: 'chromecast', // 'chromecast' | 'airplay'
  deviceId: '', // Unique identifier for atvremote
  status: 'idle', // 'idle' | 'casting' | 'error'
  logs: [],
  startTime: null,
};

let activeProxyProcs = [];

// Secure header token store — headers are stored server-side
// and retrieved by token, never passed in query strings
const headerTokenStore = new Map();
const HEADER_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

function storeHeaders(headers) {
  const token = crypto.randomBytes(16).toString('hex');
  headerTokenStore.set(token, { headers, createdAt: Date.now() });
  // Auto-expire stale tokens
  setTimeout(() => headerTokenStore.delete(token), HEADER_TOKEN_TTL_MS);
  return token;
}

function retrieveHeaders(token) {
  const entry = headerTokenStore.get(token);
  if (!entry) return null;
  headerTokenStore.delete(token); // single-use
  return entry.headers;
}

function registerProxyProc(proc) {
  activeProxyProcs.push(proc);
  proc.on('close', () => {
    activeProxyProcs = activeProxyProcs.filter(p => p !== proc);
  });
}

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

  // Send stop command to Apple TV if it is an AirPlay cast
  if (activeSession.deviceType === 'airplay' && activeSession.ip) {
    appendLog('AirPlay', `Sending stop command to Apple TV at ${activeSession.ip}`);
    const playScript = path.join(__dirname, 'playAirplay.py');
    const stopProc = spawn('python3', [playScript, 'stop', activeSession.ip], {
      timeout: 10000, // 10s timeout
    });
    stopProc.on('error', (err) => {
      appendLog('AirPlay-Error', `Stop command failed: ${err.message}`);
    });
    stopProc.on('exit', (code) => {
      if (code !== 0) {
        appendLog('AirPlay-Error', `Stop command exited with code ${code}`);
      }
    });
  }

  // Kill active proxy streams
  activeProxyProcs.forEach((p) => {
    try {
      p.kill('SIGKILL');
    } catch (e) { /* process already dead */ }
  });
  activeProxyProcs = [];

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
 * Cast to a DLNA/UPnP-compatible smart TV via SOAP.
 * @param {string} ip - TV IP address
 * @param {string} proxyUrl - Local proxy stream URL
 * @param {boolean} isHls - Whether the source is an HLS stream
 * @returns {boolean} true on success
 * @throws on DLNA SOAP failure
 */
async function castViaDLNA(ip, proxyUrl, isHls) {
  // Send a Stop command first to clear any locked state
  const stopBody = `<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <InstanceID>0</InstanceID>
  </u:Stop>`;
  await sendDlnaSOAP(ip, 'Stop', stopBody).catch(() => {});

  // Build valid DIDL-Lite metadata for strict TVs
  const mimeType = isHls ? 'video/mp2t' : 'video/mp4';
  const title = 'Live Cast Stream';
  const didlXml = `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
    <item id="0" parentID="-1" restricted="1">
      <dc:title>${title}</dc:title>
      <upnp:class>object.item.videoItem</upnp:class>
      <res protocolInfo="http-get:*:${mimeType}:*">${proxyUrl}</res>
    </item>
  </DIDL-Lite>`;

  const escapedProxyUrl = proxyUrl
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  const escapedDidl = didlXml
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const setUriBody = `<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <InstanceID>0</InstanceID>
    <CurrentURI>${escapedProxyUrl}</CurrentURI>
    <CurrentURIMetaData>${escapedDidl}</CurrentURIMetaData>
  </u:SetAVTransportURI>`;
  const res1 = await sendDlnaSOAP(ip, 'SetAVTransportURI', setUriBody);
  appendLog('System', `DLNA SetAVTransportURI Response: ${res1.statusCode}`);

  const playBody = `<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
    <InstanceID>0</InstanceID>
    <Speed>1</Speed>
  </u:Play>`;
  const res2 = await sendDlnaSOAP(ip, 'Play', playBody);
  appendLog('System', `DLNA Play Response: ${res2.statusCode}`);

  // Mock a dummy vlcProc to represent the DLNA session active state
  const EventEmitter = require('events');
  activeSession.vlcProc = new EventEmitter();
  activeSession.vlcProc.kill = () => {
    appendLog('System', `Sending DLNA stop command to TV at ${ip}`);
    const stopBody = `<u:Stop xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:Stop>`;
    sendDlnaSOAP(ip, 'Stop', stopBody).catch(() => {});
  };

  activeSession.status = 'casting';
  return true;
}

/**
 * Cast to an AirPlay receiver via pyatv/playAirplay.py.
 * @param {string} ip - Apple TV IP address
 * @param {string} proxyUrl - Local proxy stream URL
 * @returns {{ success: boolean, error?: string }}
 */
function castViaAirPlay(ip, proxyUrl) {
  const playScript = path.join(__dirname, 'playAirplay.py');
  const args = [playScript, 'play', ip, proxyUrl];

  try {
    activeSession.vlcProc = spawn('python3', args);

    activeSession.vlcProc.stdout.on('data', (data) => appendLog('AirPlay', data));
    activeSession.vlcProc.stderr.on('data', (data) => {
      appendLog('AirPlay-Error', data);
      // Detect auth errors inline (rather than in generic appendLog)
      const line = data.toString();
      if (line.includes('not authenticated') || line.includes('AuthenticationError')) {
        const ts = new Date().toLocaleTimeString();
        appendLog('System', `⚠️ PAIRING REQUIRED: This Apple TV / AirPlay receiver requires authentication.`);
        appendLog('System', `Open a Terminal window on your Mac and run:`);
        appendLog('System', `  atvremote --id "${activeSession.deviceId}" --protocol airplay pair`);
        appendLog('System', `Enter the passcode shown on your TV screen. After pairing, try casting again!`);
      }
    });

    activeSession.vlcProc.on('exit', (code, signal) => {
      appendLog('AirPlay', `atvremote process exited with code ${code} and signal ${signal}`);
      if (code !== 0 && activeSession.status === 'casting') {
        appendLog('System', '⚠️ Direct casting is not supported by this TV. Streaming remains active for Local Player Preview.');
      }
    });

    activeSession.vlcProc.on('error', (err) => {
      appendLog('AirPlay-Error', err.message);
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
 * Probe whether a device supports DLNA UPnP.
 * @param {string} ip - Device IP address
 * @returns {Promise<boolean>}
 */
function checkDLNASupport(ip) {
  return new Promise((resolve) => {
    const req = http.get(`http://${ip}:18400/MediaServer/rendererdevicedesc.xml`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Start a new casting session.
 * Stops any existing session first.
 *
 * @param {string} url - Stream URL (must be http/https)
 * @param {string} ip - Device IP address
 * @param {object} headers - Custom HTTP headers for yt-dlp
 * @param {string} deviceType - Device type ('chromecast' | 'airplay')
 * @param {string} deviceId - Unique device identifier for atvremote (optional)
 * @returns {{ success: boolean, error?: string }}
 */
async function startCast(url, ip, headers, deviceType = 'chromecast', deviceId = '') {
  // Validate inputs
  if (!url || !ip) {
    return { success: false, error: 'URL and IP are required.' };
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
    deviceType,
    deviceId,
    status: 'casting',
    logs: [],
    startTime: new Date(),
  };

  appendLog('System', `Initiating cast to ${ip} (${deviceType})`);
  appendLog('System', `Source URL: ${url}`);

  // ── AirPlay / DLNA path ──────────────────────────────────────────────
  if (deviceType === 'airplay') {
    const { getLocalIPv4 } = require('./networkUtils');
    const localIp = getLocalIPv4();
    const encodedUrl = encodeURIComponent(url);

    // Store headers server-side with a single-use token (never in query string)
    const headerToken = storeHeaders(headers || {});

    const isHls = url.includes('m3u8');
    const proxyPath = isHls ? '/api/stream.m3u8' : '/api/stream.mp4';
    const proxyUrl = `http://${localIp}:${SERVER_PORT}${proxyPath}?url=${encodedUrl}&token=${headerToken}`;

    appendLog('AirPlay', `Local stream proxy URL: ${proxyUrl}`);

    // Try DLNA first, fall back to AirPlay on failure
    const supportsDlna = await checkDLNASupport(ip);
    if (supportsDlna) {
      appendLog('System', `DLNA UPnP detected at ${ip}. Trying DLNA cast...`);
      try {
        await castViaDLNA(ip, proxyUrl, isHls);
        return { success: true };
      } catch (err) {
        appendLog('System-Error', `DLNA cast failed: ${err.message}. Falling back to AirPlay.`);
      }
    }

    appendLog('AirPlay', `Spawning playAirplay.py to cast stream...`);
    return castViaAirPlay(ip, proxyUrl);
  }

  // ── Chromecast / VLC path ────────────────────────────────────────────

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
 * @param {number} [sinceIndex] - Only return logs after this index (0-based)
 */
function getSessionStatus(sinceIndex = 0) {
  const logs = sinceIndex > 0
    ? activeSession.logs.slice(sinceIndex)
    : activeSession.logs;
  return {
    status: activeSession.status,
    url: activeSession.url,
    ip: activeSession.ip,
    startTime: activeSession.startTime,
    logs,
    logCount: activeSession.logs.length,
    headers: activeSession.headers,
  };
}

/**
 * Cleanup all processes on server shutdown.
 */
function shutdown() {
  stopCasting('Server shutdown');
}

function sendDlnaSOAP(ip, action, body) {
  return new Promise((resolve, reject) => {
    const postData = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>${body}</s:Body>
</s:Envelope>`;

    const options = {
      hostname: ip,
      port: 18400,
      path: '/upnp/control/mingusavtr',
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(postData),
        'SOAPACTION': `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', (e) => reject(e));
    req.write(postData);
    req.end();
  });
}

module.exports = {
  startCast,
  stopCasting,
  getSessionStatus,
  appendLog: appendLogSafe,
  shutdown,
  isValidIP,
  isValidURL,
  registerProxyProc,
  storeHeaders,
  retrieveHeaders,
};
