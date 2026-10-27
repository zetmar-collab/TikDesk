const $ = (selector) => document.querySelector(selector);
let toastTimer;
let latestState;
let settingsDirty = false;
function toast(text) {
  $('#toast').textContent = text;
  $('#toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
async function command(name, value) {
  try {
    const result = await window.tikdesk.command(name, value);
    if (!result.ok) toast(result.error);
    return result;
  } catch { toast('Nie udało się wykonać polecenia. Spróbuj ponownie.'); return { ok: false }; }
}
window.tikdesk.onState((state) => {
  latestState = state;
  document.documentElement.dataset.theme = state.effectiveTheme;
  $('#theme').value = state.theme;
  $('#mode-mobile').classList.toggle('selected', state.mode === 'mobile');
  $('#mode-desktop').classList.toggle('selected', state.mode === 'desktop');
  $('#mode-mobile').setAttribute('aria-pressed', state.mode === 'mobile');
  $('#mode-desktop').setAttribute('aria-pressed', state.mode === 'desktop');
  $('#back').disabled = !state.canGoBack;
  $('#forward').disabled = !state.canGoForward;
  $('#error').hidden = !state.error;
  $('#error-text').textContent = state.error;
  const downloading = Boolean(state.download);
  $('#download').disabled = downloading || state.loading || Boolean(state.error);
  $('#download').textContent = !downloading ? '↓ Pobierz' : ['preparing', 'connecting'].includes(state.download.phase) ? 'Łączenie…' : state.download.phase === 'validating' ? 'Sprawdzanie…' : state.download.percent === null ? 'Pobieranie…' : `${state.download.percent}%`;
  $('#cancel-download').hidden = !downloading;
  $('#download-status').hidden = !state.downloadMessage;
  $('#download-status').textContent = state.downloadMessage || '';
  $('#mute').textContent = state.muted ? '♩' : '♪';
  $('#mute').setAttribute('aria-pressed', state.muted);
  $('#mute').title = state.muted ? 'Włącz dźwięk' : 'Wycisz';
  $('#mute').setAttribute('aria-label', $('#mute').title);
  $('#status').textContent = state.error ? 'Brak połączenia · Spróbuj ponownie' : state.loading ? 'Ładowanie TikToka…' : `${new URL(state.url).hostname} · ${state.mode === 'mobile' ? 'Widok telefonu' : 'Widok WWW'}`;
  for (const button of document.querySelectorAll('.nav')) {
    const route = button.dataset.route;
    const pathname = new URL(state.url).pathname;
    button.classList.toggle('active', route === 'home' ? pathname === '/' : route === 'live' ? pathname.startsWith('/live') : pathname.includes('/upload'));
  }
  if (state.notice) toast(state.notice);
  $('#app-version').textContent = state.version || '';
  if (!settingsDirty) $('#startup').value = state.startup || 'home';
  $('#download-directory').textContent = state.downloadDirectory || 'Domyślny folder Pobrane systemu Windows';
  $('#update-message').textContent = state.updateMessage || '';
  $('#open-releases').hidden = !state.updateAvailable;
  renderDownloads(state.downloads || [], downloading);
  renderBookmarks(state.bookmarks || []);
});
for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', (event) => { event.preventDefault(); command('navigate', button.dataset.route); });
for (const name of ['back', 'forward', 'reload', 'mute', 'fullscreen', 'browser', 'reset']) $(`#${name}`).addEventListener('click', () => command(name));
$('#copy').addEventListener('click', () => command('copy-link'));
$('#download').addEventListener('click', () => command('download'));
$('#cancel-download').addEventListener('click', () => command('cancel-download'));
$('#retry').addEventListener('click', () => command('reload'));
$('#error-browser').addEventListener('click', () => command('browser'));
$('#mode-mobile').addEventListener('click', () => command('mode', 'mobile'));
$('#mode-desktop').addEventListener('click', () => command('mode', 'desktop'));
$('#theme').addEventListener('change', () => command('theme', $('#theme').value));
async function showDialog(id) {
  // Native child views are above the shell. Main process hides the web view for dialogs.
  await command('dialog', true);
  $(id).showModal();
}
$('#help-open').addEventListener('click', () => showDialog('#help-dialog'));
$('#address').addEventListener('click', () => { $('#link-error').textContent = ''; showDialog('#link-dialog'); });
$('#downloads-open').addEventListener('click', () => showDialog('#downloads-dialog'));
$('#bookmarks-open').addEventListener('click', () => showDialog('#bookmarks-dialog'));
$('#settings-open').addEventListener('click', () => { settingsDirty = false; $('#startup').value = latestState?.startup || 'home'; showDialog('#settings-dialog'); });
$('#startup').addEventListener('change', () => { settingsDirty = true; });
$('#settings-save').addEventListener('click', async () => { if ((await command('settings-save', { startup: $('#startup').value })).ok) { settingsDirty = false; toast('Ustawienia zapisane.'); } });
$('#directory-choose').addEventListener('click', () => command('download-directory'));
$('#bookmark-add').addEventListener('click', () => command('bookmark-add'));
$('#updates-check').addEventListener('click', async () => { $('#updates-check').disabled = true; try { await command('check-updates'); } finally { $('#updates-check').disabled = false; } });
$('#open-releases').addEventListener('click', () => command('open-releases'));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(`#${button.dataset.close}`).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => command('dialog', false));
$('#link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await window.tikdesk.command('open-link', $('#link-input').value);
  if (result.ok) $('#link-dialog').close();
  else $('#link-error').textContent = result.error;
});
command('state');

