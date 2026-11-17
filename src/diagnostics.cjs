class Diagnostics {
  /** @type {Array<{time: string, stage: string, code: string}>} */
  events;
  constructor() { this.events = []; }
  /** @param {string} stage @param {{ code?: string, message?: string }} error */
  record(stage, error) {
    const allowed = ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EIO', 'TIMEOUT', 'ABORT_ERR', 'ERR_ABORTED', 'ERR_BLOCKED_BY_CLIENT'];
    const candidate = error?.code || '';
    const code = allowed.includes(candidate) ? candidate : error?.message?.match(/HTTP (\d{3})/)?.[0] || 'UNEXPECTED';
    this.events.unshift({ time: new Date().toISOString(), stage: ['download', 'navigation', 'storage', 'queue', 'update', 'renderer'].includes(stage) ? stage : 'application', code });
    this.events = this.events.slice(0, 30);
  }
  /** @param {{ version: string, versions: { electron?: string, chrome?: string, node?: string }, platform: string, downloads: number, queued: number }} info */
  report({ version, versions, platform, downloads, queued }) {
    return JSON.stringify({ application: 'TikDesk', version, platform, runtime: { electron: versions.electron, chromium: versions.chrome, node: versions.node }, downloads, queued, events: this.events }, null, 2);
  }
}
module.exports = { Diagnostics };
