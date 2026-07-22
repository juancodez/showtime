// app.js — UI orchestration: device setup, source picker, countdown,
// record/pause/stop, export.

import {
  primeDevicePermissions,
  listDevices,
  getScreenStream,
  getWebcamStream,
  getMicStream,
  stopStream
} from './capture.js';
import { Compositor } from './compositor.js';
import { Recorder } from './recorder.js';
import { getBlobDuration } from './trimmer.js';

const $ = (id) => document.getElementById(id);

const state = {
  screenStream: null,
  webcamStream: null,
  micStream: null,
  compositor: null,
  recorder: null,
  recordedBlob: null,
  recordedDuration: 0,
  selectedSource: null,
  timerInterval: null,
  elapsedMs: 0,
  lastTick: 0,
  vuCtx: null,
  vuInterval: null
};

// Hidden <video> elements feeding the compositor.
const screenVideo = document.createElement('video');
const webcamVideo = document.createElement('video');
for (const v of [screenVideo, webcamVideo]) {
  v.muted = true;
  v.playsInline = true;
}

// --- init ---------------------------------------------------------------

function generateAndSetIcon() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#15181E';
  ctx.beginPath(); ctx.roundRect(0, 0, s, s, 52); ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(1, 1, s - 2, s - 2, 51); ctx.stroke();

  ctx.fillStyle = '#E5484D';
  ctx.beginPath(); ctx.arc(204, 52, 18, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#F5A623';
  ctx.font = '800 128px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('ST', 116, 188);

  window.api.setAppIcon(c.toDataURL());
}

async function init() {
  generateAndSetIcon();

  const platform = await window.api.getPlatform();
  if (platform !== 'win32') {
    $('systemAudio').disabled = true;
    $('systemAudio').closest('label').title = 'System audio capture requires Windows';
  }

  await primeDevicePermissions();
  await refreshDevices();
  navigator.mediaDevices.addEventListener('devicechange', refreshDevices);

  state.compositor = new Compositor($('previewCanvas'));

  bindEvents();
}

async function refreshDevices() {
  const { cameras, microphones } = await listDevices();
  fillSelect($('cameraSelect'), cameras, 'Camera');
  fillSelect($('micSelect'), microphones, 'Microphone');
}

function fillSelect(select, devices, kind) {
  const prev = select.value;
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = `No ${kind.toLowerCase()}`;
  select.appendChild(none);
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `${kind} ${i + 1}`;
    select.appendChild(opt);
  });
  if (prev && [...select.options].some((o) => o.value === prev)) {
    select.value = prev;
  } else if (devices.length > 0) {
    select.value = devices[0].deviceId;
  }
}

// --- source picker modal --------------------------------------------------

