const $ = (selector) => document.querySelector(selector);
let toastTimer;
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
  $('#download').textContent = !downloading ? '↓ Pobierz' : state.download.phase === 'preparing' ? 'Łączenie…' : state.download.percent === null ? 'Pobieranie…' : `${state.download.percent}%`;
  $('#cancel-download').hidden = state.download?.phase !== 'saving';
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
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(`#${button.dataset.close}`).close());
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('close', () => command('dialog', false));
$('#link-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const result = await window.tikdesk.command('open-link', $('#link-input').value);
  if (result.ok) $('#link-dialog').close();
  else $('#link-error').textContent = result.error;
});
command('state');
