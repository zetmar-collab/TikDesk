const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { VIDEO_SCRIPT, isMediaUrl } = require('../src/video.cjs');
const { normalizePreferences } = require('../src/preferences.cjs');
const { HOME } = require('../src/policy.cjs');
async function preferencePhase(ctx) {
  const wc = ctx.view.webContents;
  const { app, win, view, tikSession, nativeTheme, dialog, setTheme, setMode, broadcast, failed, navigate, downloadVideo, savePreferences, saveJson } = ctx;
  const { area } = ctx;
  if (process.argv.includes('--preferences-write')) {
    await setTheme('light');
    setMode('desktop');
    ctx.preferences.muted = true; wc.setAudioMuted(true);
    ctx.preferences.startup = 'last';
    ctx.preferences.downloadDirectory = path.join(app.getPath('temp'), 'TikDeskSavedDownloads');
    ctx.preferences.shortcuts = require('../src/shortcuts.cjs').normalizeShortcuts({ fullscreen: 'F10' });
    await ctx.queue.add({ videoId: '123456789', pageUrl: `${HOME}@test/video/123456789`, filePath: path.join(app.getPath('temp'), 'tikdesk-restart-queued.mp4') });
    ctx.bookmarks = [{ id: randomUUID(), title: 'Test zakładki', url: `${HOME}@test` }];
    await saveJson('bookmarks.json', ctx.bookmarks);
    win.setSize(1040, 760);
    await savePreferences();
    win.close();
    return true;
  }
  if (process.argv.includes('--preferences-read')) {
    const [width, height] = win.getSize();
    const cookies = await tikSession.cookies.get({ url: HOME, name: 'tiktok_webapp_theme' });
    const expectedWidth = Math.min(1040, Math.max(800, area.width));
    const expectedHeight = Math.min(760, Math.max(640, area.height));
    if (ctx.preferences.theme !== 'light' || ctx.preferences.mode !== 'desktop' || !wc.isAudioMuted() || width !== expectedWidth || height !== expectedHeight || cookies[0]?.value !== 'light') throw new Error('Ustawienia nie przetrwały restartu aplikacji.');
    if (ctx.preferences.startup !== 'last' || ctx.preferences.downloadDirectory !== path.join(app.getPath('temp'), 'TikDeskSavedDownloads') || ctx.bookmarks[0]?.url !== `${HOME}@test`) throw new Error('Nowe ustawienia lub zakładki nie przetrwały restartu.');
    if (ctx.preferences.shortcuts.fullscreen !== 'F10' || !ctx.queue.paused || ctx.queue.rows[0]?.status !== 'queued') throw new Error('Skróty lub kolejka nie przetrwały restartu.');
    console.log('Preferences restart roundtrip passed.');
    wc.emit('before-mouse-event', {}, { type: 'mouseDown' });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'manual', secure: true });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: 'dark', secure: true });
    win.close();
    return true;
  }
  if (process.argv.includes('--preferences-read-manual')) {
    if (ctx.preferences.theme !== 'dark') throw new Error('Motyw zmieniony tuż przed zamknięciem nie został zapisany.');
    console.log('Immediate manual theme restart roundtrip passed.');
    wc.emit('before-mouse-event', {}, { type: 'mouseDown' });
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'auto', secure: true });
    win.close(); return true;
  }
  if (process.argv.includes('--preferences-read-system')) {
    if (ctx.preferences.theme !== 'system') throw new Error('Systemowy motyw TikToka nie przetrwał restartu.');
    console.log('System theme restart roundtrip passed.');
    win.close(); return true;
  }

  return false;
}
async function runSmoke(ctx) {
  const { app, win, view, tikSession, nativeTheme, dialog, setTheme, setMode, broadcast, failed, navigate, downloadVideo, savePreferences, saveJson, downloads } = ctx;
  const directory = path.join(process.cwd(), 'artifacts');
  win.webContents.setBackgroundThrottling(false);
  await fs.mkdir(directory, { recursive: true });
  const errors = [];
  const screenshotWarnings = [];
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message); });
  try {
    await wcFixture(ctx);
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
    await waitFor(() => view.webContents.getURL() === `${HOME}test-first` && view.getVisible() && !ctx.state.error);
    await invoke('forward');
    await waitFor(() => view.webContents.getURL() === `${HOME}test-second`);
    await invoke('navigate', 'home');
    if (view.webContents.getURL() !== HOME) throw new Error('Home navigation failed');
    win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F11' });
    await waitFor(() => win.isFullScreen());
    win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F11' });
    await waitFor(() => !win.isFullScreen());
    await invoke('bookmark-add');
    const added = ctx.bookmarks[0];
    if (!added || added.url !== HOME) throw new Error('Zakładka nie została zapisana.');
    if ((await invoke('bookmark-add')).ok) throw new Error('Zduplikowano zakładkę.');
    await invoke('bookmark-open', added.id);
    await invoke('bookmark-remove', added.id);
    if (ctx.bookmarks.length) throw new Error('Zakładka nie została usunięta.');
    await invoke('settings-save', { startup: 'last' });
    if (ctx.preferences.startup !== 'last') throw new Error('Ustawienia startu nie zostały zapisane.');
    await invoke('settings-save', { startup: 'home' });
    const showMessageBox = dialog.showMessageBox;
    let closeQuestions = 0;
    try {
      dialog.showMessageBox = async () => { closeQuestions++; return { response: 0 }; };
      ctx.preparingDownload = true;
      win.close();
      await waitFor(() => closeQuestions === 1 && !ctx.closeConfirmation);
      if (win.isDestroyed()) throw new Error('Zamknięto aplikację mimo wybrania Zostań.');
    } finally { ctx.preparingDownload = false; dialog.showMessageBox = showMessageBox; }
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
    await waitFor(() => ctx.preferences.theme === 'light');
    await tikSession.cookies.set({ url: HOME, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: 'auto', secure: true });
    await waitFor(() => ctx.preferences.theme === 'system');
    await invoke('theme', 'dark');
    await new Promise(resolve => setTimeout(resolve, 350));
    if (ctx.preferences.theme !== 'dark') throw new Error('Własny zapis cookies nadpisał motyw.');
    const invalidTheme = await invoke('theme', 'invalid');
    if (invalidTheme.ok || ctx.preferences.theme !== 'dark') throw new Error('Invalid theme accepted');
    await featureChecks(ctx, invoke, waitFor);
    await invoke('mute');
    await tikSession.protocol.unhandle('https');
    await wcFixture(ctx);
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
    result.features = { cancelPreparation: true, libraryFilters: true, videoBookmark: true, permissions: true, customShortcuts: true, queueCommands: true, diagnosticReport: true, smallWindowLogin: true };
    if (process.argv.includes('--live')) {
      if (process.argv.includes('--desktop-live')) setMode('desktop');
      await Promise.race([navigate(HOME), new Promise((_, reject) => setTimeout(() => reject(new Error('TikTok: przekroczono 45 sekund')), 45000))]);
      result.live = { url: view.webContents.getURL(), error: ctx.state.error, title: view.webContents.getTitle() };
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (ctx.preferences.theme !== 'dark') throw new Error('Strona nadpisała zapisany motyw aplikacji.');
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
            if (!ctx.state.download) { clearInterval(poll); resolve(); }
            else if (Date.now() > deadline) { clearInterval(poll); downloads.cancel(); reject(new Error('Download timeout')); }
          }, 200);
        });
        if (ctx.lastVideoDownload?.status !== 'completed') throw new Error(`Download failed: ${JSON.stringify(ctx.lastVideoDownload)}`);
        const file = await fs.open(output, 'r');
        try {
          const header = Buffer.alloc(32);
          await file.read(header, 0, header.length, 0);
          const size = (await file.stat()).size;
          if (size < 1000 || header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('Pobrany plik nie jest MP4');
          result.live.download = { passed: true, bytes: size, mp4: true };
        } finally { await file.close(); }
      }
      if (process.argv.includes('--queue-live') && !media.error) {
        const output = path.join(directory, `queued-live-${process.pid}.mp4`);
        const task = await ctx.queue.add({ videoId: media.id || (media.pageUrl || '').match(/\/video\/(\d+)/)?.[1], pageUrl: media.pageUrl, filePath: output });
        await ctx.queue.setPaused(false);
        const deadline = Date.now() + 90000;
        while (['queued', 'running'].includes(task.status) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
        await ctx.queue.setPaused(true);
        if (task.status !== 'completed') throw new Error(`Live queue failed: ${task.error || task.status}`);
        result.live.queue = { passed: true, bytes: (await fs.stat(output)).size };
      }
      await capture(view.webContents, 'tiktok.png');
      result.live.page = await view.webContents.executeJavaScript('({title: document.title, text: document.body.innerText.slice(0, 2000)})');
    }
    let previousPanelImage;
    for (const panel of ['downloads', 'bookmarks', 'settings']) {
      await invoke('dialog', true);
      await win.webContents.executeJavaScript(`document.querySelector('#${panel}-dialog').showModal()`);
      if (!(await win.webContents.executeJavaScript(`document.querySelector('#${panel}-dialog').open`))) throw new Error(`Dialog ${panel} did not open`);
      win.webContents.invalidate();
      await new Promise(resolve => setTimeout(resolve, 600));
      await capture(win.webContents, `${panel}-panel.png`);
      const panelImage = await fs.readFile(path.join(directory, `${panel}-panel.png`)).catch(() => null);
      if (panelImage && previousPanelImage?.equals(panelImage)) screenshotWarnings.push(`${panel}-panel.png: compositor returned the previous panel; visual verification unavailable`);
      previousPanelImage = panelImage;
      await win.webContents.executeJavaScript(`document.querySelector('#${panel}-dialog').close()`);
      await invoke('dialog', false);
    }
    result.performanceSample = app.getAppMetrics().map(metric => ({ type: metric.type, cpuPercent: metric.cpu.percentCPUUsage, memoryKB: metric.memory.workingSetSize }));
    await fs.writeFile(path.join(directory, 'smoke.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
}
async function wcFixture(ctx) {
  const { view, broadcast } = ctx;
  await view.webContents.loadURL('data:text/html,<meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:%230b0d12;color:white;font:24px sans-serif">TikDesk sandbox test</body>');
  broadcast({ loading: false });
}


async function featureChecks(ctx, invoke, waitFor) {
  const assert = require('node:assert/strict');
  const { win, view, downloads, queue, broadcast, permissions } = ctx;
  const evaluate = script => win.webContents.executeJavaScript(script);
  const oldSize = win.getSize(); win.setSize(800, 640);
  assert.equal(await evaluate('!!document.querySelector("nav [data-route=login]").getClientRects().length'), true);
  win.setSize(...oldSize);
  assert.equal((await invoke('shortcuts-save', { fullscreen: 'F10' })).ok, true);
  win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F10' }); await waitFor(() => win.isFullScreen());
  win.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: 'F10' }); await waitFor(() => !win.isFullScreen());
  assert.equal((await invoke('shortcuts-save', { fullscreen: 'F5' })).ok, false); await invoke('shortcuts-reset');
  await invoke('dialog', true);
  await evaluate(`document.querySelector('#settings-dialog').showModal();command('shortcuts-save',{fullscreen:'F5'})`);
  await waitFor(() => evaluate(`!!document.querySelector('#settings-dialog .dialog-notice')?.textContent.includes('powtarzać')`));
  await evaluate(`document.querySelector('#settings-dialog').close()`); await invoke('dialog', false);
  const originalInspect = view.webContents.executeJavaScript;
  try {
    view.webContents.executeJavaScript = () => new Promise(() => {});
    const pending = invoke('download'); await waitFor(() => ctx.preparingDownload);
    await invoke('cancel-download'); assert.equal((await pending).ok, false); assert.equal(ctx.preparingDownload, false);
  } finally { view.webContents.executeJavaScript = originalInspect; }
  const oldRows = downloads.records;
  try {
    downloads.records = [{ id: 'probe1', filename: 'Alfa.mp4', filePath: 'C:\\Alfa.mp4', pageUrl: HOME, status: 'completed', missing: true, createdAt: '2026-01-01', bytes: 10 }, { id: 'probe2', filename: 'Beta.mp4', filePath: 'C:\\Beta.mp4', pageUrl: HOME, status: 'failed', error: 'test', createdAt: '2026-01-02', bytes: 0 }]; broadcast();
    await evaluate(`document.querySelector('#downloads-search').value='alfa';document.querySelector('#downloads-search').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate(`document.querySelectorAll('#downloads-list .record').length`), 1);
    await evaluate(`document.querySelector('#downloads-search').value='';document.querySelector('#downloads-filter').value='missing';document.querySelector('#downloads-filter').dispatchEvent(new Event('input'))`);
    assert.equal(await evaluate(`document.querySelectorAll('#downloads-list .record').length`), 1);
    await evaluate(`document.querySelector('#downloads-filter').value='all'`);
  } finally { downloads.records = oldRows; broadcast(); }
  await view.webContents.executeJavaScript(`document.body.innerHTML='<article><a href="https://www.tiktok.com/@test/video/123456789">Test</a><video src="https://v.tiktokcdn.com/test.mp4" style="width:400px;height:400px"></video></article>'`);
  assert.equal((await invoke('bookmark-video')).ok, true);
  assert.ok(ctx.bookmarks[0].url.includes('/video/123456789')); await invoke('bookmark-remove', ctx.bookmarks[0].id);
  await invoke('diagnostics'); assert.equal(JSON.parse(ctx.state.diagnosticReport).application, 'TikDesk');
  permissions.grant(HOME, 'media', { mediaTypes: ['audio'] }); broadcast(); assert.equal(ctx.state.permissions.length, 1);
  await invoke('permission-revoke', permissions.list()[0].id); assert.equal(permissions.list().length, 0);
  const run = queue.run;
  try {
    queue.run = async () => ({ status: 'completed' });
    const row = await queue.add({ videoId: '123456789', pageUrl: `${HOME}@test/video/123456789`, filePath: path.join(ctx.app.getPath('temp'), 'tikdesk-queue-test.mp4') });
    await invoke('queue-start'); await waitFor(() => row.status === 'completed' && !queue.active);
    await invoke('queue-pause'); await invoke('queue-remove', row.id);
  } finally { queue.run = run; }
}
module.exports = { runSmoke, preferencePhase };
