# Implementation Plan: Chromecast & AirPlay Volume Control

## Component Architecture & Dependencies

```
┌────────────────────────────────────────────────────────┐
│               Web Frontend Dashboard                   │
│   (Slider, Mute Toggle, Step +/- Buttons, Live Badge)  │
│   public/index.html & public/css/style.css             │
└──────────────────────────┬─────────────────────────────┘
                           │ Debounced fetch (200ms)
                           ▼
┌────────────────────────────────────────────────────────┐
│               Frontend Controller                      │
│   public/js/app.js (State sync, optimistic UI)        │
└──────────────────────────┬─────────────────────────────┘
                           │ POST /api/cast/volume
                           ▼
┌────────────────────────────────────────────────────────┐
│               Express API Route                        │
│   server.js (Input validation, active session check)   │
└──────────────────────────┬─────────────────────────────┘
                           │ setVolume(level, action)
                           ▼
┌────────────────────────────────────────────────────────┐
│               Cast Session Manager                     │
│   services/castManager.js (Process orchestration)      │
└────────────┬─────────────────────────────┬─────────────┘
             │                             │
    deviceType === 'chromecast'    deviceType === 'airplay'
             ▼                             ▼
┌───────────────────────────┐ ┌───────────────────────────┐
│     catt volume <lvl>     │ │ playAirplay.py volume     │
│   (Chromecast Cast V2)    │ │ (pyatv.interface.Audio)   │
└───────────────────────────┘ └───────────────────────────┘
```

---

## Phase Breakdown & Order of Implementation

1. **Phase 1: Backend Audio Engines**
   - Extend `services/playAirplay.py` with `volume`, `volume_up`, `volume_down` commands using `pyatv`.
   - Verify `catt volume` and `playAirplay.py volume` execution from Node.
2. **Phase 2: Service Layer & Session State**
   - Implement `setVolume()`, `adjustVolume()`, and `setMute()` in `services/castManager.js`.
   - Maintain `volume` and `isMuted` in `activeSession` and expose via `getSessionStatus()`.
3. **Phase 3: Express API Endpoints**
   - Add `POST /api/cast/volume` in `server.js` with comprehensive input validation.
4. **Phase 4: Frontend UI Elements & Styling**
   - Add volume control HTML widget into the "Current Session" card in `public/index.html`.
   - Add dark-theme styles for slider, thumb, buttons, and disabled states in `public/css/style.css`.
5. **Phase 5: Client-Side State & Event Wiring**
   - Wire debounced slider events, step buttons, and mute toggle in `public/js/app.js`.
   - Sync volume UI state during polling and disable when session is idle.

---

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation Strategy |
|---|---|---|
| Rapid slider drag floods network with CLI process spawns | High | Frontend debounces `input` events by 200ms. Backend drops overlapping volume requests if another volume command is actively executing. |
| AirPlay smart TV doesn't support master volume | Medium | Graceful error handling in `playAirplay.py` falling back to `volume_up`/`volume_down` remote keys, logging user-friendly feedback in terminal. |
| Subprocess hangs on unreachable device | Medium | Enforce strict 7-second execution timeout on all child processes spawned for volume. |
| Volume desync between UI and physical TV | Low | Optimistic UI updates with instant percentage display, confirmed via status response. |

---

## Discrete Task Breakdown

- [x] **Task 1: Extend `services/playAirplay.py` for volume control**
  - **Acceptance**: Running `python3 services/playAirplay.py volume <ip> <lvl>` executes `atv.audio.set_volume()` and exits 0 on success.
  - **Verify**: Run `python3 services/playAirplay.py` CLI test to verify argument parsing and volume command dispatch.
  - **Files**: `services/playAirplay.py`

- [x] **Task 2: Implement volume orchestration in `services/castManager.js`**
  - **Acceptance**: `castManager.setVolume(level)` correctly dispatches to `catt` for Chromecast and `playAirplay.py` for AirPlay; updates session state and streams log entries.
  - **Verify**: Node script invoking `setVolume` with validation checks.
  - **Files**: `services/castManager.js`

- [x] **Task 3: Add `POST /api/cast/volume` route and status integration in `server.js`**
  - **Acceptance**: `POST /api/cast/volume` accepts `{ action, level, step, isMuted }`, validates inputs, rejects if not casting or bad payload, returns 200 with new volume state; `GET /api/cast/status` includes volume and isMuted.
  - **Verify**: Curl test to `POST /api/cast/volume` with valid and invalid payloads.
  - **Files**: `server.js`

- [x] **Task 4: Design & markup volume controls in `public/index.html` & `public/css/style.css`**
  - **Acceptance**: Volume slider, mute button, -/+ buttons, and percentage display rendered within the Current Session card; matches dark-mode glassmorphic styling.
  - **Verify**: Inspect HTML layout and verify Lucide icons render properly.
  - **Files**: `public/index.html`, `public/css/style.css`

- [x] **Task 5: Implement debounced frontend volume control logic in `public/js/app.js`**
  - **Acceptance**: Slider drag debounced to 200ms, +/- step buttons adjust by 5%, mute button toggles state and icon, controls disable when idle and enable when casting.
  - **Verify**: End-to-end manual verification in browser and automated syntax/lint verification.
  - **Files**: `public/js/app.js`
