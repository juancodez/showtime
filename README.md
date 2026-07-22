# ShowTime

A Loom-style screen recorder that runs 100% locally. No cloud, no accounts, no external APIs — everything stays on your machine.

Built with Electron + vanilla JS. No framework, no build step, no bundler.

---

## Features

- **Screen + window capture** — custom source picker with live thumbnails
- **Webcam bubble** — circular overlay composited in real-time; drag to reposition, scroll-wheel or drag edge to resize
- **Audio mixing** — microphone (with live VU meter) + optional system audio (Windows loopback), mixed via Web Audio API
- **Recording control bar** — always-on-top floating bar (timer / pause / stop) that's excluded from the capture; main window hides itself to avoid the infinite-mirror effect
- **3-second countdown** before recording starts
- **Trim editor** — trim start and end after recording before exporting
- **MP4 export (default)** — H.264 + AAC via bundled `ffmpeg-static`, fast re-encode
- **WebM export** — stream copy (no trim) or re-encode (with trim)
- Saves `recording-YYYY-MM-DD_HH-mm-ss.mp4` to a folder you choose (defaults to Videos)

---

## Run

```bash
npm install
npm start
```

Requires Node.js. `ffmpeg` is bundled — no system install needed.

---

## Architecture

```
src/
  main/
    main.js         Electron main process — windows, source enumeration,
                    display-media request handler, ffmpeg export, IPC
    preload.js      contextBridge (renderer never touches Node directly)
    subtitles.js    Local Whisper subtitle generation
  renderer/
    index.html      Main UI (setup panel, preview canvas, editor, source picker)
    control.html    Floating recording control bar (always-on-top)
    styles.css      Dark theme, CSS variables in :root
    js/
      app.js        UI orchestration and state
      capture.js    getDisplayMedia / getUserMedia wrappers, device lists
      compositor.js Canvas compositing loop + webcam bubble drag/resize
      recorder.js   AudioContext mixing + MediaRecorder → WebM in memory
      trimmer.js    WebM duration fix (Infinity-duration seek hack)
```

**Recording pipeline:** canvas `captureStream()` + mixed audio → `MediaRecorder` (WebM blob in memory) → `export-recording` IPC → main process spawns `ffmpeg-static` to trim + convert in one pass.

---

## Platform support

| Platform | Status |
|----------|--------|
| Windows  | Full feature set. System audio capture supported (full-screen sources only). |
| macOS    | Full feature set. System audio disabled (requires BlackHole or similar — not bundled). |
| Linux    | Full feature set. System audio disabled. Control bar may appear in the capture (`setContentProtection` is a no-op on Linux). |

---

## Technical notes

- The compositor uses `setInterval`, not `requestAnimationFrame` — rAF pauses when the window is hidden, and the main window hides itself during every recording.
- The control bar uses `setContentProtection(true)` so it never appears in captures.
- MP4 args include `-pix_fmt yuv420p` and even-dimension enforcement — H.264 rejects odd-sized frames.
- Webcam bubble geometry is stored as normalized 0–1 fractions so it survives resolution changes.
- Strict CSP in `index.html` — no inline scripts/styles, no external resources.
- System audio uses Electron's `loopback` audio mode, Windows-only.

---

## Stack

- [Electron](https://www.electronjs.org/)
- [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) — bundled ffmpeg binary
- Web Audio API — audio mixing
- MediaRecorder API — capture to WebM
- Canvas API — real-time compositing
