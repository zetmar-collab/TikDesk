const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePreferences } = require('../src/preferences.cjs');
const { resolvedTheme, themeCookies, themeCookieValue } = require('../src/theme.cjs');

test('Migrates version 1.1 settings without losing the selected viewport', () => {
  const settings = normalizePreferences({ mode: 'desktop' });
  assert.equal(settings.mode, 'desktop');
  assert.equal(settings.theme, 'dark');
  assert.equal(settings.muted, false);
});
test('Theme, mute and window state survive JSON serialization', () => {
  const input = { mode: 'desktop', theme: 'light', muted: true, window: { width: 1000, height: 700, maximized: true } };
  assert.deepEqual(normalizePreferences(JSON.parse(JSON.stringify(input))), input);
});
test('Invalid or corrupt settings cannot create unusable window dimensions', () => {
  for (const input of [null, [], { mode: 'wrong', theme: 'wrong', muted: 'false', window: { width: -2, height: 1e20 } }]) {
    const settings = normalizePreferences(input);
    assert.equal(settings.theme, 'dark');
    assert.equal(settings.window.width, 1180);
    assert.equal(settings.window.height, 900);
    assert.equal(settings.muted, false);
  }
});
test('System theme follows the current Windows appearance; explicit choices stay fixed', () => {
  assert.equal(resolvedTheme('system', true), 'dark');
  assert.equal(resolvedTheme('system', false), 'light');
  assert.equal(resolvedTheme('dark', false), 'dark');
  assert.equal(resolvedTheme('light', true), 'light');
});
test('TikTok appearance cookies are persistent and limited to the TikTok domain', () => {
  const cookies = themeCookies('dark');
  assert.equal(cookies.find(c => c.name === 'tiktok_webapp_theme').value, 'dark');
  assert.equal(cookies.find(c => c.name === 'tiktok_webapp_theme_source').value, 'auto');
  for (const cookie of cookies) {
    assert.ok(['.tiktok.com', 'www.tiktok.com'].includes(cookie.domain));
    assert.equal(cookie.secure, true);
    assert.ok(cookie.expirationDate > Date.now() / 1000 + 300 * 86400);
  }
});
test('Host-specific TikTok theme takes precedence over an older domain cookie', () => {
  assert.equal(themeCookieValue([
    { name: 'tiktok_webapp_theme', domain: '.tiktok.com', value: 'light' },
    { name: 'tiktok_webapp_theme', domain: 'www.tiktok.com', value: 'dark' }
  ], 'tiktok_webapp_theme'), 'dark');
});
test('A manual change in a domain cookie overrides an older host cookie', () => {
  assert.equal(themeCookieValue([
    { name: 'tiktok_webapp_theme', domain: '.tiktok.com', value: 'dark' },
    { name: 'tiktok_webapp_theme', domain: 'www.tiktok.com', value: 'light' }
  ], 'tiktok_webapp_theme', '.tiktok.com'), 'dark');
});
