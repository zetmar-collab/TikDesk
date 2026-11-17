const { randomUUID } = require('node:crypto');
const { isTikTok } = require('./policy.cjs');
function bookmarkUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !isTikTok(value)) throw new Error('Nieprawidłowy adres zakładki.');
  const url = new URL(value);
  if (/^\/(login|auth|passport)(\/|$)/.test(url.pathname)) throw new Error('Nie można zapisać strony logowania.');
  url.search = ''; url.hash = ''; return url.href;
}
function importBookmarks(text, existing) {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Plik zakładek przekracza 1 MB.');
  let data; try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Plik nie jest poprawnym JSON.'); }
  if (data?.format !== 'tikdesk-bookmarks' || data.version !== 1 || !Array.isArray(data.bookmarks) || data.bookmarks.length > 100) throw new Error('Nieobsługiwany format zakładek.');
  const rows = [];
  for (const row of data.bookmarks) {
    if (!row || typeof row.title !== 'string' || row.title.length > 100 || !row.title.trim()) throw new Error('Nieprawidłowy tytuł zakładki.');
    rows.push({ id: randomUUID(), title: row.title.trim(), url: bookmarkUrl(row.url) });
  }
  const result = [...existing]; let duplicates = 0;
  for (const row of rows) { if (result.some(item => bookmarkUrl(item.url) === row.url)) duplicates++; else result.push(row); }
  if (result.length > 100) throw new Error('Po imporcie przekroczysz limit 100 zakładek.');
  return { rows: result, added: result.length - existing.length, duplicates };
}
function exportBookmarks(rows) { return JSON.stringify({ format: 'tikdesk-bookmarks', version: 1, bookmarks: rows.map(row => ({ title: row.title, url: bookmarkUrl(row.url) })) }, null, 2); }
module.exports = { bookmarkUrl, importBookmarks, exportBookmarks };
