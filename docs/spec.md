# Spec: Live Cast (URL to Chromecast caster)

## Objective
Build a local web application that allows users to scan for Chromecast devices, input streaming URLs (such as HLS streams), configure custom headers (like Referer), and cast them to a selected Chromecast using a local pipe command combining `yt-dlp` and `VLC`. The application will also maintain a history of casted streams with full CRUD capability (add, edit, delete).

### User Stories
- As a user, I want to scan my local network for Chromecast devices and select one to cast to.
- As a user, I want to input a stream URL and optional custom HTTP headers (such as `Referer`).
- As a user, I want to cast the stream to the selected Chromecast.
- As a user, I want to see the status of the casting process and stop casting at any time.
- As a user, I want to save casted URLs in a history list, edit their names/headers/URLs, and delete them.
- As a user, I want a modern, premium, dark-mode dashboard interface that is responsive and highly interactive.

---

## Tech Stack
- **Backend**: Node.js, Express
- **Frontend**: Vanilla HTML5, CSS3 (Modern dark-themed glassmorphism layout, smooth CSS transitions), Vanilla Javascript (ES6 modules)
- **Key Dependencies**:
  - `express`: Web server
  - `cors`: Cross-origin resource sharing
  - `dotenv`: Configuration management
- **System Utilities Required**:
  - `yt-dlp` (For fetching stream data)
  - `catt` (For scanning Chromecast devices)
  - `/Applications/VLC.app/Contents/MacOS/VLC` (For decoding and casting stream to Chromecast)

---

## Commands
- **Dev Server**: `npm run dev` (Starts backend server, default port `3000`)
- **Start**: `npm start`
- **Lint**: `npm run lint`

---

## Project Structure
```
live_cast/
├── package.json           # npm manifest and dependencies
├── server.js              # Express application entrypoint
├── spec.md                # System specification
├── data/
│   └── history.json       # JSON file storing cast history
└── public/
    ├── index.html         # Main dashboard markup
    ├── css/
    │   └── style.css      # Core styles & Design tokens
    └── js/
        └── app.js         # Frontend app logic & API integration
```

---

## REST API Endpoints
### 1. Chromecast Scanner
- `GET /api/devices`
  - Runs `catt scan` and returns JSON list of discovered devices.
  - Response: `[{ "ip": "192.168.31.105", "name": "FPT Play Box +", "info": "SDMC FPT Play Box +" }]`

### 2. Casting Sessions
- `POST /api/cast`
  - Body: `{ "url": "...", "ip": "...", "headers": { "Referer": "...", "User-Agent": "..." } }`
  - Spawns the command: `yt-dlp --add-header "Key: Value" -o - "url" | VLC - --sout="#chromecast{ip=ip}" --demux-filter=demux_chromecast`
  - Spawns asynchronously and keeps track of processes.
  - Response: `{ "status": "active", "sessionId": "session-123" }`
- `POST /api/cast/stop`
  - Stops any active casting session by killing spawned processes.
  - Response: `{ "status": "stopped" }`
- `GET /api/cast/status`
  - Gets the current casting status and process log output.
  - Response: `{ "status": "active" | "idle", "log": "..." }`

### 3. History Management (CRUD)
- `GET /api/history` - Returns list of saved streams.
- `POST /api/history` - Adds a new stream to history.
- `PUT /api/history/:id` - Updates an existing stream in history.
- `DELETE /api/history/:id` - Deletes a stream from history.

---

## Code Style
Clean, modular JavaScript with structured error handling.
Example backend process spawning:
```javascript
const { spawn } = require('child_process');

function startCastSession(url, ip, headers) {
  const headerArgs = [];
  Object.entries(headers).forEach(([key, val]) => {
    if (val) {
      headerArgs.push('--add-header', `${key}:${val}`);
    }
  });

  const ytdlp = spawn('yt-dlp', [...headerArgs, '-o', '-', url]);
  const vlc = spawn('/Applications/VLC.app/Contents/MacOS/VLC', [
    '-',
    `--sout=#chromecast{ip=${ip}}`,
    '--demux-filter=demux_chromecast'
  ]);

  ytdlp.stdout.pipe(vlc.stdin);
  
  // Track and handle process lifecycles
}
```

---

## Testing Strategy
- **Manual Verification**:
  1. Devices Scan: Trigger Scan in UI, confirm it parses local devices correctly.
  2. Casting Session: Cast a test URL (e.g. HLS/MP4), verify VLC opens and streams to Chromecast. Verify Stop kills both processes.
  3. CRUD History: Verify adding, editing, and deleting history records works and persists in `data/history.json`.
- **Automated Validation**: Build basic integration tests for REST APIs (`history`, `devices`, `cast`) if needed using a test script.

---

## Boundaries
- **Always**:
  - Handle stream process termination gracefully, killing both `yt-dlp` and `VLC` child processes.
  - Validate that required system binaries (`yt-dlp`, `catt`, `VLC`) are present on launch.
- **Ask first**:
  - Changing the default command line arguments for VLC or yt-dlp.
- **Never**:
  - Leave orphaned zombie processes running on the system when a session stops or the server crashes.

---

## Success Criteria
- [ ] Scanning triggers `catt scan` and populates the device list in the UI correctly.
- [ ] Users can enter a stream URL and configure custom headers (key-value list).
- [ ] Pressing "Cast" starts the stream pipeline; the server logs stream output and tracks process state.
- [ ] VLC successfully connects to Chromecast and plays the URL.
- [ ] Pressing "Stop" immediately stops streaming and kills all spawned subprocesses.
- [ ] History page allows adding, editing, and deleting saved URLs, stored persistently in `data/history.json`.
- [ ] Frontend uses a premium dark-mode dashboard design with responsive structure, clean layouts, and nice hover/active effects.
