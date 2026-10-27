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
const { shortcutCommand } = require('./shortcuts.cjs');
const { checkUpdates } = require('./updates.cjs');
const { sessionFetch } = require('./network.cjs');

const smoke = process.argv.includes('--smoke-test');
const profileArg = process.argv.find(argument => argument.startsWith('--smoke-profile='))?.split('=')[1];
const smokeProfile = profileArg && /^[a-z0-9-]{1,60}$/.test(profileArg) ? profileArg : String(process.pid);
if (smoke) app.setPath('userData', path.join(app.getPath('temp'), `tikdesk-smoke-${smokeProfile}`));
app.setName('TikDesk');
let win, view, tikSession;
let preferences = normalizePreferences();
let state = { mode: 'mobile', loading: true, error: '', url: HOME, canGoBack: false, canGoForward: false, muted: false };
const popups = new Set();
const grants = new Set();
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
  state = { ...state, ...update, version: app.getVersion(), theme: preferences.theme, effectiveTheme: resolvedTheme(preferences.theme, nativeTheme.shouldUseDarkColors), downloads: downloads?.list() || [], bookmarks, downloadDirectory: preferences.downloadDirectory, startup: preferences.startup };
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
  return saveJson('preferences.json', preferences);
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
    const command = shortcutCommand(input);
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
  tikSession.setPermissionCheckHandler((_wc, permission, origin) => isTikTok(origin) && grants.has(`${new URL(origin).origin}|${permission}`));
  tikSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const origin = details.requestingUrl || wc.getURL();
    if (!isTikTok(origin) || !['media', 'notifications', 'fullscreen'].includes(permission)) return callback(false);
    if (permission === 'fullscreen') return callback(true);
    if (smoke || !win || win.isDestroyed()) return callback(false);
    const label = permission === 'media' ? 'aparatu i/lub mikrofonu' : 'powiadomień';
    try {
      const { response } = await dialog.showMessageBox(win, { type: 'question', title: 'Uprawnienia TikToka', message: `Zezwolić ${new URL(origin).hostname} na dostęp do ${label}?`, buttons: ['Nie zezwalaj', 'Zezwól w tej sesji'], defaultId: 0, cancelId: 0 });
      if (response === 1) grants.add(`${new URL(origin).origin}|${permission}`);
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
async function downloadVideo(testPath, expectedId) {
  if (preparingDownload || downloads.active) throw new Error('Pobieranie jest już w toku.');
  const wc = view.webContents;
  if (!isTikTok(wc.getURL()) && !smoke) throw new Error('Otwórz film na stronie TikToka.');
  preparingDownload = true;
  preparingController = new AbortController();
  broadcast({ download: { phase: 'preparing', percent: null }, downloadMessage: 'Przygotowywanie pobierania…' });
  try {
    const video = await wc.executeJavaScript(VIDEO_SCRIPT);
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
    const message = result.status === 'completed' ? 'Film zapisany na dysku.' : result.error;
    broadcast({ download: null, downloadMessage: message, notice: message });
  } catch (error) {
    broadcast({ download: null, downloadMessage: error.message });
    throw error;
  } finally { preparingDownload = false; preparingController = null; }
}

async function navigate(url) {
  if (!isTikTok(url)) throw new Error('Wklej adres HTTPS z domeny tiktok.com.');
  broadcast({ error: '', loading: true });
  view.setVisible(!modalOpen);
  try { await view.webContents.loadURL(url); }
  catch (error) { if (!error.message.includes('ERR_ABORTED')) failed(error.message); }
}
function failed(message) {
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
    if (!quitting && (preparingDownload || downloads.active || siteDownloads.size)) {
      event.preventDefault();
      if (!closeConfirmation) {
        closeConfirmation = true;
        void dialog.showMessageBox(win, { type: 'question', title: 'Pobieranie w toku', message: 'Trwa pobieranie. Anulować je i zamknąć aplikację?', buttons: ['Zostań', 'Anuluj pobieranie i zamknij'], defaultId: 0, cancelId: 0 }).then(async ({ response }) => {
          if (response === 1) {
            preparingController?.abort(new Error('Pobieranie anulowane.')); downloads.cancel();
            for (const item of siteDownloads) item.cancel();
            while (preparingDownload || downloads.active || siteDownloads.size) await new Promise(resolve => setTimeout(resolve, 40));
            app.quit();
          }
        }).finally(() => { closeConfirmation = false; });
      }
      return;
    }
    const bounds = win.getNormalBounds();
    preferences.window = { width: bounds.width, height: bounds.height, maximized: win.isMaximized() };
    if (!quitting) void savePreferences();
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
  if (smoke && process.argv.includes('--preferences-write')) {
    await setTheme('light');
    setMode('desktop');
    preferences.muted = true; wc.setAudioMuted(true);
    preferences.startup = 'last';
    preferences.downloadDirectory = path.join(app.getPath('temp'), 'TikDeskSavedDownloads');
    bookmarks = [{ id: randomUUID(), title: 'Test zakładki', url: `${HOME}@test` }];
    await saveJson('bookmarks.json', bookmarks);
    win.setSize(1040, 760);
    await savePreferences();
    win.close();
    return;
  }
  if (smoke && process.argv.includes('--preferences-read')) {
    const [width, height] = win.getSize();
    const cookies = await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' });
    const expectedWidth = Math.min(1040, Math.max(800, area.width));
    const expectedHeight = Math.min(760, Math.max(640, area.height));
    if (preferences.theme !== 'light' || preferences.mode !== 'desktop' || !wc.isAudioMuted() || width !== expectedWidth || height !== expectedHeight || cookies[0]?.value !== 'light') throw new Error('Ustawienia nie przetrwały restartu aplikacji.');
    if (preferences.startup !== 'last' || preferences.downloadDirectory !== path.join(app.getPath('temp'), 'TikDeskSavedDownloads') || bookmarks[0]?.url !== `${HOME}@test`) throw new Error('Nowe ustawienia lub zakładki nie przetrwały restartu.');
    console.log('Preferences restart roundtrip passed.');
    wc.emit('before-mouse-event', {}, { type: 'mouseDown' });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'manual', secure: true });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: 'dark', secure: true });
    win.close();
    return;
  }
  if (smoke && process.argv.includes('--preferences-read-manual')) {
    if (preferences.theme !== 'dark') throw new Error('Motyw zmieniony tuż przed zamknięciem nie został zapisany.');
    console.log('Immediate manual theme restart roundtrip passed.');
    wc.emit('before-mouse-event', {}, { type: 'mouseDown' });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'auto', secure: true });
    win.close(); return;
  }
  if (smoke && process.argv.includes('--preferences-read-system')) {
    if (preferences.theme !== 'system') throw new Error('Systemowy motyw TikToka nie przetrwał restartu.');
    console.log('System theme restart roundtrip passed.');
    win.close(); return;
  }
  if (smoke) return runSmoke();
  void navigate(preferences.startup === 'last' && isTikTok(preferences.lastUrl) ? preferences.lastUrl : HOME).then(() => { if (!wc.isDestroyed()) { wc.navigationHistory.clear(); broadcast(); } });
}
ipcMain.handle('command', async (event, command, value) => {
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== shellUrl) throw new Error('Niedozwolone wywołanie.');
  const wc = view.webContents;
  try {
    switch (command) {
      case 'state': broadcast(); break;
      case 'dialog': modalOpen = value === true; view.setVisible(!modalOpen && !state.error); break;
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
        const video = await wc.executeJavaScript(VIDEO_SCRIPT);
        if (!isTikTok(video.pageUrl)) throw new Error('Nie znaleziono linku do filmu. Otwórz jego szczegóły i spróbuj ponownie.');
        clipboard.writeText(video.pageUrl); broadcast({ notice: 'Link do filmu skopiowany.' }); break;
      }
      case 'browser': await external(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'download': await downloadVideo(); break;
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
        if (preparingDownload || downloads.active) throw new Error('Pobieranie jest już w toku.');
        await navigate(row.pageUrl);
        const deadline = Date.now() + 8000;
        let video;
        do { video = await wc.executeJavaScript(VIDEO_SCRIPT); if (video.id === row.videoId && video.url) break; await new Promise(resolve => setTimeout(resolve, 200)); } while (Date.now() < deadline);
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
      case 'bookmark-add': {
        const url = wc.getURL();
        if (!isTikTok(url) || /^\/(login|auth|passport)(\/|$)/.test(new URL(url).pathname)) throw new Error('Otwórz profil lub stronę TikToka, którą chcesz zapisać.');
        if (bookmarks.some(row => row.url === url)) throw new Error('Ta strona jest już w zakładkach.');
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
          for (const popup of popups) popup.destroy();
          wc.stop(); await wc.loadURL('about:blank');
          await tikSession.closeAllConnections();
          await tikSession.clearStorageData(); await tikSession.clearCache();
          grants.clear(); await syncTikTokTheme(); await navigate(HOME);
        }
        break;
      }
      default: throw new Error('Nieznane polecenie.');
    }
    return { ok: true };
  } catch (error) { return { ok: false, error: error.message }; }
});

