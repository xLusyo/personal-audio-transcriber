const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('meetingNotes', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  start: () => ipcRenderer.invoke('start-recording'),
  started: () => ipcRenderer.invoke('capture-started'),
  append: chunk => ipcRenderer.invoke('append-audio', chunk),
  failed: message => ipcRenderer.invoke('capture-failed', message),
  finish: () => ipcRenderer.invoke('finish-recording'),
  retry: () => ipcRenderer.invoke('retry-recording'),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  openNote: () => ipcRenderer.invoke('open-note'),
  onStatus: callback => ipcRenderer.on('status', (_event, status) => callback(status)),
  onStop: callback => ipcRenderer.on('stop-recording', callback),
  onCaptureError: callback => ipcRenderer.on('capture-error', (_event, message) => callback(message)),
});
