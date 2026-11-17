const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog, Menu, clipboard, nativeTheme, screen, net } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { HOME, ROUTES, httpsUrl, isTikTok, isAuth, layout } = require('./policy.cjs');
const { isMediaUrl, VIDEO_SCRIPT, videoFilename } = require('./video.cjs');
const { normalizePreferences } = require('./preferences.cjs');
const { resolvedTheme, themeCookies, themeCookieValue, siteThemePreference } = require('./theme.cjs');
const { DownloadManager } = require('./downloads.cjs');
const { shortcutCommand, normalizeShortcuts } = require('./shortcuts.cjs');
const { checkUpdates } = require('./updates.cjs');
const { sessionFetch, closeNetwork } = require('./network.cjs');
const { bounded } = require('./async.cjs');
const { DownloadQueue } = require('./queue.cjs');
const { bookmarkUrl, importBookmarks, exportBookmarks } = require('./library.cjs');
const { Diagnostics } = require('./diagnostics.cjs');
const { Permissions, kinds } = require('./permissions.cjs');
const diagnostics = new Diagnostics();
const permissions = new Permissions();
let queue;
let addingToQueue = false;

const smoke = process.argv.includes('--smoke-test');
const profileArg = process.argv.find(argument => argument.startsWith('--smoke-profile='))?.split('=')[1];
const smokeProfile = profileArg && /^[a-z0-9-]{1,60}$/.test(profileArg) ? profileArg : String(process.pid);
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `tikdesk-smoke-${smokeProfile}`));
app.setName('TikDesk');
let win, view, tikSession;
let preferences = normalizePreferences();
let state = { mode: 'mobile', loading: true, error: '', url: HOME, canGoBack: false, canGoForward: false, muted: false };
const popups = new Set();
let modalOpen = false;
let remoteReady = false;
let downloads;
let preparingDownload = false;
let preparingController;
let closeConfirmation = false;
let siteDownloads = new Set();
let bookmarks = [];
let lastVideoDownload;
const shellUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const securePreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false };
let saveQueue = Promise.resolve();
let themeQueue = Promise.resolve();
let themeCookieTimer;
let pendingThemeDomain;
let writingThemeCookies = false;
const ownThemeCookies = new Map();
let themeInteractionUntil = 0;
let quitting = false;

