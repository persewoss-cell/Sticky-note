// Windows 데스크톱 앱 (Electron)
//  - 노트 목록 창 1개 + 메모마다 별도 창 (바탕화면에 붙여두는 스티커 메모)
//  - 창 위치/크기 기억, 다음 실행 때 열려 있던 메모 복원
//  - 트레이 아이콘, Windows 시작 시 자동 실행, 전역 단축키 Ctrl+Alt+N
const { app, BrowserWindow, ipcMain, protocol, net, Tray, Menu, screen, globalShortcut, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const crypto = require('crypto');

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const DIST = path.join(__dirname, '..', 'dist');
const START_HIDDEN = process.argv.includes('--hidden');

// app:// 프로토콜: IndexedDB(오프라인 캐시, 로그인 유지)가 동작하는 안전한 출처로 앱을 제공
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('app.stickynote.sync');

/* ───────── 상태 저장 (창 위치, 열린 메모, 설정) ───────── */
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
let state = { list: { bounds: null }, notes: {}, settings: { alwaysOnTop: false, launchAtStartup: true } };
function loadState() {
  try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) }; } catch {}
}
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 1)); } catch (e) { console.error(e); }
  }, 300);
}

const pageUrl = (hash = '') => (DEV_URL ? DEV_URL : 'app://local/index.html') + (hash ? '#' + hash : '');

function visibleBounds(b) {
  // 모니터 구성이 바뀌어 화면 밖으로 나간 창은 안쪽으로
  if (!b) return null;
  const d = screen.getDisplayMatching(b).workArea;
  const inside = b.x < d.x + d.width - 40 && b.x + b.width > d.x + 40 && b.y >= d.y - 10 && b.y < d.y + d.height - 40;
  return inside ? b : { ...b, x: d.x + 60, y: d.y + 60 };
}

const baseWebPrefs = {
  preload: path.join(__dirname, 'preload.cjs'),
  contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false,
};

function trackBounds(win, onChange) {
  const save = () => { if (!win.isDestroyed() && !win.isMinimized()) { onChange(win.getBounds()); saveState(); } };
  win.on('moved', save); win.on('resized', save); win.on('move', save); win.on('resize', save);
}

