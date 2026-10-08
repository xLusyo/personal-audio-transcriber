const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function boot(version) {
  const errors = [];
  const handlers = new Map();
  const permissionHandlers = {};
  let window;
  let done;
  const completed = new Promise(resolve => { done = resolve; });
  class Window {
    constructor() {
      window = this;
      this.webContents = {
        mainFrame: {}, setWindowOpenHandler() {}, on() {}, send() {},
      };
    }
    on() {}
    show() {}
    focus() {}
    async loadFile(file) { assert.ok(fs.existsSync(file)); }
  }
  const electron = {
    app: {
      getPath: () => '/tmp', getAppPath: () => path.resolve(__dirname, '..'),
      requestSingleInstanceLock: () => true,
      on() {}, dock: { hide() {} }, quit() { done(); },
      whenReady: () => Promise.resolve(),
    },
    BrowserWindow: Window,
    Tray: class { setTitle() {} setToolTip() {} on() {} setContextMenu() { done(); } },
    Menu: { buildFromTemplate: value => value },
    nativeImage: { createFromPath: () => ({ resize() { return this; }, setTemplateImage() {} }) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    desktopCapturer: { getSources: async () => [{ id: 'screen:0' }] },
    session: { defaultSession: {
      setPermissionRequestHandler: handler => { permissionHandlers.request = handler; },
      setPermissionCheckHandler: handler => { permissionHandlers.check = handler; },
      setDisplayMediaRequestHandler: handler => { permissionHandlers.display = handler; },
    } },
    shell: {},
    dialog: { showErrorBox: (title, message) => errors.push(message) },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main.js'), 'utf8'), {
    require: name => name === 'electron' ? electron : require(name.startsWith('.') ? path.resolve(__dirname, '../src', name) : name),
    process: { platform: 'darwin', getSystemVersion: () => version },
    __dirname: path.resolve(__dirname, '../src'),
    Uint8Array,
  });
  return { completed, errors, handlers, permissionHandlers, getWindow: () => window };
}

test('main boots with Electron process OS API and scopes permissions and IPC to its window', async () => {
  const app = boot('14.2.0');
  await app.completed;
  assert.deepEqual(app.errors, []);
  const window = app.getWindow();
  const status = await app.handlers.get('get-status')({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
  assert.equal(status.state, 'idle');
  assert.throws(() => app.handlers.get('get-status')({ sender: {}, senderFrame: {} }), /Untrusted/);
  assert.equal(app.permissionHandlers.check({}, 'media'), false);
  assert.equal(app.permissionHandlers.check(window.webContents, 'geolocation'), false);
  let response;
  await app.permissionHandlers.display({ frame: window.webContents.mainFrame }, value => { response = value; });
  assert.deepEqual(Object.keys(response), []);
});

test('main rejects macOS versions before native system audio support', async () => {
  const app = boot('14.1.0');
  await app.completed;
  assert.match(app.errors[0], /14.2/);
  assert.equal(app.getWindow(), undefined);
});