function broadcast(update = {}) {
  state = { ...state, ...update, version: app.getVersion(), theme: preferences.theme, effectiveTheme: resolvedTheme(preferences.theme, nativeTheme.shouldUseDarkColors), downloads: downloads?.list() || [], queue: queue?.snapshot() || { paused: true, rows: [] }, permissions: permissions.list(), shortcuts: preferences.shortcuts, bookmarks, downloadDirectory: preferences.downloadDirectory, startup: preferences.startup };
  if (view?.webContents && !view.webContents.isDestroyed()) {
    const wc = view.webContents;
    state.url = wc.getURL() || HOME;
    state.canGoBack = wc.navigationHistory.canGoBack();
    state.canGoForward = wc.navigationHistory.canGoForward();
  }
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
  delete state.notice;
}
async function syncTikTokTheme() {
  const theme = resolvedTheme(preferences.theme, nativeTheme.shouldUseDarkColors);
  const preference = preferences.theme;
  themeQueue = themeQueue.catch(() => {}).then(async () => {
    writingThemeCookies = true;
    try {
      for (const cookie of themeCookies(theme, preference)) {
        ownThemeCookies.set(`${cookie.domain.replace(/^\./, '')}|${cookie.name}`, cookie.value);
        await tikSession.cookies.set(cookie);
      }
    } finally { writingThemeCookies = false; }
    await tikSession.cookies.flushStore();
  });
  return themeQueue;
}
async function setTheme(theme) {
  clearTimeout(themeCookieTimer); pendingThemeDomain = null;
  preferences.theme = theme;
  nativeTheme.themeSource = theme;
  broadcast();
  await syncTikTokTheme();
  await savePreferences();
}
async function adoptTikTokTheme(domain) {
  if (!tikSession || !domain) return;
  const cookies = await tikSession.cookies.get({ url: HOME });
  const source = themeCookieValue(cookies, 'tiktok_webapp_theme_source', domain);
  const theme = themeCookieValue(cookies, 'tiktok_webapp_theme', domain);
  const selected = siteThemePreference(source, theme);
  if (selected && selected !== preferences.theme) {
    preferences.theme = selected; nativeTheme.themeSource = selected;
    broadcast(); await savePreferences(); await tikSession.cookies.flushStore();
  }
}
function savePreferences() {
  return saveJson('preferences.json', preferences).catch(error => { diagnostics.record('storage', error); broadcast({ notice: 'Nie udało się zapisać ustawień. Sprawdź wolne miejsce i uprawnienia do profilu.' }); throw error; });
}
function saveJson(name, value) {
  const contents = JSON.stringify(value);
  const file = path.join(app.getPath('userData'), name);
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await fs.writeFile(`${file}.tmp`, contents);
    await fs.rename(`${file}.tmp`, file);
  });
  return saveQueue;
}
function restoreView() {
  if (view?.webContents && !view.webContents.isDestroyed()) view.setVisible(!modalOpen && !state.error);
}
function attachShortcuts(contents, popup = false) {
  contents.on('before-input-event', (event, input) => {
    const command = shortcutCommand(input, preferences.shortcuts);
    if (!command) return;
    event.preventDefault();
    if (popup && command === 'reload') { contents.reload(); return; }
    const wc = view.webContents;
    if (command === 'fullscreen') win.setFullScreen(!win.isFullScreen());
    else if (command === 'reload') void navigate(isTikTok(wc.getURL()) ? wc.getURL() : HOME);
    else if (command === 'home') void navigate(HOME);
    else if (command === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
    else if (command === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  });
}
function resize() {
  if (!win || !view || view.webContents.isDestroyed()) return;
  const [width, height] = win.getContentSize();
  const bounds = layout(width, height, preferences.mode);
  view.setBounds(bounds);
  if (!remoteReady) return;
  if (preferences.mode === 'mobile') {
    view.webContents.enableDeviceEmulation({ screenPosition: 'mobile', screenSize: { width: bounds.width, height: bounds.height }, viewSize: { width: bounds.width, height: bounds.height }, deviceScaleFactor: 1, scale: 1 });
  } else view.webContents.disableDeviceEmulation();
}
function setMode(mode) {
  preferences.mode = mode;
  const chrome = process.versions.chrome;
  const agent = mode === 'mobile'
    ? `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Mobile Safari/537.36`
    : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  view.webContents.setUserAgent(agent);
  resize();
  broadcast({ mode });
}
async function external(value) {
  const url = httpsUrl(value);
  if (!url || smoke || !win || win.isDestroyed()) return;
  const { response } = await dialog.showMessageBox(win, {
    type: 'question', title: 'Otworzyć przeglądarkę?',
    message: `Otworzyć stronę ${url.hostname} w domyślnej przeglądarce?`,
    detail: 'Logowanie w zewnętrznej przeglądarce nie przenosi sesji do TikDesk.',
    buttons: ['Anuluj', 'Otwórz'], defaultId: 0, cancelId: 0
  });
  if (response === 1) await shell.openExternal(url.href);
}
function secureContents(wc, auth = false) {
  if (!auth) {
    const markThemeInteraction = () => { themeInteractionUntil = Date.now() + 2500; };
    wc.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseDown') markThemeInteraction(); });
    wc.on('before-input-event', (_event, input) => { if (input.type === 'keyDown') markThemeInteraction(); });
  }
  const allowed = auth ? isAuth : isTikTok;
  const guard = (event, url) => {
    if (!allowed(url)) { event.preventDefault(); void external(url); }
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', guard);
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.setWindowOpenHandler(({ url }) => {
    if (isAuth(url)) {
      return { action: 'allow', overrideBrowserWindowOptions: {
        width: 540, height: 780, parent: win, autoHideMenuBar: true,
        title: 'TikDesk — logowanie', webPreferences: { ...securePreferences, session: tikSession, preload: undefined }
      } };
    }
    void external(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', popup => {
    popups.add(popup);
    secureContents(popup.webContents, true);
    popup.on('closed', () => popups.delete(popup));
  });
  attachShortcuts(wc, auth);
}
function configureSession() {
  tikSession = session.fromPartition('persist:tikdesk');
  tikSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    const domain = cookie.domain.replace(/^\./, '');
    if (removed || !['tiktok.com', 'www.tiktok.com'].includes(domain) || !['tiktok_webapp_theme', 'tiktok_webapp_theme_source'].includes(cookie.name)) return;
    const key = `${domain}|${cookie.name}`;
    if (ownThemeCookies.get(key) === cookie.value) { ownThemeCookies.delete(key); return; }
    if (writingThemeCookies) return;
    // Page initialization can enforce its own mobile colors. Only a recent
    // native interaction in the page may change the saved desktop preference.
    if (Date.now() > themeInteractionUntil) return;
    pendingThemeDomain = cookie.domain;
    clearTimeout(themeCookieTimer);
    themeCookieTimer = setTimeout(async () => {
      try {
        // Own writes are filtered above; page changes adopt all three modes.
        await adoptTikTokTheme(cookie.domain);
        if (pendingThemeDomain === cookie.domain) pendingThemeDomain = null;
      } catch (error) { console.error('Theme persistence:', error.message); }
    }, 250);
  });
  tikSession.setPermissionCheckHandler((_wc, permission, origin, details) => permission === 'fullscreen' ? isTikTok(origin) : permissions.allows(origin, permission, details));
  tikSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc?.getURL() || '';
    if (!isTikTok(origin) || !['media', 'notifications', 'fullscreen'].includes(permission)) return callback(false);
    if (permission === 'fullscreen') return callback(true);
    if (smoke || !win || win.isDestroyed()) return callback(false);
    const label = kinds(permission, details).map(kind => ({ camera: 'aparatu', microphone: 'mikrofonu', notifications: 'powiadomień' })[kind]).join(' i ');
    if (!label) return callback(false);
    try {
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'Uprawnienia TikToka', message: `Zezwolić ${new URL(origin).hostname} na dostęp do ${label}?`, buttons: ['Nie zezwalaj', 'Zezwól w tej sesji'], defaultId: 0, cancelId: 0 });
      if (response === 1) permissions.grant(origin, permission, details);
      broadcast();
      callback(response === 1);
    } catch { callback(false); }
  });
  tikSession.setDevicePermissionHandler(() => false);
  tikSession.on('will-download', (_event, item) => {
    siteDownloads.add(item);
    item.setSaveDialogOptions({ title: 'Zapisz plik z TikToka' });
    item.once('done', (_event, status) => {
      siteDownloads.delete(item);
      broadcast({ notice: status === 'completed' ? 'Plik został zapisany.' : 'Pobieranie anulowane lub nieudane.' });
    });
  });
}
async function downloadVideo(testPath, expectedId, parentSignal) {
  if (preparingDownload || downloads.active) throw new Error('Pobieranie jest już w toku.');
  const wc = view.webContents;
  if (!isTikTok(wc.getURL()) && !smoke) throw new Error('Otwórz film na stronie TikToka.');
  preparingDownload = true;
  preparingController = new AbortController();
  const cancelPreparation = () => { preparingController?.abort(parentSignal.reason); downloads.cancel(); };
  parentSignal?.addEventListener('abort', cancelPreparation, { once: true });
  if (parentSignal?.aborted) cancelPreparation();
  broadcast({ download: { phase: 'preparing', percent: null }, downloadMessage: 'Przygotowywanie pobierania…' });
  try {
    const video = await inspectVideo(preparingController.signal);
    preparingController.signal.throwIfAborted();
    if (video.error) throw new Error(video.error);
    if (expectedId && video.id !== expectedId) throw new Error('To inny film. Otwórz właściwy materiał i spróbuj ponownie.');
    if (!isMediaUrl(video.url)) throw new Error('Film nie ma obsługiwanego adresu HTTPS w sieci TikToka.');
    const sourcePage = isTikTok(video.pageUrl) ? video.pageUrl : wc.getURL();
    const file = testPath || (await dialog.showSaveDialog(win, {
      title: 'Pobierz oglądany film',
      defaultPath: path.join(preferences.downloadDirectory || app.getPath('downloads'), videoFilename(video.id)),
      filters: [{ name: 'Film MP4', extensions: ['mp4'] }], properties: ['showOverwriteConfirmation', 'createDirectory']
    })).filePath;
    preparingController.signal.throwIfAborted();
    if (!file) { broadcast({ download: null, downloadMessage: 'Pobieranie anulowane.' }); return; }
    if (path.extname(file).toLowerCase() !== '.mp4') throw new Error('Wybierz plik z rozszerzeniem .mp4.');
    preferences.downloadDirectory = path.dirname(file); await savePreferences();
    preparingController.signal.throwIfAborted();
    const result = await downloads.start({ url: video.url, filePath: file, pageUrl: sourcePage, videoId: video.id, userAgent: wc.getUserAgent() });
    lastVideoDownload = { status: result.status, bytes: result.bytes, error: result.error };
    const message = result.status === 'completed' ? result.error || 'Film zapisany na dysku.' : result.error;
    broadcast({ download: null, downloadMessage: message, notice: message });
    if (result.status !== 'completed') diagnostics.record('download', new Error(result.error));
    return result;
  } catch (error) {
    diagnostics.record('download', error);
    broadcast({ download: null, downloadMessage: error.message });
    throw error;
  } finally { parentSignal?.removeEventListener('abort', cancelPreparation); preparingDownload = false; preparingController = null; }
}