async function runSmoke() {
  const directory = path.join(process.cwd(), 'artifacts');
  await fs.mkdir(directory, { recursive: true });
  const errors = [];
  const screenshotWarnings = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  try {
    await wcFixture();
    const checks = await view.webContents.executeJavaScript('({node: typeof require, bridge: typeof window.tikdesk, width: innerWidth, ua: navigator.userAgent})');
    if (checks.node !== 'undefined' || checks.bridge !== 'undefined' || checks.width !== 420) throw new Error(`Sandbox/layout: ${JSON.stringify(checks)}`);
    const ui = await win.webContents.executeJavaScript(`(async () => { const s = await window.tikdesk.command('state'); const invalid = await window.tikdesk.command('open-link', 'https://tiktok.com.evil.invalid'); return { ready: !!document.querySelector('#mode-mobile'), state: s.ok, invalidBlocked: !invalid.ok }; })()`);
    if (!ui.ready || !ui.state || !ui.invalidBlocked) throw new Error(`IPC/UI: ${JSON.stringify(ui)}`);
    const invoke = (name, value) => win.webContents.executeJavaScript(`window.tikdesk.command(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
    const waitFor = async predicate => {
      const end = Date.now() + 5000;
      while (!(await predicate())) {
        if (Date.now() > end) throw new Error('Smoke condition timeout');
        await new Promise(resolve => setTimeout(resolve, 40));
      }
    };
    tikSession.protocol.handle('https', () => new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikDesk navigation fixture</title><h1>Fixture</h1>', { headers: { 'Content-Type': 'text/html' } }));
    await invoke('open-link', `${HOME}test-first`);
    await invoke('open-link', `${HOME}test-second`);
    failed('Test przywracania strony po błędzie.');
    await invoke('back');
    await waitFor(() => view.webContents.getURL() === `${HOME}test-first` && view.getVisible() && !state.error);
    await invoke('forward');
    await waitFor(() => view.webContents.getURL() === `${HOME}test-second`);
    await invoke('navigate', 'home');
    if (view.webContents.getURL() !== HOME) throw new Error('Home navigation failed');
    win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F11' });
    await waitFor(() => win.isFullScreen());
    win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F11' });
    await waitFor(() => !win.isFullScreen());
    await invoke('bookmark-add');
    const added = bookmarks[0];
    if (!added || added.url !== HOME) throw new Error('Zakładka nie została zapisana.');
    if ((await invoke('bookmark-add')).ok) throw new Error('Zduplikowano zakładkę.');
    await invoke('bookmark-open', added.id);
    await invoke('bookmark-remove', added.id);
    if (bookmarks.length) throw new Error('Zakładka nie została usunięta.');
    await invoke('settings-save', { startup: 'last' });
    if (preferences.startup !== 'last') throw new Error('Ustawienia startu nie zostały zapisane.');
    await invoke('settings-save', { startup: 'home' });
    const showMessageBox = dialog.showMessageBox;
    let closeQuestions = 0;
    try {
      dialog.showMessageBox = async () => { closeQuestions++; return { response: 0 }; };
      preparingDownload = true;
      win.close();
      await waitFor(() => closeQuestions === 1 && !closeConfirmation);
      if (win.isDestroyed()) throw new Error('Zamknięto aplikację mimo wybrania Zostań.');
    } finally { preparingDownload = false; dialog.showMessageBox = showMessageBox; }
    await invoke('theme', 'light');
    if (await win.webContents.executeJavaScript('document.documentElement.dataset.theme') !== 'light') throw new Error('Light shell theme failed');
    await invoke('theme', 'dark');
    await invoke('mute');
    const savedPreferences = normalizePreferences(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')));
    if (savedPreferences.theme !== 'dark' || !savedPreferences.muted || !view.webContents.isAudioMuted()) throw new Error('Preferences not saved');
    const themeCookie = (await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' }))[0];
    if (themeCookie?.value !== 'dark') throw new Error('TikTok appearance cookie not saved');
    view.webContents.emit('before-mouse-event', {}, { type: 'mouseDown' });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'manual', secure: true });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: 'light', secure: true });
    await waitFor(() => preferences.theme === 'light');
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'auto', secure: true });
    await waitFor(() => preferences.theme === 'system');
    await invoke('theme', 'dark');
    await new Promise(resolve => setTimeout(resolve, 350));
    if (preferences.theme !== 'dark') throw new Error('Własny zapis cookies nadpisał motyw.');
    const invalidTheme = await invoke('theme', 'invalid');
    if (invalidTheme.ok || preferences.theme !== 'dark') throw new Error('Invalid theme accepted');
    await invoke('mute');
    await tikSession.protocol.unhandle('https');
    await wcFixture();
    await win.webContents.executeJavaScript(`window.tikdesk.command('dialog', true)`);
    if (view.getVisible()) throw new Error('Strona zasłania lokalny dialog');
    await win.webContents.executeJavaScript(`window.tikdesk.command('dialog', false)`);
    if (!view.getVisible()) throw new Error('Strona nie wróciła po zamknięciu dialogu');
    setMode('desktop');
    if (view.getBounds().width <= 420) throw new Error('Tryb desktop nie poszerza widoku');
    setMode('mobile');
    await new Promise(resolve => setTimeout(resolve, 700));
    // A native child view can make parent capture unavailable on Windows.
    const capture = async (contents, name) => {
      try { await fs.writeFile(path.join(directory, name), (await contents.capturePage()).toPNG()); }
      catch (error) { screenshotWarnings.push(`${name}: ${error.message}`); }
    };
    await capture(win.webContents, 'shell.png');
    await capture(view.webContents, 'fixture.png');
    failed('Test kontrolowany: brak połączenia.');
    await new Promise(resolve => setTimeout(resolve, 250));
    const errorVisible = await win.webContents.executeJavaScript(`!document.querySelector('#error').hidden`);
    if (!errorVisible) throw new Error('Brak widoku błędu');
    await capture(win.webContents, 'offline.png');
    view.setVisible(true); broadcast({ error: '' });
    if (errors.length) throw new Error(`Renderer errors: ${errors.join('; ')}`);
    const result = { passed: true, checks, ui, navigation: true, errorRecovery: true, localShortcuts: true, bookmarks: true, startupSettings: true, closeWarning: true, preferencesSaved: true, themeCookieSaved: true, manualThemeSynced: true, systemThemeSynced: true, dialogVisibility: true, errorVisible, errors, screenshotWarnings };
    if (process.argv.includes('--live')) {
      if (process.argv.includes('--desktop-live')) setMode('desktop');
      await Promise.race([navigate(HOME), new Promise((_, reject) => setTimeout(() => reject(new Error('TikTok: przekroczono 45 sekund')), 45000))]);
      result.live = { url: view.webContents.getURL(), error: state.error, title: view.webContents.getTitle() };
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (preferences.theme !== 'dark') throw new Error('Strona nadpisała zapisany motyw aplikacji.');
      if (process.argv.includes('--theme-probe')) result.live.theme = await view.webContents.executeJavaScript(`({attrs:[...document.documentElement.attributes].map(a=>[a.name,a.value]),storage:Object.keys(localStorage).filter(k=>/theme|dark|appearance/i.test(k)).map(k=>[k,localStorage.getItem(k)]),cookies:document.cookie.split(';').filter(s=>/theme|dark|appearance/i.test(s.split('=')[0]))})`);
      if (process.argv.includes('--theme-probe')) result.live.theme.domains = (await tikSession.cookies.get({ url: HOME })).filter(cookie => cookie.name.startsWith('tiktok_webapp_theme')).map(({ name, domain, value }) => ({ name, domain, value }));
      const media = await view.webContents.executeJavaScript(VIDEO_SCRIPT);
      result.live.media = media.error ? { error: media.error } : { host: new URL(media.url).hostname, source: media.source, allowed: isMediaUrl(media.url), pageUrl: media.pageUrl };
      if (process.argv.includes('--download-live') && media.error) throw new Error(media.error);
      if (process.argv.includes('--download-live') && !media.error) {
        const output = path.join(directory, process.argv.includes('--desktop-live') ? 'download-desktop.mp4' : 'download-mobile.mp4');
        await downloadVideo(output);
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + 60000;
          const poll = setInterval(() => {
            if (!state.download) { clearInterval(poll); resolve(); }
            else if (Date.now() > deadline) { clearInterval(poll); downloads.cancel(); reject(new Error('Download timeout')); }
          }, 200);
        });
        if (lastVideoDownload?.status !== 'completed') throw new Error(`Download failed: ${JSON.stringify(lastVideoDownload)}`);
        const file = await fs.open(output, 'r');
        try {
          const header = Buffer.alloc(32);
          await file.read(header, 0, header.length, 0);
          const size = (await file.stat()).size;
          if (size < 1000 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Pobrany plik nie jest MP4');
          result.live.download = { passed: true, bytes: size, mp4: true };
        } finally { await file.close(); }
      }
      await capture(view.webContents, 'tiktok.png');
      result.live.page = await view.webContents.executeJavaScript('({title: document.title, text: document.body.innerText.slice(0, 2000)})');
    }
    for (const panel of ['downloads', 'bookmarks', 'settings']) {
      await invoke('dialog', true);
      await win.webContents.executeJavaScript(`document.querySelector('#${panel}-dialog').showModal()`);
      await new Promise(resolve => setTimeout(resolve, 200));
      await capture(win.webContents, `${panel}-panel.png`);
      await win.webContents.executeJavaScript(`document.querySelector('#${panel}-dialog').close()`);
      await invoke('dialog', false);
    }
    await fs.writeFile(path.join(directory, 'smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}
async function wcFixture() {
  await view.webContents.loadURL('data:text/html,<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:%230b0d12;color:white;font:24px sans-serif">TikDesk sandbox test</body>');
  broadcast({ loading: false });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  nativeTheme.on('updated', () => {
    broadcast();
    if (tikSession && preferences.theme === 'system') void syncTikTokTheme().catch(error => console.error(error.message));
  });
  app.on('before-quit', event => {
    if (quitting) return;
    if (preparingDownload || downloads?.active || siteDownloads.size) {
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
      void savePreferences();
    }
    (async () => {
      await adoptTikTokTheme(pendingThemeDomain);
      await savePreferences();
      await themeQueue;
      await tikSession?.cookies.flushStore();
    })().catch(error => console.error(error.message)).finally(() => app.quit());
  });
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => { Menu.setApplicationMenu(null); return createWindow(); }).catch(error => { console.error(error); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
