const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isMediaUrl } = require('./video.cjs');
const { isTikTok } = require('./policy.cjs');
const { validateMp4 } = require('./mp4.cjs');

class DownloadManager {
  constructor({ fetch, onChange = () => {}, persist = async () => {}, timeoutMs = 30000, idleMs = 45000 }) {
    this.fetch = fetch; this.onChange = onChange; this.persist = persist;
    this.timeoutMs = timeoutMs; this.idleMs = idleMs;
    this.records = []; this.active = null;
  }
  restore(records) {
    this.records = Array.isArray(records) ? records.filter(row => row && /^[a-f0-9-]{36}$/.test(row.id) && typeof row.filePath === 'string' && path.isAbsolute(row.filePath) && path.extname(row.filePath).toLowerCase() === '.mp4' && isTikTok(row.pageUrl)).slice(0, 100).map(row => ({ id: row.id, filename: path.basename(row.filePath), filePath: row.filePath, pageUrl: row.pageUrl, videoId: /^\d+$/.test(row.videoId) ? row.videoId : '', status: ['completed', 'failed', 'cancelled'].includes(row.status) ? row.status : 'interrupted', bytes: Number.isFinite(row.bytes) ? row.bytes : 0, total: 0, percent: null, error: row.status === 'completed' ? '' : ['failed', 'cancelled'].includes(row.status) && typeof row.error === 'string' ? row.error.slice(0, 300) : 'Pobieranie przerwane przy poprzednim uruchomieniu.', createdAt: typeof row.createdAt === 'string' ? row.createdAt : '' })) : [];
  }
  list() { return this.records.map(row => ({ ...row })); }
  emit() { this.onChange(this.list(), this.active?.record || null); }
  async save() { await this.persist(this.list()); }
  cancel() { this.active?.controller.abort(new Error('Pobieranie anulowane.')); }
  async start({ url, filePath, pageUrl, videoId = '', userAgent = '' }) {
    if (this.active) throw new Error('Pobieranie jest już w toku.');
    if (!isMediaUrl(url) || !isTikTok(pageUrl)) throw new Error('Nieprawidłowy adres filmu.');
    if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.mp4') throw new Error('Wybierz plik z rozszerzeniem .mp4.');
    const record = { id: randomUUID(), filename: path.basename(filePath), filePath, pageUrl, videoId, status: 'connecting', bytes: 0, total: 0, percent: null, error: '', createdAt: new Date().toISOString() };
    const controller = new AbortController();
    this.active = { record, controller };
    this.records = [record, ...this.records].slice(0, 100);
    let timer, directory, writer, reader, timedOut = false;
    const arm = delay => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(new Error('Przekroczono czas oczekiwania na serwer.')); }, delay);
    };
    this.emit();
    try {
      arm(this.timeoutMs);
      let response;
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (!isMediaUrl(url)) throw new Error('Serwer przekierował pobieranie poza sieć TikToka.');
        controller.signal.throwIfAborted();
        response = await this.fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': userAgent, Referer: pageUrl } });
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
      directory = await fs.mkdtemp(path.join(path.dirname(filePath), '.tikdesk-'));
      const temporary = path.join(directory, 'video.part');
      writer = await fs.open(temporary, 'wx');
      reader = response.body.getReader();
      record.status = 'saving'; this.emit();
      let lastUpdate = 0;
      while (true) {
        arm(this.idleMs);
        const { done, value } = await reader.read();
        controller.signal.throwIfAborted();
        if (done) break;
        await writer.writeFile(value);
        record.bytes += value.byteLength;
        record.percent = record.total > 0 ? Math.min(99, Math.floor(record.bytes / record.total * 100)) : null;
        if (Date.now() - lastUpdate > 150) { this.emit(); lastUpdate = Date.now(); }
      }
      clearTimeout(timer);
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
      controller.abort();
      await reader?.cancel().catch(() => {});
      await writer?.close().catch(() => {});
      if (directory) {
        await fs.unlink(path.join(directory, 'video.part')).catch(() => {});
        await fs.rmdir(directory).catch(() => {});
      }
      this.active = null; this.emit();
      try { await this.save(); } catch { record.error = 'Nie udało się zapisać historii pobrań.'; this.emit(); }
    }
    return record;
  }
}
module.exports = { DownloadManager };
