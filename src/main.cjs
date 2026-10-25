const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog, Menu, clipboard, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { HOME, ROUTES, httpsUrl, isTikTok, isAuth, layout } = require('./policy.cjs');
const { isMediaUrl, VIDEO_SCRIPT, videoFilename } = require('./video.cjs');
const { normalizePreferences } = require('./preferences.cjs');
const { resolvedTheme, themeCookies, themeCookieValue } = require('./theme.cjs');

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
let pendingVideo = null;
let activeDownload = null;
let downloadTimer;
let lastVideoDownload;
const shellUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const securePreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false };
let saveQueue = Promise.resolve();
let themeQueue = Promise.resolve();
let themeCookieTimer;
let pendingThemeDomain;
let quitting = false;

function broadcast(update = {}) {
  state = { ...state, ...update, theme: preferences.theme, effectiveTheme: resolvedTheme(preferences.theme, nativeTheme.shouldUseDarkColors) };
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
  themeQueue = themeQueue.catch(() => {}).then(async () => {
    for (const cookie of themeCookies(theme)) await tikSession.cookies.set(cookie);
    await tikSession.cookies.flushStore();
  });
  return themeQueue;
}
async function setTheme(theme) {
  preferences.theme = theme;
  nativeTheme.themeSource = theme;
  broadcast();
  await syncTikTokTheme();
  await savePreferences();
}
async function adoptTikTokTheme(domain) {
  if (!tikSession) return;
  const cookies = await tikSession.cookies.get({ url: HOME });
  const source = themeCookieValue(cookies, 'tiktok_webapp_theme_source', domain);
  const theme = themeCookieValue(cookies, 'tiktok_webapp_theme', domain);
  if (source && source !== 'auto' && ['dark', 'light'].includes(theme) && theme !== preferences.theme) {
    preferences.theme = theme; nativeTheme.themeSource = theme;
    broadcast(); await savePreferences(); await tikSession.cookies.flushStore();
  }
}
function savePreferences() {
  const contents = JSON.stringify(preferences);
  const file = path.join(app.getPath('userData'), 'preferences.json');
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    await fs.writeFile(`${file}.tmp`, contents);
    await fs.rename(`${file}.tmp`, file);
  });
  return saveQueue;
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
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = input.key.toLowerCase();
    if (key === 'f5' || (input.control && key === 'r')) { event.preventDefault(); wc.reload(); }
    if (key === 'f11') { event.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
    if (input.alt && key === 'arrowleft' && wc.navigationHistory.canGoBack()) { event.preventDefault(); wc.navigationHistory.goBack(); }
    if (input.alt && key === 'arrowright' && wc.navigationHistory.canGoForward()) { event.preventDefault(); wc.navigationHistory.goForward(); }
    if (input.alt && key === 'home') { event.preventDefault(); void navigate(HOME); }
  });
}
function configureSession() {
  tikSession = session.fromPartition('persist:tikdesk');
  tikSession.cookies.on('changed', (_event, cookie, _cause, removed) => {
    if (removed || !['tiktok.com', '.tiktok.com', 'www.tiktok.com'].includes(cookie.domain) || !['tiktok_webapp_theme', 'tiktok_webapp_theme_source'].includes(cookie.name)) return;
    pendingThemeDomain = cookie.domain;
    clearTimeout(themeCookieTimer);
    themeCookieTimer = setTimeout(async () => {
      try {
        // A manual choice inside TikTok becomes the saved desktop preference.
        // Our own writes use 'auto' so TikTok follows Chromium's selected theme.
        await adoptTikTokTheme(cookie.domain);
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
    const requested = pendingVideo && item.getURLChain().includes(pendingVideo.url) ? pendingVideo : null;
    if (requested) {
      clearTimeout(downloadTimer);
      pendingVideo = null;
      const mime = item.getMimeType().toLowerCase().split(';')[0];
      lastVideoDownload = { mime, bytes: item.getTotalBytes(), status: 'started' };
      if (!['video/mp4', 'application/mp4', 'application/octet-stream'].includes(mime)) {
        item.cancel();
        lastVideoDownload.status = 'rejected-type';
        broadcast({ download: null, downloadMessage: 'Serwer nie udostępnił pliku MP4. Spróbuj innego filmu.' });
        return;
      }
      activeDownload = item;
      item.setSaveDialogOptions({ title: 'Pobierz oglądany film', defaultPath: path.join(app.getPath('downloads'), requested.filename), filters: [{ name: 'Film MP4', extensions: ['mp4'] }] });
      if (requested.testPath && smoke) item.setSavePath(requested.testPath);
      item.on('updated', () => {
        const total = item.getTotalBytes();
        broadcast({ downloadMessage: 'Zapisywanie filmu na dysku…', download: { phase: 'saving', percent: total > 0 ? Math.min(99, Math.floor(item.getReceivedBytes() / total * 100)) : null } });
      });
      item.once('done', (_event, status) => {
        lastVideoDownload.status = status;
        activeDownload = null;
        const message = status === 'completed' ? 'Film zapisany na dysku.' : status === 'cancelled' ? 'Pobieranie anulowane.' : 'Nie udało się pobrać filmu. Spróbuj ponownie.';
        broadcast({ download: null, downloadMessage: message, notice: message });
      });
      return;
    }
    item.setSaveDialogOptions({ title: 'Zapisz plik z TikToka' });
    item.on('done', (_event, status) => broadcast({ notice: status === 'completed' ? 'Plik został zapisany.' : 'Pobieranie anulowane lub nieudane.' }));
  });
}
async function downloadVideo(testPath) {
  if (pendingVideo || activeDownload || state.download) throw new Error('Pobieranie jest już w toku.');
  if (!isTikTok(view.webContents.getURL()) && !smoke) throw new Error('Otwórz film na stronie TikToka.');
  broadcast({ download: { phase: 'preparing', percent: null }, downloadMessage: 'Przygotowywanie pobierania…' });
  try {
    const video = await view.webContents.executeJavaScript(VIDEO_SCRIPT);
    if (video.error) throw new Error(video.error);
    if (!isMediaUrl(video.url)) throw new Error('Film nie ma obsługiwanego adresu HTTPS w sieci TikToka.');
    pendingVideo = { url: video.url, filename: videoFilename(video.id), testPath };
    downloadTimer = setTimeout(() => {
      pendingVideo = null;
      broadcast({ download: null, downloadMessage: 'Serwer nie rozpoczął pobierania. Spróbuj ponownie.' });
    }, 30000);
    view.webContents.downloadURL(video.url, { headers: { 'User-Agent': view.webContents.getUserAgent(), 'Referer': view.webContents.getURL() } });
  } catch (error) {
    pendingVideo = null; clearTimeout(downloadTimer);
    broadcast({ download: null, downloadMessage: error.message });
    throw error;
  }
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
  win = new BrowserWindow({ width: preferences.window.width, height: preferences.window.height, minWidth: 800, minHeight: 640, backgroundColor: '#0b0d12', title: 'TikDesk', autoHideMenuBar: true, icon: path.join(__dirname, '../assets/icon.ico'), webPreferences: { ...securePreferences, preload: path.join(__dirname, 'preload.cjs') } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  view = new WebContentsView({ webPreferences: { ...securePreferences, session: tikSession } });
  view.setBackgroundColor('#000000');
  win.contentView.addChildView(view);
  secureContents(view.webContents);
  const wc = view.webContents;
  wc.setAudioMuted(preferences.muted);
  state.muted = preferences.muted;
  wc.on('did-start-loading', () => broadcast({ loading: true, error: '' }));
  wc.on('did-stop-loading', () => broadcast({ loading: false }));
  wc.on('did-navigate', () => broadcast());
  wc.on('did-navigate-in-page', () => broadcast());
  wc.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) failed(description);
  });
  wc.on('render-process-gone', () => failed('Proces strony został zakończony.'));
  win.on('resize', resize);
  win.on('close', () => {
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
    win.setSize(1040, 760);
    await savePreferences();
    win.close();
    return;
  }
  if (smoke && process.argv.includes('--preferences-read')) {
    const [width, height] = win.getSize();
    const cookies = await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' });
    if (preferences.theme !== 'light' || preferences.mode !== 'desktop' || !wc.isAudioMuted() || width !== 1040 || height !== 760 || cookies[0]?.value !== 'light') throw new Error('Ustawienia nie przetrwały restartu aplikacji.');
    console.log('Preferences restart roundtrip passed.');
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'manual', secure: true });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: 'dark', secure: true });
    win.close();
    return;
  }
  if (smoke && process.argv.includes('--preferences-read-manual')) {
    if (preferences.theme !== 'dark') throw new Error('Motyw zmieniony tuż przed zamknięciem nie został zapisany.');
    console.log('Immediate manual theme restart roundtrip passed.');
    win.close(); return;
  }
  if (smoke) return runSmoke();
  void navigate(HOME).then(() => { if (!wc.isDestroyed()) { wc.navigationHistory.clear(); broadcast(); } });
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
      case 'copy-link': if (isTikTok(wc.getURL())) { clipboard.writeText(wc.getURL()); broadcast({ notice: 'Link skopiowany.' }); } break;
      case 'browser': await external(isTikTok(wc.getURL()) ? wc.getURL() : HOME); break;
      case 'download': await downloadVideo(); break;
      case 'cancel-download': activeDownload?.cancel(); break;
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
    await invoke('back');
    await waitFor(() => view.webContents.getURL() === `${HOME}test-first`);
    await invoke('forward');
    await waitFor(() => view.webContents.getURL() === `${HOME}test-second`);
    await invoke('navigate', 'home');
    if (view.webContents.getURL() !== HOME) throw new Error('Home navigation failed');
    await invoke('theme', 'light');
    if (await win.webContents.executeJavaScript('document.documentElement.dataset.theme') !== 'light') throw new Error('Light shell theme failed');
    await invoke('theme', 'dark');
    await invoke('mute');
    const savedPreferences = normalizePreferences(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')));
    if (savedPreferences.theme !== 'dark' || !savedPreferences.muted || !view.webContents.isAudioMuted()) throw new Error('Preferences not saved');
    const themeCookie = (await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' }))[0];
    if (themeCookie?.value !== 'dark') throw new Error('TikTok appearance cookie not saved');
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'manual', secure: true });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: 'light', secure: true });
    await waitFor(() => preferences.theme === 'light');
    await invoke('theme', 'dark');
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
    const result = { passed: true, checks, ui, navigation: true, preferencesSaved: true, themeCookieSaved: true, manualThemeSynced: true, dialogVisibility: true, errorVisible, errors, screenshotWarnings };
    if (process.argv.includes('--live')) {
      if (process.argv.includes('--desktop-live')) setMode('desktop');
      await Promise.race([navigate(HOME), new Promise((_, reject) => setTimeout(() => reject(new Error('TikTok: przekroczono 45 sekund')), 45000))]);
      result.live = { url: view.webContents.getURL(), error: state.error, title: view.webContents.getTitle() };
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (process.argv.includes('--theme-probe')) result.live.theme = await view.webContents.executeJavaScript(`({attrs:[...document.documentElement.attributes].map(a=>[a.name,a.value]),storage:Object.keys(localStorage).filter(k=>/theme|dark|appearance/i.test(k)).map(k=>[k,localStorage.getItem(k)]),cookies:document.cookie.split(';').filter(s=>/theme|dark|appearance/i.test(s.split('=')[0]))})`);
      const media = await view.webContents.executeJavaScript(VIDEO_SCRIPT);
      result.live.media = media.error ? { error: media.error } : { host: new URL(media.url).hostname, source: media.source, allowed: isMediaUrl(media.url) };
      if (process.argv.includes('--download-live') && media.error) throw new Error(media.error);
      if (process.argv.includes('--download-live') && !media.error) {
        const output = path.join(directory, process.argv.includes('--desktop-live') ? 'download-desktop.mp4' : 'download-mobile.mp4');
        await downloadVideo(output);
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + 60000;
          const poll = setInterval(() => {
            if (!state.download) { clearInterval(poll); resolve(); }
            else if (Date.now() > deadline) { clearInterval(poll); activeDownload?.cancel(); reject(new Error('Download timeout')); }
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
