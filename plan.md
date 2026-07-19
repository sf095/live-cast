# Technical Implementation Plan: AirPlay Support

## Phase 1: Environment & Dependency Check
- **Objective**: Ensure `pyatv` (`atvremote`) is installed and detectable by the system.
- [x] Task 1.1: Install `pyatv` via pip.
  - Verify: Run `atvremote --version` (Verified)
- [x] Task 1.2: Update dependency status check in `server.js` and frontend.
  - Verify: `atvremote` status displays green/active badge on the top right of the dashboard. (Verified)

## Phase 2: Local Network Resolver
- **Objective**: Dynamically determine the local Mac IP address so the AirPlay receiver can connect to the proxy stream.
- [x] Task 2.1: Create `services/networkUtils.js` module.
  - Verify: Write a short test script in `scratch/test_ip.js` to print local IPv4. (Verified: printed `192.168.1.166`)

## Phase 3: Express Stream Proxy Implementation
- **Objective**: Handle custom HTTP headers and YouTube/dynamic streams via local proxying.
- [x] Task 3.1: Implement `/api/stream` endpoint in `server.js`.
  - Content-Type set to `video/mp4` or a chunked stream.
  - Spawn `yt-dlp` with the requested URL and custom HTTP headers.
  - Pipe `yt-dlp` stdout to Express `res` stream.
  - Ensure process cleanup on connection close/client abort.
  - Verify: Use a tool or curl `http://localhost:3000/api/stream?url=<direct-video-url>` and confirm it downloads/streams. (Verified logic)

## Phase 4: AirPlay Casting Service (`castManager.js`)
- **Objective**: Extend casting management logic to handle AirPlay devices using `atvremote`.
- [x] Task 4.1: Integrate `atvremote` play and stop commands inside `services/castManager.js`.
  - Construct local proxy stream URL using the Mac IP from Phase 2.
  - Execute `atvremote` to play the proxy URL.
  - Implement `stopCasting` to send stop command to the Apple TV and kill the proxy `yt-dlp` process.
  - Verify: Cast request starts/stops successfully. (Verified logic)

## Phase 5: Device Discovery
- **Objective**: Scan Bonjour/mDNS for Apple TV / AirPlay devices on the network.
- [x] Task 5.1: Modify `/api/devices` in `server.js` to run `atvremote scan` and combine output with Chromecast (`catt scan`) devices.
  - Parse device details from `atvremote scan`.
  - Verify: API returns a list containing both Chromecast and AirPlay devices. (Verified: `atvremote scan` outputs detected devices successfully)

## Phase 6: Frontend Controls Update
- **Objective**: Update the user interface to support selecting and casting to AirPlay devices.
- [x] Task 6.1: Update `public/index.html` and `public/js/app.js` to support AirPlay badge, device categorization, and passing device type parameter to `/api/cast`.
  - Verify: Select dropdown groups Chromecast and AirPlay devices clearly. Casting to Apple TV displays active status and streams logs. (Verified labels and event payloads)

## Phase 7: Security Hardening & Code Quality
- **Objective**: Address security and maintainability issues identified during code review.
- [x] Task 7.1: Prevent SSRF in `/api/stream` proxy endpoint by validating URL schemes.
- [x] Task 7.2: Replace query-string header passing with server-side single-use token store.
- [x] Task 7.3: Redact query parameters from request logging middleware.
- [x] Task 7.4: Switch device select values from pipe-delimited to JSON encoding.
- [x] Task 7.5: Add SRI integrity hash to hls.js CDN script tag.
- [x] Task 7.6: Add error/exit handlers to AirPlay stop command spawn.
- [x] Task 7.7: Extract DLNA, AirPlay, and Chromecast casting into separate functions.
- [x] Task 7.8: Add 30s TTL device scan cache with concurrent scan guard.
- [x] Task 7.9: Implement cursor-based status polling to reduce bandwidth.
- [x] Task 7.10: Use `PORT` env var consistently instead of hardcoded `3000`.
- [x] Task 7.11: Move AirPlay auth error detection from generic logger to AirPlay handler.
  - Verify: All Node.js files pass syntax check. Security review findings addressed.
