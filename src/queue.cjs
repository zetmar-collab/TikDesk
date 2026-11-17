const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isTikTok } = require('./policy.cjs');
class DownloadQueue {
  constructor({ run, cancel = () => {}, persist = async () => {}, onChange = () => {} }) { this.run = run; this.cancelTransfer = cancel; this.persist = persist; this.onChange = onChange; this.rows = []; this.paused = true; this.active = null; this.pumping = false; }
  restore(rows) {
    this.rows = (Array.isArray(rows) ? rows : []).filter(row => row && /^[a-f0-9-]{36}$/.test(row.id) && /^\d{5,30}$/.test(row.videoId) && isTikTok(row.pageUrl) && typeof row.filePath === 'string' && path.isAbsolute(row.filePath) && path.extname(row.filePath).toLowerCase() === '.mp4').slice(0, 50).map(row => ({ id: row.id, videoId: row.videoId, pageUrl: row.pageUrl, filePath: row.filePath, status: ['completed', 'failed', 'cancelled'].includes(row.status) ? row.status : 'queued', error: '', createdAt: row.createdAt }));
  }
  snapshot() { return { paused: this.paused, rows: this.rows.map(row => ({ ...row })), active: this.active?.row.id || null }; }
  emit() { this.onChange(this.snapshot()); }
  async save() { await this.persist(this.rows.map(row => ({ ...row }))); this.emit(); }
  async add({ videoId, pageUrl, filePath }) {
    if (this.rows.length >= 50) throw new Error('Kolejka ma 50 wpisów. Usuń zakończone pozycje.');
    if (!/^\d{5,30}$/.test(videoId) || !isTikTok(pageUrl) || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.mp4') throw new Error('Nieprawidłowe zadanie kolejki.');
    if (this.rows.some(row => ['queued', 'running'].includes(row.status) && row.filePath.toLowerCase() === filePath.toLowerCase())) throw new Error('Ten plik jest już celem innego zadania.');
    const row = { id: randomUUID(), videoId, pageUrl, filePath, status: 'queued', error: '', createdAt: new Date().toISOString() };
    this.rows.push(row);
    try { await this.save(); } catch (error) { this.rows = this.rows.filter(item => item !== row); this.emit(); throw error; }
    if (!this.paused) void this.pump(); return row;
  }
  async setPaused(value) { this.paused = value; this.emit(); if (!value) void this.pump(); }
  async cancel(id) {
    const row = this.rows.find(row => row.id === id); if (!row) return;
    if (this.active?.row.id === id) { this.active.controller.abort(new Error('Zadanie anulowane.')); this.cancelTransfer(); }
    else if (row.status === 'queued') row.status = 'cancelled';
    await this.save();
  }
  async remove(id) { if (this.active?.row.id === id) throw new Error('Najpierw anuluj aktywne zadanie.'); this.rows = this.rows.filter(row => row.id !== id); await this.save(); }
  async pump() {
    if (this.pumping) return; this.pumping = true;
    try {
      while (!this.paused) {
        const row = this.rows.find(row => row.status === 'queued'); if (!row) break;
        const controller = new AbortController(); this.active = { row, controller }; row.status = 'running';
        try { await this.save(); const result = await this.run({ ...row }, controller.signal); row.status = result.status; row.error = result.error || ''; }
        catch (error) { row.status = controller.signal.aborted ? 'cancelled' : 'failed'; row.error = error.message; }
        finally { this.active = null; }
        try { await this.save(); } catch { this.paused = true; row.error = 'Nie udało się zapisać kolejki. Wstrzymano zadania.'; this.emit(); }
      }
    } finally { this.pumping = false; this.emit(); }
  }
}
module.exports = { DownloadQueue };