async function openSourcePicker() {
  const modal = $('sourceModal');
  const grid = $('sourceGrid');
  grid.innerHTML = '<p class="muted">Loading sources…</p>';
  modal.classList.remove('hidden');

  const sources = await window.api.getSources();
  grid.innerHTML = '';
  for (const src of sources) {
    const card = document.createElement('button');
    card.className = 'source-card';
    card.innerHTML = `
      <img src="${src.thumbnail}" alt="">
      <span class="source-name">${escapeHtml(src.name)}</span>
      <span class="source-kind">${src.isScreen ? 'Screen' : 'Window'}</span>`;
    card.addEventListener('click', () => {
      state.selectedSource = src;
      modal.classList.add('hidden');
      startPreview();
    });
    grid.appendChild(card);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// --- preview ---------------------------------------------------------------

async function startPreview() {
  try {
    stopAllStreams();

    const sysAudio = $('systemAudio').checked && state.selectedSource.isScreen;
    await window.api.setSource(state.selectedSource.id, sysAudio);
    state.screenStream = await getScreenStream(sysAudio);
    screenVideo.srcObject = state.screenStream;
    await screenVideo.play();
    state.compositor.setScreenVideo(screenVideo);

    await applyWebcam();
    await applyMic();

    state.compositor.start();

    state.screenStream.getVideoTracks()[0].addEventListener('ended', () => {
      if (state.recorder && state.recorder.state !== 'inactive') {
        stopRecording();
      } else {
        resetToSetup();
      }
    });

    $('sourceName').textContent = state.selectedSource.name;
    show('previewSection');
    $('recordBtn').disabled = false;
    setStatus('Preview live. Drag the bubble; edge or wheel resizes.');
  } catch (err) {
    console.error(err);
    setStatus(`Could not start preview: ${err.message}`, true);
  }
}

async function applyWebcam() {
  stopStream(state.webcamStream);
  state.webcamStream = null;
  const deviceId = $('cameraSelect').value;
  state.compositor.setBubbleVisible(false);
  if (!deviceId) return;
  try {
    state.webcamStream = await getWebcamStream(deviceId);
    webcamVideo.srcObject = state.webcamStream;
    await webcamVideo.play();
    state.compositor.setWebcamVideo(webcamVideo);
    state.compositor.setBubbleVisible(true);
  } catch (err) {
    console.error('webcam failed:', err);
    setStatus(`Webcam unavailable: ${err.message}`, true);
  }
}

async function applyMic() {
  stopStream(state.micStream);
  state.micStream = null;
  stopVuMeter();
  const deviceId = $('micSelect').value;
  if (!deviceId) return;
  try {
    state.micStream = await getMicStream(deviceId);
    startVuMeter(state.micStream);
  } catch (err) {
    console.error('mic failed:', err);
    setStatus(`Microphone unavailable: ${err.message}`, true);
  }
}

function startVuMeter(stream) {
  state.vuCtx = new AudioContext();
  const analyser = state.vuCtx.createAnalyser();
  analyser.fftSize = 512;
  state.vuCtx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const bar = $('micLevelBar');
  state.vuInterval = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
    bar.style.width = `${Math.min(100, (peak / 128) * 180)}%`;
  }, 80);
}

function stopVuMeter() {
  clearInterval(state.vuInterval);
  if (state.vuCtx) { state.vuCtx.close(); state.vuCtx = null; }
  const bar = $('micLevelBar');
  if (bar) bar.style.width = '0%';
}

// --- recording ---------------------------------------------------------------

function countdown(seconds) {
  return new Promise((resolve) => {
    const overlay = $('countdownOverlay');
    const num = $('countdownNumber');
    overlay.classList.remove('hidden');
    let n = seconds;
    num.textContent = n;
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(t); overlay.classList.add('hidden'); resolve(); }
      else num.textContent = n;
    }, 1000);
  });
}

async function startRecording() {
  $('recordBtn').disabled = true;
  await countdown(3);

  const canvasStream = state.compositor.getStream(30);
  state.recorder = new Recorder(canvasStream, [state.micStream, state.screenStream]);
  state.recorder.start();

  state.elapsedMs = 0;
  state.lastTick = performance.now();
  state.timerInterval = setInterval(updateTimer, 200);

  $('recordControls').classList.remove('hidden');
  $('recordBtn').classList.add('hidden');
  $('pauseBtn').textContent = 'Pause';
  setStatus('Recording…');

  window.api.setRecordingState('started');
}