function guardNavigation(win) {
  // 메모 안의 링크는 기본 브라우저로 열기
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

/* ───────── 노트 목록 창 ───────── */
let listWin = null;
function openList() {
  if (listWin && !listWin.isDestroyed()) { if (listWin.isMinimized()) listWin.restore(); listWin.show(); listWin.focus(); return listWin; }
  const b = visibleBounds(state.list.bounds) || (() => {
    const wa = screen.getPrimaryDisplay().workArea;
    return { width: 360, height: 620, x: wa.x + wa.width - 400, y: wa.y + 60 };
  })();
  listWin = new BrowserWindow({
    ...b, minWidth: 300, minHeight: 360, frame: false, show: false, title: '스티커 메모',
    backgroundColor: '#ffffff', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: baseWebPrefs,
  });
  guardNavigation(listWin);
  listWin.loadURL(pageUrl());
  listWin.once('ready-to-show', () => listWin.show());
  trackBounds(listWin, (bounds) => (state.list.bounds = bounds));
  listWin.on('closed', () => { listWin = null; });
  return listWin;
}

/* ───────── 메모 창 ───────── */
const noteWins = new Map();
let quitting = false;

function openNote(id, { isNew = false, near = null, focus = true } = {}) {
  const existing = noteWins.get(id);
  if (existing && !existing.isDestroyed()) { if (existing.isMinimized()) existing.restore(); existing.show(); existing.focus(); return existing; }

  const saved = state.notes[id]?.bounds;
  let b = visibleBounds(saved);
  if (!b) {
    const wa = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const base = near && !near.isDestroyed() ? near.getBounds() : { x: wa.x + 80, y: wa.y + 80, width: 0 };
    b = { width: 320, height: 320, x: Math.min(base.x + 30, wa.x + wa.width - 340), y: Math.min(base.y + 30, wa.y + wa.height - 340) };
  }
  const win = new BrowserWindow({
    ...b, minWidth: 220, minHeight: 160, frame: false, show: false, title: '메모',
    alwaysOnTop: !!state.settings.alwaysOnTop, backgroundColor: '#FFF7D1',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: baseWebPrefs,
  });
  guardNavigation(win);
  win.loadURL(pageUrl('note=' + id + (isNew ? '&new=1' : '')));
  win.once('ready-to-show', () => (focus ? win.show() : win.showInactive()));
  noteWins.set(id, win);
  state.notes[id] = { ...(state.notes[id] || {}), open: true, bounds: b };
  saveState();
  trackBounds(win, (bounds) => (state.notes[id] = { ...(state.notes[id] || {}), bounds }));
  win.on('closed', () => {
    noteWins.delete(id);
    // 앱 종료 중이면 '열림' 상태 유지 → 다음 실행 때 다시 띄움
    if (!quitting && state.notes[id]) { state.notes[id].open = false; saveState(); }
  });
  return win;
}

/* ───────── IPC ───────── */
ipcMain.on('note:new', (e) => openNote(crypto.randomUUID().replace(/-/g, ''), { isNew: true, near: BrowserWindow.fromWebContents(e.sender) }));
ipcMain.on('note:open', (_e, id) => openNote(String(id)));
ipcMain.on('note:deleted', (_e, id) => {
  const w = noteWins.get(id); if (w && !w.isDestroyed()) w.close();
  delete state.notes[id]; saveState();
});
ipcMain.on('list:open', () => openList());
ipcMain.on('window:close', (e) => {
  BrowserWindow.fromWebContents(e.sender)?.close();
});
ipcMain.on('notes:closeAll', () => { for (const w of noteWins.values()) if (!w.isDestroyed()) w.close(); });
ipcMain.handle('settings:get', () => ({ ...state.settings, launchAtStartup: app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin }));
ipcMain.handle('settings:set', (_e, key, value) => {
  if (!['alwaysOnTop', 'launchAtStartup'].includes(key)) return;
  state.settings[key] = !!value; saveState();
  if (key === 'alwaysOnTop') for (const w of noteWins.values()) if (!w.isDestroyed()) w.setAlwaysOnTop(!!value);
  if (key === 'launchAtStartup') applyLoginItem();
});
function applyLoginItem() {
  if (!app.isPackaged) return; // 개발 중에는 등록하지 않음
  app.setLoginItemSettings({ openAtLogin: !!state.settings.launchAtStartup, args: ['--hidden'] });
}

/* ───────── 트레이 ───────── */
let tray = null;
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('스티커 메모');
  const showAll = () => { let any = false; for (const w of noteWins.values()) if (!w.isDestroyed()) { w.show(); any = true; } if (!any) openList(); };
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '새 메모', accelerator: 'Ctrl+Alt+N', click: () => openNote(crypto.randomUUID().replace(/-/g, ''), { isNew: true }) },
    { label: '노트 목록', click: () => openList() },
    { label: '모든 메모 앞으로 가져오기', click: showAll },
    { type: 'separator' },
    { label: '종료', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => openList());
}

/* ───────── 시작 ───────── */
app.on('second-instance', () => openList());
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* 트레이에 계속 상주 (종료는 트레이 메뉴에서) */ });

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(fs.existsSync(file) ? file : path.join(DIST, 'index.html')).toString());
  });
  Menu.setApplicationMenu(null);
  loadState();
  if (state.settings.launchAtStartup === undefined) state.settings.launchAtStartup = true;
  applyLoginItem();
  createTray();
  globalShortcut.register('CommandOrControl+Alt+N', () => openNote(crypto.randomUUID().replace(/-/g, ''), { isNew: true }));

  const toRestore = Object.entries(state.notes).filter(([, n]) => n.open).map(([id]) => id);
  toRestore.forEach((id) => openNote(id, { focus: false }));
  // Windows 로그인 시 자동 실행(--hidden)이면 메모만 복원하고 목록은 띄우지 않음 (트레이에 상주)
  if (!START_HIDDEN) openList();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
