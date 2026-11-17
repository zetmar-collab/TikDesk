const { isTikTok } = require('./policy.cjs');
function kinds(permission, details = {}) {
  if (permission === 'notifications') return ['notifications'];
  if (permission !== 'media') return [];
  const types = details.mediaTypes || (details.mediaType ? [details.mediaType] : ['audio', 'video']);
  return [...new Set(types.filter(type => ['audio', 'video'].includes(type)).map(type => type === 'audio' ? 'microphone' : 'camera'))];
}
class Permissions {
  constructor() { this.grants = new Map(); }
  key(origin, kind) { return `${new URL(origin).origin}|${kind}`; }
  allows(origin, permission, details) { const requested = kinds(permission, details); return isTikTok(origin) && requested.length > 0 && requested.every(kind => this.grants.has(this.key(origin, kind))); }
  grant(origin, permission, details) { if (isTikTok(origin)) for (const kind of kinds(permission, details)) this.grants.set(this.key(origin, kind), { id: this.key(origin, kind), origin: new URL(origin).origin, kind }); }
  revoke(id) { const row = this.grants.get(id); this.grants.delete(id); return row; }
  list() { return [...this.grants.values()]; }
  clear() { this.grants.clear(); }
}
module.exports = { Permissions, kinds };
