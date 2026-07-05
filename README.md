# Live Cast

A premium, glassmorphic dark-mode web application to discover local Chromecast devices and cast streaming media URLs (e.g. HLS feeds, Dash feeds, direct video links) using a local macOS process pipeline combining `yt-dlp` and `VLC`.

![Live Cast Dashboard](public/index.html) *Note: Run the app to view the live dashboard in your browser.*

---

## Features
- **Chromecast Device Discovery**: Scan your local Wi-Fi network dynamically using `catt scan` to find available streaming boxes and sticks.
- **Header Customization**: Add key-value HTTP headers (like custom `Referer` or `User-Agent`) to bypass geo-blocks or referer checks on stream feeds.
- **Stream Logs Console**: Polls and outputs live `stdout` and `stderr` logs from the spawning `yt-dlp` and `VLC` processes directly in an interactive on-screen terminal.
- **Preset Management (CRUD)**: Save your favorite streams as presets with custom headers. Play, edit, or delete them instantly from the sidebar.
- **Responsive Premium UI**: Visually stunning obsidian dark dashboard built with pure CSS glassmorphism, smooth animations, and complete WCAG-compliant keyboard accessibility.
- **Zombie Process Protection**: Automatic process hooks ensure background streaming child processes are killed gracefully when you stop streaming or close the server.

---

## Tech Stack
- **Backend**: Node.js, Express, CORS
- **Frontend**: HTML5, CSS3 (Custom Grid/Flex layout), Vanilla JavaScript (ES6 Modules)
- **Utilities**:
  - `yt-dlp` (Stream resolver)
  - `catt` (Cast All The Things - device discovery)
  - VLC Player (Mac Desktop client)

---

## Prerequisites

This application is designed to run locally on **macOS** and requires the following utilities installed and available on your system path:

1. **VLC Player**: Must be installed in your `/Applications` directory (executable at `/Applications/VLC.app/Contents/MacOS/VLC`).
2. **yt-dlp**: Used to fetch and demux streams.
   ```bash
   brew install yt-dlp
   ```
3. **catt**: Used to scan and locate Chromecasts.
   ```bash
   pip3 install catt
   ```

---

## Getting Started

1. Clone or navigate to the project directory:
   ```bash
   cd live_cast
   ```

2. Install the server dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

---

## Usage Guide

1. **Verify Setup**: On load, check the top-right toolbar. The status dots next to `yt-dlp`, `catt`, and `VLC Player` will turn **green** if they are detected on your Mac.
2. **Scan**: Click **Scan Devices** to fetch Chromecasts on your network. Select your device from the dropdown.
3. **Input Stream**: Paste your stream URL (e.g. HLS `.m3u8` feed).
4. **Add Headers (Optional)**: If the stream requires a custom referer or client headers, click **Add Header** to include key-value pairs (e.g. Key: `Referer`, Value: `https://mycustomorigin.com`).
5. **Cast**: Click **Start Cast**. The video will start playing on your Chromecast. Scroll to the bottom terminal to inspect live connection logs.
6. **Stop**: Click **Stop Cast** to immediately disconnect and stop VLC processes.
7. **Save Presets**: Check the **Save to history presets** option before casting, or click **Add Preset** in the sidebar to manually save stream configurations.

---

## Project Structure

```
live_cast/
├── data/
│   └── history.json       # Presets JSON database
├── public/
│   ├── css/
│   │   └── style.css      # Core styles & layout (Obsidian design tokens)
│   ├── js/
│   │   └── app.js         # Frontend controller, API requests & Toaster
│   └── index.html         # Main dashboard HTML template
├── package.json           # Node project manifest
├── README.md              # Documentation
├── server.js              # Express backend server and process controller
├── spec.md                # Technical specification
└── plan.md                # Development phases checklist
```
