const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // capture setup
  getSources: () => ipcRenderer.invoke('get-sources'),
  setSource: (sourceId, withSystemAudio) =>
    ipcRenderer.invoke('set-source', sourceId, withSystemAudio),

  // recording session (main window ↔ control bar)
  setRecordingState: (state) => ipcRenderer.send('recording-state', state),
  onControlAction: (cb) => ipcRenderer.on('control-action', (e, action) => cb(action)),
  controlAction: (action) => ipcRenderer.send('control-action', action),
  sendTimer: (text) => ipcRenderer.send('timer-update', text),
  onTimerUpdate: (cb) => ipcRenderer.on('timer-update', (e, text) => cb(text)),

  // export & files
  showSaveDialog: (suggestedName) => ipcRenderer.invoke('show-save-dialog', suggestedName),
  exportRecording: (arrayBuffer, opts) =>
    ipcRenderer.invoke('export-recording', arrayBuffer, opts),
  onExportProgress: (cb) => ipcRenderer.on('export-progress', (e, frac) => cb(frac)),
  onExportStatus: (cb) => ipcRenderer.on('export-status', (e, msg) => cb(msg)),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),

  // system
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  setAppIcon: (dataUrl) => ipcRenderer.send('set-app-icon', dataUrl)
});
