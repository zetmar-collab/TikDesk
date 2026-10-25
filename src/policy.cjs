const HOME = 'https://www.tiktok.com/';
const ROUTES = Object.freeze({ home: HOME, login: `${HOME}login`, upload: `${HOME}tiktokstudio/upload`, live: `${HOME}live` });

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}
function isTikTok(value) {
  const url = httpsUrl(value);
  return Boolean(url && (url.hostname === 'tiktok.com' || url.hostname.endsWith('.tiktok.com')));
}
function isAuth(value) {
  const url = httpsUrl(value);
  return Boolean(url && (isTikTok(value) || ['accounts.google.com', 'appleid.apple.com', 'www.facebook.com', 'm.facebook.com'].includes(url.hostname)));
}
function layout(width, height, mode) {
  const area = { x: 238, y: 154, width: Math.max(1, width - 262), height: Math.max(1, height - 208) };
  if (mode === 'desktop') return area;
  const viewWidth = Math.min(420, area.width);
  return { x: area.x + Math.floor((area.width - viewWidth) / 2), y: area.y, width: viewWidth, height: area.height };
}
module.exports = { HOME, ROUTES, httpsUrl, isTikTok, isAuth, layout };