async function inspectVideo(signal) {
  const wc = view.webContents;
  try { return await bounded(wc.executeJavaScript(VIDEO_SCRIPT), { signal, timeoutMs: 8000, message: 'Odtwarzacz nie odpowiada. Odśwież stronę i spróbuj ponownie.' }); }
  catch (error) {
    if (error.code === 'TIMEOUT' && !wc.isDestroyed()) wc.forcefullyCrashRenderer();
    throw error;
  }
}

async function confirm(message, detail) {
  if (smoke) return false;
  const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'TikDesk', message, detail, buttons: ['Anuluj', 'Potwierdź'], defaultId: 0, cancelId: 0 });
  return response === 1;
}
async function addToQueue() {
  if (addingToQueue) throw new Error('Wybierz najpierw plik dla poprzedniego zadania.');
  addingToQueue = true;
  try {
    const video = await inspectVideo();
    if (!video.id || !isTikTok(video.pageUrl) || !isMediaUrl(video.url)) throw new Error('Otwórz szczegóły filmu, aby dodać go do kolejki.');
    const result = await dialog.showSaveDialog(win, { title: 'Dodaj film do kolejki', defaultPath: path.join(preferences.downloadDirectory || app.getPath('downloads'), videoFilename(video.id)), filters: [{ name: 'Film MP4', extensions: ['mp4'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
    if (result.filePath) { await queue.add({ videoId: video.id, pageUrl: video.pageUrl, filePath: result.filePath }); broadcast({ notice: 'Film dodany do kolejki. Uruchom ją w panelu Pobrane filmy.' }); }
  } finally { addingToQueue = false; }
}
async function runQueuedDownload(row, signal) {
  if (preparingDownload || downloads.active) throw new Error('Inne pobieranie jest w toku.');
  signal.throwIfAborted();
  if (await fs.stat(row.filePath).catch(() => null)) if (!(await confirm('Zastąpić istniejący plik?', path.basename(row.filePath)))) throw new Error('Nie zastąpiono istniejącego pliku.');
  await bounded(navigate(row.pageUrl), { signal, timeoutMs: 30000 });
  const deadline = Date.now() + 10000;
  do {
    signal.throwIfAborted(); const video = await inspectVideo(signal);
    if (video.id === row.videoId && isMediaUrl(video.url)) return downloadVideo(row.filePath, row.videoId, signal);
    await bounded(new Promise(resolve => setTimeout(resolve, 200)), { signal });
  } while (Date.now() < deadline);
  throw new Error('Nie znaleziono właściwego filmu. Spróbuj ponownie z jego strony.');
}

async function navigate(url) {
  if (!isTikTok(url)) throw new Error('Wklej adres HTTPS z domeny tiktok.com.');
  broadcast({ error: '', loading: true });
  view.setVisible(!modalOpen);
  try { await bounded(view.webContents.loadURL(url), { timeoutMs: 30000, message: 'Strona nie odpowiedziała w ciągu 30 sekund.' }); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) failed(error.message); }
}
function failed(message) {
  diagnostics.record('navigation', new Error(message));
  if (!view || view.webContents.isDestroyed()) return;
  view.setVisible(false);
  broadcast({ loading: false, error: `Nie udało się otworzyć TikToka. Sprawdź połączenie i spróbuj ponownie. ${message}` });
}
async function createWindow() {
  let hasSavedTheme = false;
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8'));
    preferences = normalizePreferences(saved);
    hasSavedTheme = ['dark', 'light', 'system'].includes(saved.theme);
  } catch { /* Pierwsze uruchomienie lub uszkodzone ustawienia: użyj wartości domyślnych. */ }
  configureSession();
  if (!hasSavedTheme) {
    const cookies = await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' });
    const theme = themeCookieValue(cookies, 'tiktok_webapp_theme');
    if (['dark', 'light'].includes(theme)) preferences.theme = theme;
  }
  nativeTheme.themeSource = preferences.theme;
  await syncTikTokTheme();
  const readJson = async name => { try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), name), 'utf8')); } catch { return []; } };
  const savedBookmarks = await readJson('bookmarks.json');
  bookmarks = (Array.isArray(savedBookmarks) ? savedBookmarks : []).filter(row => row && typeof row.id === 'string' && typeof row.title === 'string' && isTikTok(row.url)).slice(0, 100);
  downloads = new DownloadManager({
    fetch: (url, options) => sessionFetch(tikSession, url, options),
    persist: rows => saveJson('downloads.json', rows),
    onChange: (_rows, active) => broadcast({ download: active ? { phase: active.status, percent: active.percent } : preparingDownload ? { phase: 'validating', percent: null } : null })
  });
  downloads.restore(await readJson('downloads.json'));
  await downloads.refreshFiles();
  queue = new DownloadQueue({ run: runQueuedDownload, cancel: () => { preparingController?.abort(new Error('Zadanie anulowane.')); downloads.cancel(); }, persist: rows => saveJson('queue.json', rows), onChange: () => broadcast() });
  queue.restore(await readJson('queue.json'));
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({ width: Math.min(preferences.window.width, Math.max(800, area.width)), height: Math.min(preferences.window.height, Math.max(640, area.height)), minWidth: 800, minHeight: 640, backgroundColor: '#0b0d12', title: 'TikDesk', autoHideMenuBar: true, icon: path.join(__dirname, '../assets/icon.ico'), webPreferences: { ...securePreferences, preload: path.join(__dirname, 'preload.cjs') } });
  attachShortcuts(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  view = new WebContentsView({ webPreferences: { ...securePreferences, session: tikSession } });
  view.setBackgroundColor('#000000');
  win.contentView.addChildView(view);
  secureContents(view.webContents);
  const wc = view.webContents;
  wc.setAudioMuted(preferences.muted);
  state.muted = preferences.muted;
  wc.on('did-start-loading', () => { themeInteractionUntil = 0; broadcast({ loading: true, error: '' }); restoreView(); });
  wc.on('did-stop-loading', () => broadcast({ loading: false }));
  const navigated = () => {
    if (isTikTok(wc.getURL()) && !/^\/(login|auth|passport)(\/|$)/.test(new URL(wc.getURL()).pathname)) preferences.lastUrl = wc.getURL();
    broadcast({ error: '' }); restoreView();
  };
  wc.on('did-navigate', navigated);
  wc.on('did-navigate-in-page', navigated);
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) failed(description);
  });
  wc.on('render-process-gone', () => failed('Proces strony został zakończony.'));
  win.on('resize', resize);
  win.on('close', event => {
    if (!quitting && (preparingDownload || downloads.active || queue?.active || siteDownloads.size)) {
      event.preventDefault();
      if (!closeConfirmation) {
        closeConfirmation = true;
        void dialog.showMessageBox(win, { type: 'question', title: 'Pobieranie w toku', message: 'Trwa pobieranie. Anulować je i zamknąć aplikację?', buttons: ['Zostań', 'Anuluj pobieranie i zamknij'], defaultId: 0, cancelId: 0 }).then(async ({ response }) => {
          if (response === 1) {
            await queue.setPaused(true);
            if (queue.active) void queue.cancel(queue.active.row.id).catch(error => diagnostics.record('storage', error));
            preparingController?.abort(new Error('Pobieranie anulowane.')); downloads.cancel();
            for (const item of siteDownloads) item.cancel();
            const deadline = Date.now() + 3000;
            while ((preparingDownload || downloads.active || queue.active || siteDownloads.size) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 40));
            if (preparingDownload || downloads.active || queue.active || siteDownloads.size) { app.exit(0); return; }
            app.quit();
          }
        }).catch(error => { diagnostics.record('application', error); broadcast({ notice: 'Nie udało się zakończyć pobierania. Spróbuj ponownie.' }); }).finally(() => { closeConfirmation = false; });
      }
      return;
    }
    const bounds = win.getNormalBounds();
    preferences.window = { width: bounds.width, height: bounds.height, maximized: win.isMaximized() };
    if (!quitting) void savePreferences().catch(() => {});
    tikSession.flushStorageData();
  });
  win.on('closed', () => {
    for (const popup of popups) popup.destroy();
    if (!wc.isDestroyed()) wc.close();
    win = null;
  });
  await win.loadFile(path.join(__dirname, 'index.html'));
  // Chromium must have a live renderer before enabling device emulation.
  await wc.loadURL('about:blank');
  remoteReady = true;
  if (preferences.window.maximized) win.maximize();
  setMode(preferences.mode);
  if (smoke) {
    if (app.isPackaged) return verifyPackage();
    const context = { app, win, view, tikSession, nativeTheme, dialog, area, setTheme, setMode, broadcast, failed, navigate, downloadVideo, savePreferences, saveJson, downloads, queue, permissions,
      get preferences() { return preferences; }, get state() { return state; }, get bookmarks() { return bookmarks; }, set bookmarks(value) { bookmarks = value; },
      get preparingDownload() { return preparingDownload; }, set preparingDownload(value) { preparingDownload = value; }, get closeConfirmation() { return closeConfirmation; }, get lastVideoDownload() { return lastVideoDownload; } };
    const tests = require('../scripts/smoke.cjs');
    if (await tests.preferencePhase(context)) return;
    return tests.runSmoke(context);
  }
  void navigate(preferences.startup === 'last' && isTikTok(preferences.lastUrl) ? preferences.lastUrl : HOME).then(() => { if (!wc.isDestroyed()) { wc.navigationHistory.clear(); broadcast(); } });
}
ipcMain.handle('command', async (event, command, value) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellUrl) throw new Error('Niedozwolone wywołanie.');
  const wc = view.webContents;
  try {
    switch (command) {
      case 'state': broadcast(); break;
      case 'dialog': modalOpen = value === true; view.setVisible(!modalOpen && !state.error); break;
      case 'libraries-refresh': await downloads.refreshFiles(); break;
      case 'download-remove':
        if (await confirm('Usunąć wpis z historii?', 'Plik filmu pozostanie na dysku. Ewentualny częściowy plik tego zadania zostanie usunięty.')) await downloads.remove(value);
        break;
      case 'downloads-clear':
        if (await confirm('Wyczyścić historię pobrań?', 'Usunie zakończone wpisy i ich częściowe pliki. Zapisane filmy pozostaną na dysku.')) for (const row of downloads.list()) if (row.id !== downloads.active?.record.id) await downloads.remove(row.id);
        break;
      case 'download-cleanup':
        if (await confirm('Usunąć częściowy plik?', 'Dotyczy tylko pliku tymczasowego tego zadania.')) await downloads.cleanup(value);
        break;
      case 'queue-add': await addToQueue(); break;
      case 'queue-pause': await queue.setPaused(true); break;
      case 'queue-start': if (preparingDownload || downloads.active) throw new Error('Poczekaj na zakończenie bieżącego pobierania.'); await queue.setPaused(false); break;
      case 'queue-cancel': await queue.cancel(value); break;
      case 'queue-remove': await queue.remove(value); break;
      case 'diagnostics': broadcast({ diagnosticReport: diagnostics.report({ version: app.getVersion(), versions: process.versions, platform: process.platform, downloads: downloads.records.length, queued: queue.rows.filter(row => row.status === 'queued').length }) }); break;
      case 'diagnostics-copy': clipboard.writeText(diagnostics.report({ version: app.getVersion(), versions: process.versions, platform: process.platform, downloads: downloads.records.length, queued: queue.rows.filter(row => row.status === 'queued').length })); broadcast({ notice: 'Raport diagnostyczny skopiowany.' }); break;
      case 'privacy-refresh': broadcast({ cacheBytes: await tikSession.getCacheSize() }); break;
      case 'cache-clear': if (await confirm('Wyczyścić pamięć podręczną?', 'Zachowa sesję konta, zakładki i pobrane filmy.')) { await tikSession.clearCache(); broadcast({ cacheBytes: await tikSession.getCacheSize(), notice: 'Pamięć podręczna wyczyszczona.' }); } break;
      case 'permission-revoke': {
        const row = permissions.revoke(value);
        broadcast();
        if (row) { for (const popup of popups) if (isTikTok(popup.webContents.getURL())) popup.webContents.reload(); await navigate(isTikTok(wc.getURL()) ? wc.getURL() : HOME); }
        break;
      }
      case 'shortcuts-save': preferences.shortcuts = normalizeShortcuts(value); await savePreferences(); broadcast({ notice: 'Skróty zapisane.' }); break;
      case 'shortcuts-reset': preferences.shortcuts = normalizeShortcuts(); await savePreferences(); broadcast({ notice: 'Przywrócono skróty domyślne.' }); break;
      case 'bookmark-export': {
        const result = await dialog.showSaveDialog(win, { title: 'Eksportuj zakładki', defaultPath: path.join(app.getPath('documents'), 'TikDesk-zakladki.json'), filters: [{ name: 'Zakładki JSON', extensions: ['json'] }] });
        if (result.filePath) { await fs.writeFile(result.filePath, exportBookmarks(bookmarks), 'utf8'); broadcast({ notice: 'Zakładki wyeksportowane.' }); } break;
      }
      case 'bookmark-import': {
        const result = await dialog.showOpenDialog(win, { title: 'Importuj zakładki', filters: [{ name: 'Zakładki JSON', extensions: ['json'] }], properties: ['openFile'] });
        if (!result.canceled && result.filePaths[0]) {
          const file = await fs.open(result.filePaths[0], 'r'); let text;
          try { if ((await file.stat()).size > 1024 * 1024) throw new Error('Plik przekracza 1 MB.'); const buffer = Buffer.alloc(1024 * 1024 + 1); const read = await file.read(buffer); if (read.bytesRead > 1024 * 1024) throw new Error('Plik przekracza 1 MB.'); text = buffer.subarray(0, read.bytesRead).toString('utf8'); } finally { await file.close(); }
          const imported = importBookmarks(text, bookmarks);
          if (await confirm('Zaimportować zakładki?', `Nowe: ${imported.added}. Pominięte duplikaty: ${imported.duplicates}.`)) { await saveJson('bookmarks.json', imported.rows); bookmarks = imported.rows; broadcast(); }
        } break;
      }
      case 'navigate':
        if (!Object.hasOwn(ROUTES, value)) throw new Error('Nieznany widok.');
        if (value === 'upload' || value === 'login') { setMode('desktop'); await savePreferences(); }
        await navigate(ROUTES[value]); break;
      case 'open-link': await navigate(typeof value === 'string' ? value.trim() : ''); break;
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'reload': await navigate(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'mode':
        if (!['mobile', 'desktop'].includes(value)) throw new Error('Nieznany tryb.');
        setMode(value); await savePreferences(); await navigate(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'theme':
        if (!['dark', 'light', 'system'].includes(value)) throw new Error('Nieznany motyw.');
        await setTheme(value); await navigate(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'mute': wc.setAudioMuted(!wc.isAudioMuted()); preferences.muted = wc.isAudioMuted(); broadcast({ muted: preferences.muted }); await savePreferences(); break;
      case 'fullscreen': win.setFullScreen(!win.isFullScreen()); break;
      case 'copy-link': {
        const video = await inspectVideo();
        if (!isTikTok(video.pageUrl)) throw new Error('Nie znaleziono linku do filmu. Otwórz jego szczegóły i spróbuj ponownie.');
        clipboard.writeText(video.pageUrl); broadcast({ notice: 'Link do filmu skopiowany.' }); break;
      }
      case 'browser': await external(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'download': if (queue.active) throw new Error('Poczekaj na kolejkę lub ją wstrzymaj.'); await downloadVideo(); break;
      case 'cancel-download': preparingController?.abort(new Error('Pobieranie anulowane.')); downloads.cancel(); break;
      case 'download-open':
      case 'download-folder': {
        const row = downloads.records.find(row => row.id === value && row.status === 'completed');
        if (!row) throw new Error('Nie znaleziono pobranego filmu.');
        await fs.access(row.filePath);
        if (command === 'download-folder') shell.showItemInFolder(row.filePath);
        else { const error = await shell.openPath(row.filePath); if (error) throw new Error(error); }
        break;
      }
      case 'download-retry': {
        const row = downloads.records.find(row => row.id === value);
        if (!row || !row.videoId || !isTikTok(row.pageUrl)) throw new Error('Otwórz ten film i kliknij Pobierz, aby spróbować ponownie.');
        if (preparingDownload || downloads.active || queue.active) throw new Error('Pobieranie jest już w toku.');
        await navigate(row.pageUrl);
        const deadline = Date.now() + 8000;
        let video;
        do { video = await inspectVideo(); if (video.id === row.videoId && video.url) break; await new Promise(resolve => setTimeout(resolve, 200)); } while (Date.now() < deadline);
        await downloadVideo(undefined, row.videoId); break;
      }
      case 'settings-save': {
        if (!value || !['home', 'last'].includes(value.startup)) throw new Error('Nieprawidłowe ustawienia startu.');
        preferences.startup = value.startup; await savePreferences(); broadcast({ notice: 'Ustawienia zapisane.' }); break;
      }
      case 'download-directory': {
        const selection = await dialog.showOpenDialog(win, { title: 'Folder pobierania', defaultPath: preferences.downloadDirectory || app.getPath('downloads'), properties: ['openDirectory', 'createDirectory'] });
        if (!selection.canceled && selection.filePaths[0]) { preferences.downloadDirectory = selection.filePaths[0]; await savePreferences(); broadcast(); } break;
      }
      case 'bookmark-video':
      case 'bookmark-add': {
        const video = command === 'bookmark-video' ? await inspectVideo() : null;
        const url = bookmarkUrl(video ? video.pageUrl : wc.getURL());
        if (!isTikTok(url) || /^\/(login|auth|passport)(\/|$)/.test(new URL(url).pathname)) throw new Error('Otwórz profil lub stronę TikToka, którą chcesz zapisać.');
        if (bookmarks.some(row => bookmarkUrl(row.url) === url)) throw new Error('Ta strona jest już w zakładkach.');
        if (bookmarks.length >= 100) throw new Error('Możesz zapisać do 100 zakładek.');
        bookmarks.unshift({ id: randomUUID(), title: wc.getTitle().slice(0, 100) || 'TikTok', url });
        await saveJson('bookmarks.json', bookmarks); broadcast(); break;
      }
      case 'bookmark-open': { const row = bookmarks.find(row => row.id === value); if (!row) throw new Error('Nie znaleziono zakładki.'); await navigate(row.url); break; }
      case 'bookmark-remove': bookmarks = bookmarks.filter(row => row.id !== value); await saveJson('bookmarks.json', bookmarks); broadcast(); break;
      case 'check-updates': {
        broadcast({ updateMessage: 'Sprawdzanie aktualizacji…' });
        try { const update = await checkUpdates((url, options) => net.fetch(url, options), app.getVersion()); broadcast({ updateMessage: update.message, updateAvailable: update.available }); }
        catch (error) { broadcast({ updateMessage: error.message }); } break;
      }
      case 'open-releases': await external('https://github.com/zetmar-collab/TikDesk/releases'); break;
      case 'reset': {
        const { response } = await dialog.showMessageBox(win, { type: 'warning', title: 'Usuń lokalną sesję', message: 'Wylogować konto i usunąć dane TikToka z TikDesk?', detail: 'Usuwa cookies, pamięć strony i lokalną sesję. Twoje konto i opublikowane filmy pozostaną na TikToku.', buttons: ['Anuluj', 'Usuń sesję'], defaultId: 0, cancelId: 0 });
        if (response === 1) {
          await queue.setPaused(true);
          if (queue.active) await queue.cancel(queue.active.row.id);
          preparingController?.abort(new Error('Usuwanie sesji.')); downloads.cancel();
          for (const popup of popups) popup.destroy();
          wc.stop(); await wc.loadURL('about:blank');
          await tikSession.closeAllConnections();
          await tikSession.clearStorageData(); await tikSession.clearCache();
          permissions.clear(); await syncTikTokTheme(); await navigate(HOME);
        }
        break;
      }
      default: throw new Error('Nieznane polecenie.');
    }
    return { ok: true };
  } catch (error) { diagnostics.record(command.includes('download') ? 'download' : command.includes('queue') ? 'queue' : 'application', error); return { ok: false, error: error.message }; }
});

async function verifyPackage() {
  try {
    const check = await view.webContents.executeJavaScript('({ node: typeof require, bridge: typeof window.tikdesk })');
    const local = await win.webContents.executeJavaScript("window.tikdesk.command('state')");
    if (check.node !== 'undefined' || check.bridge !== 'undefined' || !local.ok) throw new Error('Package isolation failed');
    const directory = path.join(process.cwd(), 'artifacts'); await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package-smoke.json'), JSON.stringify({ passed: true, version: app.getVersion(), check }));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  nativeTheme.on('updated', () => {
    broadcast();
    if (tikSession && preferences.theme === 'system') void syncTikTokTheme().catch(error => console.error(error.message));
  });
  app.on('before-quit', event => {
    if (quitting) return;
    if (preparingDownload || downloads?.active || queue?.active || siteDownloads.size) {
      event.preventDefault();
      if (win && !closeConfirmation) win.close();
      return;
    }
    event.preventDefault();
    quitting = true;
    clearTimeout(themeCookieTimer);
    if (win && !win.isDestroyed()) {
      const bounds = win.getNormalBounds();
      preferences.window = { width: bounds.width, height: bounds.height, maximized: win.isMaximized() };
      void savePreferences().catch(() => {});
    }
    bounded((async () => {
      await adoptTikTokTheme(pendingThemeDomain);
      await savePreferences();
      await themeQueue;
      await tikSession?.cookies.flushStore();
      await bounded(closeNetwork(), { timeoutMs: 1000 }).catch(() => {});
    })(), { timeoutMs: 5000 }).catch(async error => { diagnostics.record('storage', error); if (!smoke) await dialog.showMessageBox({ type: 'error', title: 'Ustawienia nie zostały zapisane', message: 'Sprawdź wolne miejsce i uprawnienia do profilu aplikacji. Ostatnie zmiany mogą nie przetrwać restartu.' }); }).finally(() => app.quit());
  });
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); return createWindow(); }).catch(error => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
