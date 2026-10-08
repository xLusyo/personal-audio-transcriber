const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, desktopCapturer, session, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { loadConfig } = require('./config');
const { getApiKeySettings, saveApiKey } = require('./api-key-settings');
const { validateRecordingSetup } = require('./setup');
const { createRecording } = require('./storage');
const { processRecording } = require('./pipeline');

let window;
let tray;
let recording;
let config;
let state = 'idle';
let status = 'Ready to record';
let lastNote;
let quitting = false;
const notesDirectory = path.join(app.getPath('home'), 'MeetingNotes');
const envPath = app.isPackaged ? path.join(app.getPath('userData'), '.env') : path.join(app.getAppPath(), '.env');
const isBusy = () => ['starting', 'recording', 'stopping', 'processing'].includes(state);

function showWindow() {
  window.show();
  window.focus();
}

function publish(nextState, message) {
  state = nextState;
  status = message;
  tray.setTitle(state === 'recording' ? '●' : '');
  tray.setToolTip(`Meeting Notes — ${status}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: status, enabled: false },
    { type: 'separator' },
    { label: 'Start Recording', enabled: !isBusy(), click: () => {
      showWindow();
      window.webContents.executeJavaScript('document.getElementById("start").click()', true).catch(reportError);
    } },
    { label: 'Stop Recording', enabled: state === 'recording', click: () => window.webContents.send('stop-recording') },
    { label: 'Show Meeting Notes', click: showWindow },
    { label: 'Open Notes Folder', click: () => openNotesDirectory().catch(error => dialog.showErrorBox('Could not open notes folder', error.message)) },
    { type: 'separator' },
    { label: 'Quit', enabled: !isBusy(), click: () => { quitting = true; app.quit(); } },
  ]));
  window.webContents.send('status', { state, message: status, lastNote });
}

function reportError(error) {
  publish('error', error.message);
}

async function openNotesDirectory() {
  await fs.mkdir(notesDirectory, { recursive: true, mode: 0o700 });
  const error = await shell.openPath(notesDirectory);
  if (error) throw new Error(error);
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('Untrusted request.');
    }
    return callback(...args);
  });
}

async function finishRecording() {
  if (!recording || state !== 'recording') throw new Error('No active recording.');
  publish('stopping', 'Saving audio…');
  const current = recording;
  try {
    await current.handle.close();
    current.handle = null;
    publish('processing', 'Processing recording…');
    lastNote = await processRecording(current, config, message => publish('processing', message));
    publish('idle', `Saved ${path.basename(lastNote)}`);
    recording = null;
    return lastNote;
  } catch (error) {
    reportError(new Error(`Audio preserved at ${current.audioPath}. ${error.message}`));
    throw error;
  }
}

function registerHandlers() {
  handle('get-api-key-settings', () => getApiKeySettings(envPath));
  handle('save-api-key', async (provider, key) => {
    if (isBusy()) throw new Error('Wait for the current meeting to finish before changing API keys.');
    return saveApiKey(envPath, provider, key);
  });
  handle('get-status', () => ({ state, message: status, lastNote, envPath }));
  handle('start-recording', async () => {
    if (isBusy()) throw new Error('A meeting is already recording or processing.');
    publish('starting', 'Requesting audio access…');
    try {
      config = loadConfig(envPath);
      await validateRecordingSetup(config);
      recording = await createRecording(notesDirectory);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });
  handle('capture-started', () => {
    if (state !== 'starting') throw new Error('Capture was not requested.');
    publish('recording', 'Recording system audio + microphone');
  });
  handle('append-audio', async data => {
    if (!recording?.handle || !['starting', 'recording'].includes(state)) throw new Error('Recording is not open.');
    if (!(data instanceof Uint8Array) || data.byteLength > 16 * 1024 * 1024) throw new Error('Invalid audio chunk.');
    await recording.handle.writeFile(data);
  });
  handle('capture-failed', async message => {
    if (typeof message !== 'string') throw new Error('Invalid capture error.');
    if (recording?.handle) {
      await recording.handle.close();
      recording.handle = null;
    }
    reportError(new Error(`${message.slice(0, 2000)}${recording ? ` Audio retained at ${recording.audioPath}.` : ''}`));
  });
  handle('finish-recording', finishRecording);
  handle('retry-recording', async () => {
    if (isBusy()) throw new Error('Wait for the current meeting to finish.');
    const previous = { state, status };
    publish('processing', 'Select a recording to retry…');
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: 'Retry saved meeting audio', defaultPath: notesDirectory,
        properties: ['openFile'], filters: [{ name: 'Meeting recording', extensions: ['webm'] }],
      });
      if (canceled) { publish(previous.state, previous.status); return; }
      const audioPath = filePaths[0];
      publish('processing', 'Retrying saved recording…');
      config = loadConfig(envPath);
      lastNote = await processRecording({ audioPath, base: audioPath.slice(0, -5) }, config, message => publish('processing', message));
      recording = null;
      publish('idle', `Saved ${path.basename(lastNote)}`);
    } catch (error) {
      reportError(error);
      throw error;
    }
  });
  handle('open-folder', openNotesDirectory);
  handle('open-note', async () => {
    if (!lastNote) return;
    const error = await shell.openPath(lastNote);
    if (error) throw new Error(error);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) showWindow(); });
  app.whenReady().then(async () => {
    if (process.platform !== 'darwin' || !supportsSystemAudio(process.getSystemVersion())) {
      throw new Error('Meeting Notes requires macOS Sonoma 14.2 or later for native system audio capture.');
    }
    app.dock.hide();
    window = new BrowserWindow({
      width: 460, height: 650, show: false, resizable: false,
      title: 'Meeting Notes', backgroundColor: '#f5f3ed',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    });
    window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === window.webContents && ['media', 'display-capture'].includes(permission) && ['starting', 'recording'].includes(state));
    });
    session.defaultSession.setPermissionCheckHandler((contents, permission) =>
      contents === window.webContents && ['media', 'display-capture'].includes(permission));
    session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
      if (request.frame !== window.webContents.mainFrame || state !== 'starting') { callback({}); return; }
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
        if (!sources.length) throw new Error('No screen source available. Grant Screen & System Audio Recording permission.');
        callback({ video: sources[0], audio: 'loopback' });
      } catch (error) {
        callback({});
        window.webContents.send('capture-error', error.message);
      }
    });
    const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'tray.png')).resize({ width: 22, height: 22 });
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', showWindow);
    registerHandlers();
    await window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
    publish('idle', 'Ready to record');
    showWindow();
  }).catch(error => { dialog.showErrorBox('Meeting Notes could not start', error.message); quitting = true; app.quit(); });
}

function supportsSystemAudio(version) {
  const [major, minor] = version.split('.').map(Number);
  return major > 14 || (major === 14 && minor >= 2);
}
app.on('before-quit', event => { if (isBusy()) { event.preventDefault(); showWindow(); } });
app.on('window-all-closed', () => {});
