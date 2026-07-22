# ShowTime — Project Instructions

Loom-style screen recorder that runs 100% locally. Electron + vanilla JS (no framework, no build step, no bundler). No cloud, no external APIs, no accounts — everything stays on the user's machine.

**UI work: read `DESIGN.md` first.** It is the single source of truth for colors, type, spacing, and component rules; `styles.css` implements its tokens as CSS variables in `:root`.

## Commands

- `npm install` — install deps (Electron + ffmpeg-static)
- `npm start` — launch the app (`electron .`)

No tests, no linter configured yet.

## Architecture

```
src/
  main/
    main.js         Main process: main window + floating control-bar window,
                    desktopCapturer source list, setDisplayMediaRequestHandler
                    (routes getDisplayMedia to the user-picked source),
                    ffmpeg export (trim + convert in one pass), dialogs, IPC
    preload.js      contextBridge — exposes window.api; renderer never touches Node
  renderer/
    index.html      UI layout (setup panel, preview, editor, source-picker modal)
    control.html    Floating always-on-top control bar shown while recording
                    (timer / pause / stop); content-protected so it never
                    appears in the capture
    styles.css      Dark theme, CSS variables in :root
    js/
      capture.js    getDisplayMedia/getUserMedia wrappers, device enumeration
      compositor.js Canvas draw loop (setInterval, NOT rAF — see below):
                    screen + circular webcam bubble; bubble drag/resize via
                    pointer events (normalized coords)
      recorder.js   AudioContext mixing (mic + system loopback) + MediaRecorder
                    on canvas.captureStream() → WebM (VP9/Opus) in memory
      trimmer.js    WebM Infinity-duration fix (seek hack)
      app.js        UI orchestration, state object, event binding, mic VU meter
```

Recording pipeline: canvas captureStream + mixed audio → MediaRecorder (WebM blob in memory) → `export-recording` IPC → main process spawns `ffmpeg-static` to trim + convert (MP4 H.264/AAC default, WebM optional).

Recording session flow: Record click → countdown → main window **hides** (avoids the infinite-mirror effect of recording your own screen) → control-bar window appears (always-on-top, `setContentProtection(true)`) → stop restores the main window and opens the editor.

## Conventions

- Renderer uses ES modules (`type="module"`); main process uses CommonJS.
- Keep modules independent: capture / compositing / recording / UI never import each other except through `app.js`.
- All main↔renderer communication goes through `preload.js` (`window.api`). Never enable `nodeIntegration`.
- Bubble geometry is normalized (0–1 fractions of canvas size) so it survives resolution changes.
- Strict CSP in index.html — no inline scripts/styles, no external resources. (control.html is exempt: tiny, self-contained, uses an inline style/script block.)

## Critical invariants (breaking these breaks recording silently)

- Main window is created with `backgroundThrottling: false` and the compositor draws via `setInterval`, **not** requestAnimationFrame — rAF stops when the window is hidden, and the window hides itself during every recording.
- The control-bar window must keep `setContentProtection(true)` or it shows up in recordings.
- ffmpeg mp4 args include `-pix_fmt yuv420p` and even-dimension crop — H.264 rejects odd dimensions; screen captures can be odd-sized.

## Known constraints

- System audio = Electron `'loopback'`, Windows + full-screen sources only.
- MP4 export re-encodes (fast, ~faster than realtime with veryfast preset). WebM export without trim is a stream copy.

## Planned extensions (design for these)

- Annotations (extra draw layer in compositor's loop)
- Zoom/pan effects on the screen layer
- More webcam shapes (rounded rect, square) — one draw method per shape in compositor.js
