const COOKIE_URL = 'https://www.tiktok.com/';
function resolvedTheme(theme, systemDark) {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}
function themeCookies(theme, preference = 'system') {
  return [
    { url: COOKIE_URL, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme_source', value: preference === 'system' ? 'auto' : preference },
    { url: COOKIE_URL, domain: '.tiktok.com', path: '/', name: 'tiktok_webapp_theme', value: theme }
  ].flatMap(cookie => ['.tiktok.com', 'www.tiktok.com'].map(domain => ({ ...cookie, domain, secure: true, expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400 })));
}
function themeCookieValue(cookies, name, domain) {
  const matches = cookies.filter(cookie => cookie.name === name);
  return (matches.find(cookie => domain && cookie.domain === domain) || matches.find(cookie => cookie.domain === 'www.tiktok.com') || matches[0])?.value;
}
function siteThemePreference(source, theme) {
  if (source === 'auto') return 'system';
  if (['dark', 'light'].includes(source)) return source;
  return source && ['dark', 'light'].includes(theme) ? theme : null;
}
module.exports = { resolvedTheme, themeCookies, themeCookieValue, siteThemePreference };