function updateTimer() {
  const now = performance.now();
  if (state.recorder && state.recorder.state === 'recording') {
    state.elapsedMs += now - state.lastTick;
  }
  state.lastTick = now;
  const text = formatTime(state.elapsedMs / 1000);
  $('timer').textContent = text;
  window.api.sendTimer(text);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function togglePause() {
  if (!state.recorder) return;
  if (state.recorder.state === 'recording') {
    state.recorder.pause();
    $('pauseBtn').textContent = 'Resume';
    setStatus('Paused.');
  } else if (state.recorder.state === 'paused') {
    state.recorder.resume();
    $('pauseBtn').textContent = 'Pause';
    setStatus('Recording…');
  }
}

async function stopRecording() {
  window.api.setRecordingState('stopped');
  clearInterval(state.timerInterval);
  if (!state.recorder) return;
  const blob = await state.recorder.stop();
  state.recorder = null;
  state.recordedBlob = blob;

  $('recordControls').classList.add('hidden');
  $('recordBtn').classList.remove('hidden');
  $('recordBtn').disabled = false;

  await openEditor(blob);
}

// --- editor & export ---------------------------------------------------

async function openEditor(blob) {
  const player = $('playerVideo');
  player.src = URL.createObjectURL(blob);
  await new Promise((res) => player.addEventListener('loadedmetadata', res, { once: true }));
  state.recordedDuration = await getBlobDuration(player);

  $('openFileBtn').classList.add('hidden');
  $('lastSaved').textContent = '';
  show('editorSection');
  setStatus(`Recording done — ${formatTime(state.recordedDuration)}. Review it, then hit Save.`);
}

async function exportRecording() {
  if (!state.recordedBlob) return;

  const suggestedName = `showtime-${timestamp()}`;
  const filePath = await window.api.showSaveDialog(suggestedName);
  if (!filePath) return; // user cancelled

  const format = filePath.toLowerCase().endsWith('.webm') ? 'webm' : 'mp4';
  const subtitles = $('subtitleSelect').value;
  const burnSubtitles = $('burnSubtitles').checked;

  const exportBtn = $('exportBtn');
  exportBtn.disabled = true;
  setStatus('Saving…');

  try {
    const buf = await state.recordedBlob.arrayBuffer();
    const savedPath = await window.api.exportRecording(buf, {
      filePath,
      format,
      duration: state.recordedDuration,
      subtitles,
      burnSubtitles
    });
    setStatus(`Saved — ${savedPath}`);
    $('lastSaved').textContent = savedPath;
    const openBtn = $('openFileBtn');
    openBtn.classList.remove('hidden');
    openBtn.onclick = () => window.api.openFile(savedPath);
  } catch (err) {
    console.error(err);
    setStatus(`Save failed: ${err.message}`, true);
  } finally {
    exportBtn.disabled = false;
  }
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// --- helpers ---------------------------------------------------------------

function show(sectionId) {
  for (const id of ['previewSection', 'editorSection']) {
    $(id).classList.toggle('hidden', id !== sectionId && sectionId !== 'both');
  }
  if (sectionId === 'editorSection') $('previewSection').classList.remove('hidden');
}

function setStatus(msg, isError = false) {
  const el = $('statusBar');
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

function stopAllStreams() {
  stopVuMeter();
  stopStream(state.screenStream);
  stopStream(state.webcamStream);
  stopStream(state.micStream);
  state.screenStream = state.webcamStream = state.micStream = null;
}

function resetToSetup() {
  state.compositor.stop();
  stopAllStreams();
  clearInterval(state.timerInterval);
  $('previewSection').classList.add('hidden');
  $('editorSection').classList.add('hidden');
  $('recordControls').classList.add('hidden');
  $('recordBtn').classList.remove('hidden');
  setStatus('Screen share ended. Pick a source to start again.');
}

function bindEvents() {
  $('pickSourceBtn').addEventListener('click', openSourcePicker);
  $('closeModalBtn').addEventListener('click', () => $('sourceModal').classList.add('hidden'));
  $('cameraSelect').addEventListener('change', () => state.screenStream && applyWebcam());
  $('micSelect').addEventListener('change', () => state.screenStream && applyMic());
  $('bubbleSize').addEventListener('input', (e) => {
    state.compositor.setBubbleSize(parseFloat(e.target.value));
  });
  $('recordBtn').addEventListener('click', startRecording);
  $('pauseBtn').addEventListener('click', togglePause);
  $('stopBtn').addEventListener('click', stopRecording);
  $('exportBtn').addEventListener('click', exportRecording);

  window.api.onControlAction((action) => {
    if (action === 'pause' || action === 'resume') togglePause();
    else if (action === 'stop') stopRecording();
  });

  window.api.onExportProgress((frac) => setStatus(`Saving… ${Math.round(frac * 100)}%`));
  window.api.onExportStatus((msg) => setStatus(msg));
}

init();
