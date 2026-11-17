const { bounded } = require('./async.cjs');
const agents = new Map();
function proxyRoute(value) {
  const route = String(value || 'DIRECT').split(';')[0].trim();
  if (route === 'DIRECT') return null;
  const match = route.match(/^(PROXY|HTTPS) ([a-zA-Z0-9.\-[\]:]+)$/);
  if (!match) throw new Error('Proxy SOCKS lub wymagający uwierzytelnienia nie jest obsługiwany przez pobieranie.');
  const url = new URL(`${match[1] === 'HTTPS' ? 'https' : 'http'}://${match[2]}`);
  if (!url.hostname || url.username || url.password) throw new Error('Nieprawidłowa konfiguracja proxy.');
  return url.href;
}
// Obtain cookies only for the validated destination; honor Chromium's system/PAC proxy.
async function sessionFetch(session, url, options, transport = fetch, createAgent = uri => new (require('undici').ProxyAgent)(uri)) {
  options.signal.throwIfAborted();
  const cookies = await session.cookies.get({ url });
  options.signal.throwIfAborted();
  const headers = { ...options.headers };
  if (cookies.length) headers.Cookie = cookies.map(cookie => cookie.name + '=' + cookie.value).join('; ');
  const route = proxyRoute(await bounded(session.resolveProxy(url), { signal: options.signal, timeoutMs: 10000 }));
  let dispatcher;
  if (route) {
    if (!agents.has(route)) { if (agents.size >= 8) { const [key, old] = agents.entries().next().value; void old.destroy().catch(() => {}); agents.delete(key); } agents.set(route, createAgent(route)); }
    dispatcher = agents.get(route);
  }
  return transport(url, { ...options, headers, ...(dispatcher ? { dispatcher } : {}) });
}
async function closeNetwork() { await Promise.allSettled([...agents.values()].map(agent => agent.destroy())); agents.clear(); }
module.exports = { sessionFetch, proxyRoute, closeNetwork };
