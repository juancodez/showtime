const { app, BrowserWindow, ipcMain, dialog, session, desktopCapturer, shell, screen, nativeImage } = require('electron');

// Must be set before any window creation so Windows taskbar groups correctly.
app.setName('ShowTime');
if (process.platform === 'win32') app.setAppUserModelId('com.showtime.recorder');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const { transcribe, toSrt } = require('./subtitles');

let mainWindow = null;
let controlWindow = null;

// Source chosen by the user in the renderer's picker. The
// setDisplayMediaRequestHandler resolves getDisplayMedia() with it.
let selectedSourceId = null;
let systemAudioWanted = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d0f13',
    title: 'ShowTime',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The compositor must keep drawing while the window is hidden
      // during recording, so timers must not be throttled.
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

// Small always-on-top pill with timer / pause / stop, shown while the main
// window is hidden during recording. Content protection keeps the bar
// itself out of the screen capture.
function createControlWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = 380;
  const height = 64;
  controlWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + workArea.height - height - 24,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#15181e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  controlWindow.setContentProtection(true);
  controlWindow.setAlwaysOnTop(true, 'screen-saver');
  controlWindow.loadFile(path.join(__dirname, '..', 'renderer', 'control.html'));
  controlWindow.on('closed', () => {
    controlWindow = null;
  });
}

function closeControlWindow() {
  if (controlWindow) {
    controlWindow.destroy();
    controlWindow = null;
  }
}

app.whenReady().then(() => {
  // Route getDisplayMedia() to the source the user picked in our own UI
  // instead of showing Chromium's picker.
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      const source = sources.find((s) => s.id === selectedSourceId) || sources[0];
      if (!source) return callback({});
      // 'loopback' captures system audio (Windows). Only attach when asked,
      // and only for screen sources — window loopback is unsupported.
      const wantLoopback = systemAudioWanted && source.id.startsWith('screen');
      callback({ video: source, audio: wantLoopback ? 'loopback' : undefined });
    } catch (err) {
      console.error('display media handler failed:', err);
      callback({});
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- IPC: capture setup --------------------------------------------------

ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: true
  });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    isScreen: s.id.startsWith('screen'),
    thumbnail: s.thumbnail.toDataURL(),
    appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null
  }));
});

ipcMain.handle('set-source', (event, sourceId, withSystemAudio) => {
  selectedSourceId = sourceId;
  systemAudioWanted = Boolean(withSystemAudio);
});

// --- IPC: recording session (hide app, show control bar) ------------------

ipcMain.on('recording-state', (event, state) => {
  if (state === 'started') {
    createControlWindow();
    mainWindow.hide();
  } else if (state === 'stopped') {
    closeControlWindow();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Pause/resume/stop clicked in the control bar → forward to the app renderer.
ipcMain.on('control-action', (event, action) => {
  if (mainWindow) mainWindow.webContents.send('control-action', action);
});

// Timer text from the app renderer → forward to the control bar.
ipcMain.on('timer-update', (event, text) => {
  if (controlWindow) controlWindow.webContents.send('timer-update', text);
});

// --- IPC: files & export ---------------------------------------------------

ipcMain.handle('show-save-dialog', async (event, suggestedName) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save recording',
    defaultPath: path.join(app.getPath('videos'), `${suggestedName}.mp4`),
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
      { name: 'WebM Video', extensions: ['webm'] }
    ]
  });
  return canceled ? null : filePath;
});

/**
 * Export via ffmpeg: trims (accurate, fast) and converts in one pass.
 * mp4 → H.264 + AAC. webm untrimmed → stream copy (also fixes the
 * missing-duration metadata MediaRecorder leaves behind).
 * Optional subtitles: local Whisper → .srt sidecar, optionally burned in.
 */
ipcMain.handle('export-recording', async (event, arrayBuffer, opts) => {
  const { filePath, format, duration } = opts;
  const folder = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  const subtitles = opts.subtitles || 'none';
  const burn = Boolean(opts.burnSubtitles) && subtitles !== 'none';

  const sendStatus = (msg) => {
    if (mainWindow) mainWindow.webContents.send('export-status', msg);
  };

  const tmpPath = path.join(app.getPath('temp'), `showtime-${Date.now()}.webm`);
  await fs.writeFile(tmpPath, Buffer.from(arrayBuffer));

  await fs.mkdir(folder, { recursive: true });

  let srtPath = null;
  try {
    if (subtitles !== 'none') {
      const wavPath = `${tmpPath}.wav`;
      sendStatus('Extracting audio for subtitles…');
      await runFfmpeg(
        ['-y', '-i', tmpPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wavPath],
        0, () => {}
      );
      const segments = await transcribe(wavPath, subtitles, sendStatus);
      fs.unlink(wavPath).catch(() => {});
      srtPath = path.join(folder, `${baseName}.srt`);
      await fs.writeFile(srtPath, toSrt(segments), 'utf8');
    }

    sendStatus('Encoding video…');
    const filters = [];
    if (format === 'mp4') filters.push('crop=trunc(iw/2)*2:trunc(ih/2)*2');
    if (burn && srtPath) {
      // Forward slashes + escaped colons required by ffmpeg subtitles filter on all platforms.
      const escaped = srtPath.replace(/\\/g, '/').replace(/'/g, "\\'").replace(/:/g, '\\:');
      filters.push(`subtitles='${escaped}'`);
    }

    const args = ['-y', '-i', tmpPath];
    if (format === 'mp4') {
      args.push(
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-pix_fmt', 'yuv420p',
        '-vf', filters.join(','),
        '-c:a', 'aac', '-b:a', '160k',
        '-movflags', '+faststart'
      );
    } else if (burn) {
      if (filters.length) args.push('-vf', filters.join(','));
      args.push('-c:v', 'libvpx', '-b:v', '8M', '-c:a', 'libopus');
    } else {
      args.push('-c', 'copy');
    }
    args.push(filePath);

    await runFfmpeg(args, duration, (frac) => {
      if (mainWindow) mainWindow.webContents.send('export-progress', frac);
    });
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
  return filePath;
});

function runFfmpeg(args, totalSeconds, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s);
      if (m && totalSeconds > 0) {
        const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress(Math.min(1, t / totalSeconds));
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(-400)}`));
    });
  });
}

ipcMain.handle('open-file', (event, filePath) => shell.openPath(filePath));

ipcMain.handle('get-platform', () => process.platform);

ipcMain.on('set-app-icon', (event, dataUrl) => {
  const img = nativeImage.createFromDataURL(dataUrl);
  if (mainWindow) mainWindow.setIcon(img);
  if (process.platform === 'darwin') app.dock.setIcon(img);
});
