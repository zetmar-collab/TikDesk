const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DownloadManager } = require('../src/downloads.cjs');
const { validateMp4 } = require('../src/mp4.cjs');
function box(type, body = Buffer.alloc(0)) {
  const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4);
  return Buffer.concat([header, body]);
}
const video = Buffer.concat([box('ftyp', Buffer.from('isom\0\0\0\0isom')), box('moov', box('trak', box('mdia', box('hdlr', Buffer.concat([Buffer.alloc(8), Buffer.from('vide')]))))), box('mdat', Buffer.from('test-video-data'))]);
async function fixture(t, fetch, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikdesk-unit-'));
  const filePath = path.join(dir, 'film.mp4');
  const manager = new DownloadManager({ fetch, ...options });
  t.after(async () => {
    // Only the explicit files created by this fixture are removed.
    await fs.unlink(filePath).catch(() => {});
    await fs.rmdir(dir);
  });
  return { manager, filePath, args: { url: 'https://v.tiktokcdn.com/a.mp4', filePath, pageUrl: 'https://www.tiktok.com/@test/video/123456789', videoId: '123456789' } };
}
test('Downloads and validates a video track before reporting success', async t => {
  const { manager, filePath, args } = await fixture(t, async () => new Response(video, { headers: { 'content-type': 'video/mp4', 'content-length': String(video.length) } }));
  const row = await manager.start(args);
  assert.equal(row.status, 'completed');
  assert.deepEqual(await fs.readFile(filePath), video);
  assert.equal((await validateMp4(filePath)).bytes, video.length);
});
test('Invalid octet-stream cannot replace an existing file or leave temporary files', async t => {
  const { manager, filePath, args } = await fixture(t, async () => new Response('<html>access denied</html>', { headers: { 'content-type': 'application/octet-stream' } }));
  await fs.writeFile(filePath, 'original');
  const row = await manager.start(args);
  assert.equal(row.status, 'failed');
  assert.equal(await fs.readFile(filePath, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(path.dirname(filePath)), ['film.mp4']);
});
test('Timeout aborts the network request and cannot complete late', async t => {
  let aborted = false;
  const { manager, filePath, args } = await fixture(t, (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason); });
    setTimeout(() => resolve(new Response(video, { headers: { 'content-type': 'video/mp4' } })), 50);
  }), { timeoutMs: 10 });
  const row = await manager.start(args);
  await new Promise(resolve => setTimeout(resolve, 65));
  assert.equal(aborted, true); assert.equal(row.status, 'failed');
  await assert.rejects(fs.access(filePath));
  assert.equal(manager.active, null);
});
test('Redirects outside TikTok are rejected before following them', async t => {
  let calls = 0;
  const { manager, args } = await fixture(t, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/secret' } }); });
  assert.equal((await manager.start(args)).status, 'failed');
  assert.equal(calls, 1);
});
test('Cancelling a stalled transfer removes its partial file', async t => {
  let manager;
  const f = await fixture(t, async (_url, { signal }) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(video.subarray(0, 20)); signal.addEventListener('abort', () => controller.error(signal.reason)); setTimeout(() => manager.cancel(), 10); }
  }), { headers: { 'content-type': 'video/mp4' } }));
  manager = f.manager;
  assert.equal((await manager.start(f.args)).status, 'cancelled');
  await assert.rejects(fs.access(f.filePath));
  assert.deepEqual(await fs.readdir(path.dirname(f.filePath)), []);
});
test('Audio-only ISO BMFF is rejected as a film', async t => {
  const data = Buffer.from(video); data.write('soun', data.indexOf('vide'));
  const { manager, args } = await fixture(t, async () => new Response(data, { headers: { 'content-type': 'video/mp4' } }));
  assert.equal((await manager.start(args)).status, 'failed');
});
test('History restores failure reasons and never persists signed media URLs', async t => {
  let history;
  const f = await fixture(t, async () => new Response('Denied', { status: 403 }), { persist: async rows => { history = rows; } });
  const row = await f.manager.start(f.args);
  assert.equal(row.status, 'failed');
  assert.ok(!JSON.stringify(history).includes('tiktokcdn.com'));
  const restored = new DownloadManager({ fetch }); restored.restore(history);
  assert.equal(restored.list()[0].status, 'failed');
  assert.equal(restored.list()[0].error, row.error);
  restored.restore([{ ...row, filePath: '../bad.exe' }]);
  assert.deepEqual(restored.list(), []);
});
