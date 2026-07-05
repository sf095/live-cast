# Plan and Tasks: Live Cast

## Part 1: Implementation Plan

### 1. Major Components & Dependencies
- **Backend (Node.js/Express)**:
  - `express` for HTTP endpoints.
  - `cors` for communication if frontend and backend are hosted differently, though they will be co-served.
  - `child_process` (built-in) for executing `catt scan` and piping `yt-dlp` to VLC.
- **Frontend (Vanilla HTML/CSS/JS)**:
  - Responsive single-page dashboard.
  - Dynamic Custom Headers manager (UI list where users can add/remove Key-Value pairs).
  - Stream Logs panel showing real-time stderr/stdout logs from `yt-dlp` and VLC.
  - Chromecast Devices list with active status indicators.
  - History Manager with interactive Edit and Delete options.
- **Storage**:
  - `data/history.json` for storing stream metadata.

### 2. Implementation Order (Sequential Workflow)
1. **Initialize Project**: Create `package.json`, install Express/Cors, configure basic server.
2. **Backend API Development**:
   - Validation logic to ensure `yt-dlp`, `catt`, and VLC exist.
   - History CRUD endpoints.
   - Devices scan (`catt scan` parser).
   - Casting orchestration (async child-process lifecycle management).
3. **Frontend UI & Styling**:
   - Layout, typography (Google Fonts - Outfit/Inter), glassmorphism design system.
   - Custom CSS transitions, state animations.
4. **Frontend Logic**:
   - Fetching devices, history management UI, custom header fields.
   - Connect API to "Cast" / "Stop" actions, log polling/updates.
5. **Testing and Polish**:
   - End-to-end integration test (running the app, casting, checking logs, terminating).

### 3. Risks & Mitigations
- **Risk**: VLC or yt-dlp zombie processes if the user closes the app or crashes.
  - *Mitigation*: Track child process PIDs. Use a global cleanup function on server exit (`SIGINT`, `SIGTERM`, `exit`) that terminates all active child processes.
- **Risk**: Blocked streams/network errors.
  - *Mitigation*: Capture `stderr` from both processes and stream it back via the status API so users see errors directly in the UI.

---

## Part 2: Task Breakdown

### Phase 1: Project Setup & System Check
- [ ] **Task 1.1: Project Initialization**
  - **Acceptance**: `package.json` created, Express installed, server running.
  - **Verify**: Run `npm run dev` and access `http://localhost:3000`.
  - **Files**: `package.json`, `server.js`
- [ ] **Task 1.2: Environment Sanity Check**
  - **Acceptance**: Backend check verifies `catt`, `yt-dlp`, and VLC path exist at start.
  - **Verify**: API returns status of required dependencies.
  - **Files**: `server.js`

### Phase 2: Backend APIs (Devices, History, Session)
- [ ] **Task 2.1: Device Scan API**
  - **Acceptance**: Endpoint `GET /api/devices` runs `catt scan`, parses, and returns JSON array of IP/Name.
  - **Verify**: Curl `GET /api/devices` returns parsed JSON.
  - **Files**: `server.js`
- [ ] **Task 2.2: History CRUD API**
  - **Acceptance**: Express endpoints for CRUD. Saves to `data/history.json`.
  - **Verify**: API adds, edits, lists, and deletes records.
  - **Files**: `server.js`, `data/history.json`
- [ ] **Task 2.3: Casting Engine (Start & Stop)**
  - **Acceptance**: `POST /api/cast` spawns `yt-dlp` piped to VLC; `POST /api/cast/stop` terminates processes safely. Tracks output logs.
  - **Verify**: Starting session spawns processes; stopping them terminates them. Log endpoints return accumulated output.
  - **Files**: `server.js`

### Phase 3: Premium UI Design & Layout
- [ ] **Task 3.1: CSS Theme & Layout Setup**
  - **Acceptance**: Responsive, premium CSS file with dark-theme glassmorphism, Outfit font, design system tokens.
  - **Verify**: View static page in browser, visually stunning.
  - **Files**: `public/css/style.css`, `public/index.html`
- [ ] **Task 3.2: HTML Page Construction**
  - **Acceptance**: HTML5 layout with sidebar/sections: Stream Input (URL & Headers), Devices, Live Log Terminal, and Stream History.
  - **Verify**: DOM contains all interactive elements with unique IDs.
  - **Files**: `public/index.html`

### Phase 4: Frontend Logic Integration
- [ ] **Task 4.1: Devices & History UI Interactions**
  - **Acceptance**: JS modules fetch and render devices and history; supports History Edit/Delete modals.
  - **Verify**: UI lists devices, lets users add/edit/delete history.
  - **Files**: `public/js/app.js`
- [ ] **Task 4.2: Cast Form, Headers & Terminal logs**
  - **Acceptance**: Headers dynamic input list (Add Header button); Form submission starts cast; Logs poll and display in terminal box; Status turns active.
  - **Verify**: Submit cast, logs scroll dynamically, "Stop" button changes status back.
  - **Files**: `public/js/app.js`

### Phase 5: Testing, Cleanup & Polish
- [ ] **Task 5.1: Process Lifecycle & Cleanup verification**
  - **Acceptance**: Verify all subprocesses are cleanly killed on exit.
  - **Verify**: Stop casting and check `ps aux | grep VLC` to ensure zero stray processes.
  - **Files**: `server.js`
