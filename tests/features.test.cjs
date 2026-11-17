const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importBookmarks, exportBookmarks } = require('../src/library.cjs');
const { Diagnostics } = require('../src/diagnostics.cjs');
const { Permissions } = require('../src/permissions.cjs');
const { normalizeShortcuts, shortcutCommand } = require('../src/shortcuts.cjs');
const { DownloadQueue } = require('../src/queue.cjs');
const { proxyRoute, sessionFetch, closeNetwork } = require('../src/network.cjs');
const path = require('node:path');
test('Bookmark import validates the entire file, removes tracking, and merges duplicates', () => {
  const rows = [{ id: 'local', title: 'Test', url: 'https://www.tiktok.com/@test' }];
  const data = exportBookmarks([...rows, { title: 'Film', url: 'https://www.tiktok.com/@test/video/123456789?token=secret' }]);
  const result = importBookmarks(data, rows);
  assert.equal(result.added, 1); assert.equal(result.duplicates, 1); assert.equal(result.rows.length, 2);
  assert.ok(!data.includes('secret')); assert.ok(!data.includes('local'));
  for (const url of ['file:///C:/secret', 'https://evil.invalid', 'https://www.tiktok.com/login']) assert.throws(() => importBookmarks(JSON.stringify({ format: 'tikdesk-bookmarks', version: 1, bookmarks: [{ title: 'bad', url }] }), []));
  assert.throws(() => importBookmarks(' '.repeat(1024 * 1024 + 1), []), /1 MB/);
});
test('Diagnostics never copies exception messages, URLs, paths or cookies', () => {
  const log = new Diagnostics(); log.record('download', new Error('HTTP 403 https://example.com/?token=secret C:\\Users\\Private cookie=session'));
  const report = log.report({ version: '1.4.0', versions: {}, platform: 'win32', downloads: 1, queued: 0 });
  assert.match(report, /HTTP 403/); for (const privateText of ['secret', 'Private', 'cookie', 'example.com']) assert.ok(!report.includes(privateText));
});
test('Camera and microphone grants are independent, restricted by origin, and revocable', () => {
  const grants = new Permissions(); const origin = 'https://www.tiktok.com';
  grants.grant(origin, 'media', { mediaTypes: ['audio'] });
  assert.equal(grants.allows(origin, 'media', { mediaType: 'audio' }), true);
  assert.equal(grants.allows(origin, 'media', { mediaType: 'video' }), false);
  assert.equal(grants.allows('https://evil.invalid', 'media', { mediaType: 'audio' }), false);
  grants.revoke(grants.list()[0].id); assert.equal(grants.list().length, 0);
});
test('Custom shortcuts reject collisions and reserved keys and accept disabling a command', () => {
  const config = normalizeShortcuts({ reload: 'ctrl+shift+r', home: '' });
  assert.equal(shortcutCommand({ type: 'keyDown', key: 'r', control: true, shift: true }, config), 'reload');
  assert.equal(shortcutCommand({ type: 'keyDown', key: 'Home', alt: true }, config), null);
  assert.throws(() => normalizeShortcuts({ back: 'F11' }), /powtarzać/);
  assert.throws(() => normalizeShortcuts({ reload: 'Ctrl+V' }), /zarezerwowany/);
  assert.equal(shortcutCommand({ type: 'keyDown', key: 'F11', isAutoRepeat: true }), null);
});
test('Queue serializes tasks, cancels pending jobs, and restores safely paused without signed sources', async () => {
  let finish; let started; const ready = new Promise(resolve => { started = resolve; }); let persisted;
  const queue = new DownloadQueue({ run: () => new Promise(resolve => { finish = resolve; started(); }), persist: async rows => { persisted = JSON.parse(JSON.stringify(rows)); } });
  const first = await queue.add({ videoId: '123456789', pageUrl: 'https://www.tiktok.com/@test/video/123456789', filePath: path.resolve('first.mp4') });
  await assert.rejects(queue.add({ videoId: '987654321', pageUrl: 'https://www.tiktok.com/@test/video/987654321', filePath: path.resolve('first.mp4') }), /celem/);
  const second = await queue.add({ videoId: '987654321', pageUrl: 'https://www.tiktok.com/@test/video/987654321', filePath: path.resolve('second.mp4') });
  await queue.setPaused(false); await ready; assert.equal(queue.active.row.id, first.id);
  await queue.cancel(second.id); await queue.setPaused(true); finish({ status: 'completed' });
  while (queue.pumping) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(queue.rows.map(row => row.status), ['completed', 'cancelled']);
  const restored = new DownloadQueue({ run() {} }); restored.restore([{ ...persisted[0], status: 'running', url: 'https://cdn.invalid/signed' }]);
  assert.equal(restored.paused, true); assert.equal(restored.rows[0].status, 'queued'); assert.ok(!JSON.stringify(restored.rows).includes('signed'));
});
test('System proxy configuration is honored and unsupported routes never fall back silently', async () => {
  assert.equal(proxyRoute('DIRECT'), null); assert.equal(proxyRoute('PROXY proxy.example:8080; DIRECT'), 'http://proxy.example:8080/');
  assert.throws(() => proxyRoute('SOCKS5 proxy.example:1080'), /nie jest obsługiwany/);
  const controller = new AbortController(); let sent;
  const session = { cookies: { get: async () => [{ name: 'session', value: 'test' }] }, resolveProxy: async () => 'PROXY proxy.example:8080' };
  const dispatcher = { destroy: async () => {} };
  await sessionFetch(session, 'https://v.tiktokcdn.com/test', { signal: controller.signal, headers: {} }, async (_url, options) => { sent = options; return new Response('ok'); }, () => dispatcher);
  assert.equal(sent.dispatcher, dispatcher); assert.equal(sent.headers.Cookie, 'session=test'); await closeNetwork();
});