function action(label, name, id, closeId) {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', async () => {
    if (closeId) { $(closeId).close(); await command('dialog', false); }
    await command(name, id);
  });
  return button;
}
function renderDownloads(rows, busy) {
  const list = $('#downloads-list');
  const existing = new Map([...list.querySelectorAll('.record')].map(element => [element.dataset.id, element]));
  if (!rows.length) { list.textContent = 'Nie masz jeszcze pobranych filmów.'; return; }
  if (!existing.size) list.replaceChildren();
  const labels = { connecting: 'Łączenie z serwerem', saving: 'Pobieranie', validating: 'Sprawdzanie MP4', completed: 'Zapisano', failed: 'Nieudane', cancelled: 'Anulowano', interrupted: 'Przerwane' };
  for (const [index, row] of rows.entries()) {
    let element = existing.get(row.id);
    if (!element) {
      element = document.createElement('article'); element.className = 'record'; element.dataset.id = row.id;
      const title = document.createElement('strong'); const status = document.createElement('p'); const location = document.createElement('p'); location.className = 'path-label';
      const buttons = document.createElement('div'); buttons.className = 'record-actions';
      element.append(title, status, location, buttons); list.append(element);
    }
    element.children[0].textContent = row.filename;
    element.children[1].textContent = `${labels[row.status] || row.status}${row.status === 'saving' && row.percent !== null ? ` · ${row.percent}%` : ''}${row.error ? ` · ${row.error}` : ''}`;
    element.children[2].textContent = row.filePath;
    if (list.children[index] !== element) list.insertBefore(element, list.children[index] || null);
    const signature = `${row.status}|${busy}`;
    if (element.dataset.actions !== signature) {
      element.dataset.actions = signature;
      const buttons = element.children[3]; buttons.replaceChildren();
      if (row.status === 'completed') buttons.append(action('Otwórz', 'download-open', row.id), action('Pokaż w folderze', 'download-folder', row.id));
      else if (['failed', 'cancelled', 'interrupted'].includes(row.status)) { const retry = action('Spróbuj ponownie', 'download-retry', row.id, '#downloads-dialog'); retry.disabled = busy; buttons.append(retry); }
    }
    existing.delete(row.id);
  }
  for (const element of existing.values()) element.remove();
}
function renderBookmarks(rows) {
  const list = $('#bookmarks-list');
  const signature = JSON.stringify(rows);
  if (list.dataset.signature === signature) return;
  list.dataset.signature = signature; list.replaceChildren();
  if (!rows.length) { list.textContent = 'Dodaj pierwszą zakładkę przyciskiem powyżej.'; return; }
  for (const row of rows) {
    const element = document.createElement('article'); element.className = 'record';
    const title = document.createElement('strong'); title.textContent = row.title;
    const url = document.createElement('p'); url.className = 'path-label'; url.textContent = row.url;
    const buttons = document.createElement('div'); buttons.className = 'record-actions';
    buttons.append(action('Otwórz', 'bookmark-open', row.id, '#bookmarks-dialog'), action('Usuń zakładkę', 'bookmark-remove', row.id));
    element.append(title, url, buttons); list.append(element);
  }
}
