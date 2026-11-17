const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isMediaUrl } = require('./video.cjs');
const { isTikTok } = require('./policy.cjs');
const { validateMp4 } = require('./mp4.cjs');
const { bounded } = require('./async.cjs');

class DownloadManager {
  constructor({ fetch, onChange = () => {}, persist = async () => {}, timeoutMs = 30000, idleMs = 45000, maxBytes = 2 * 1024 ** 3, totalMs = 30 * 60 * 1000 }) {
    this.fetch = fetch; this.onChange = onChange; this.persist = persist;
    this.timeoutMs = timeoutMs; this.idleMs = idleMs;
    this.maxBytes = maxBytes; this.totalMs = totalMs;
    this.records = []; this.active = null;
  }
  restore(records) {
    this.records = Array.isArray(records) ? records.filter(row => row && /^[a-f0-9-]{36}$/.test(row.id) && typeof row.filePath === 'string' && path.isAbsolute(row.filePath) && path.extname(row.filePath).toLowerCase() === '.mp4' && isTikTok(row.pageUrl)).slice(0, 100).map(row => ({ id: row.id, filename: path.basename(row.filePath), filePath: row.filePath, pageUrl: row.pageUrl, videoId: /^\d+$/.test(row.videoId) ? row.videoId : '', status: ['completed', 'failed', 'cancelled'].includes(row.status) ? row.status : 'interrupted', bytes: Number.isFinite(row.bytes) ? row.bytes : 0, total: 0, percent: null, error: row.status === 'completed' ? '' : ['failed', 'cancelled'].includes(row.status) && typeof row.error === 'string' ? row.error.slice(0, 300) : 'Pobieranie przerwane przy poprzednim uruchomieniu.', createdAt: typeof row.createdAt === 'string' ? row.createdAt : '', temporary: row.temporary === path.join(path.dirname(row.filePath), `.tikdesk-${row.id}`) ? row.temporary : undefined })) : [];
  }
  async refreshFiles() {
    for (const row of this.records) if (row.status === 'completed') row.missing = !(await fs.stat(row.filePath).catch(() => null))?.isFile();
    this.emit();
  }
  async remove(id) {
    if (this.active?.record.id === id) throw new Error('Najpierw anuluj pobieranie.');
    const row = this.records.find(row => row.id === id);
    if (row?.temporary) await this.cleanup(id);
    this.records = this.records.filter(row => row.id !== id); await this.save(); this.emit();
  }
  async cleanup(id) {
    const row = this.records.find(row => row.id === id);
    if (!row?.temporary || this.active?.record.id === id) return;
    const expected = path.join(path.dirname(row.filePath), `.tikdesk-${row.id}`);
    if (row.temporary !== expected) throw new Error('Nieprawidłowy katalog tymczasowy.');
    const stat = await fs.lstat(expected).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat?.isSymbolicLink() || stat && !stat.isDirectory()) throw new Error('Katalog tymczasowy został zmieniony.');
    if (stat) { await fs.unlink(path.join(expected, 'video.part')).catch(error => { if (error.code !== 'ENOENT') throw error; }); await fs.rmdir(expected); }
    delete row.temporary; await this.save(); this.emit();
  }
  list() { return this.records.map(row => ({ ...row })); }
  emit() { this.onChange(this.list(), this.active?.record || null); }
  async save() { await this.persist(this.list()); }
  cancel() { this.active?.controller.abort(new Error('Pobieranie anulowane.')); }
  async start({ url, filePath, pageUrl, videoId = '', userAgent = '' }) {
    if (this.active) throw new Error('Pobieranie jest już w toku.');
    if (this.records.length >= 100) throw new Error('Historia ma 100 wpisów. Usuń starsze wpisy przed kolejnym pobraniem.');
    if (!isMediaUrl(url) || !isTikTok(pageUrl)) throw new Error('Nieprawidłowy adres filmu.');
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.mp4') throw new Error('Wybierz plik z rozszerzeniem .mp4.');
    const record = { id: randomUUID(), filename: path.basename(filePath), filePath, pageUrl, videoId, status: 'connecting', bytes: 0, total: 0, percent: null, error: '', createdAt: new Date().toISOString() };
    const controller = new AbortController();
    this.active = { record, controller };
    this.records = [record, ...this.records].slice(0, 100);
    let timer, totalTimer, directory, writer, reader, timedOut = false;
    const arm = delay => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Przekroczono czas oczekiwania na serwer.')); }, delay);
    };
    this.emit();
    try {
      await this.save();
      controller.signal.throwIfAborted();
      totalTimer = setTimeout(() => { timedOut = true; controller.abort(new Error('Przekroczono całkowity czas pobierania.')); }, this.totalMs);
      arm(this.timeoutMs);
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (!isMediaUrl(url)) throw new Error('Serwer przekierował pobieranie poza sieć TikToka.');
        controller.signal.throwIfAborted();
        response = await bounded(this.fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': userAgent, Referer: pageUrl } }), { signal: controller.signal, timeoutMs: this.timeoutMs });
        controller.signal.throwIfAborted();
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location || redirects === 5) throw new Error('Za dużo przekierowań podczas pobierania.');
          url = new URL(location, url).href;
        } else break;
      }
      if (response.status !== 200) throw new Error(`Serwer nie udostępnił filmu (HTTP ${response.status}).`);
      const mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!['video/mp4', 'application/mp4', 'application/octet-stream'].includes(mime) || !response.body) throw new Error('Odpowiedź serwera nie jest plikiem MP4.');
      record.total = Number(response.headers.get('content-length')) || 0;
      if (record.total > this.maxBytes) throw new Error('Film przekracza limit 2 GB.');
      const disk = await fs.statfs(path.dirname(filePath));
      if (disk.bavail * disk.bsize < Math.max(record.total, 64 * 1024 ** 2)) throw new Error('Za mało wolnego miejsca na dysku.');
      directory = path.join(path.dirname(filePath), `.tikdesk-${record.id}`);
      record.temporary = directory; await this.save();
      controller.signal.throwIfAborted();
      await fs.mkdir(directory);
      const temporary = path.join(directory, 'video.part');
      writer = await fs.open(temporary, 'wx');
      reader = response.body.getReader();
      record.status = 'saving'; this.emit();
      let lastUpdate = 0;
      while (true) {
        arm(this.idleMs);
        const { done, value } = await bounded(reader.read(), { signal: controller.signal, timeoutMs: this.idleMs });
        controller.signal.throwIfAborted();
        if (done) break;
        if (record.bytes + value.byteLength > this.maxBytes) throw new Error('Film przekracza limit 2 GB.');
        await writer.writeFile(value);
        record.bytes += value.byteLength;
        record.percent = record.total > 0 ? Math.min(99, Math.floor(record.bytes / record.total * 100)) : null;
        if (Date.now() - lastUpdate > 150) { this.emit(); lastUpdate = Date.now(); }
      }
      clearTimeout(timer);
      clearTimeout(totalTimer);
      await writer.close(); writer = null;
      record.status = 'validating'; this.emit();
      await validateMp4(temporary, controller.signal);
      controller.signal.throwIfAborted();
      await fs.rename(temporary, filePath);
      record.status = 'completed'; record.percent = 100;
    } catch (error) {
      record.status = controller.signal.aborted && !timedOut ? 'cancelled' : 'failed';
      record.error = timedOut ? 'Serwer nie odpowiedział w wymaganym czasie. Spróbuj ponownie.' : error.message;
    } finally {
      clearTimeout(timer);
      clearTimeout(totalTimer);
      controller.abort();
      if (reader) await bounded(reader.cancel(), { timeoutMs: 500 }).catch(() => {});
      await writer?.close().catch(() => {});
      if (directory) {
        await fs.unlink(path.join(directory, 'video.part')).catch(() => {});
        await fs.rmdir(directory).then(() => { delete record.temporary; }).catch(() => {});
      }
      this.active = null; this.emit();
      try { await this.save(); } catch { record.error = 'Nie udało się zapisać historii pobrań.'; this.emit(); }
    }
    return record;
  }
}
module.exports = { DownloadManager };
