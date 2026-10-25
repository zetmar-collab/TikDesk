const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isTikTok, isAuth, httpsUrl, layout, ROUTES } = require('../src/policy.cjs');

test('TikTok navigation accepts HTTPS and actual subdomains only', () => {
  for (const url of ['https://www.tiktok.com/', 'https://tiktok.com/@test', 'https://vm.tiktok.com/abc']) assert.equal(isTikTok(url), true, url);
  for (const url of ['https://tiktok.com.evil.com', 'https://eviltiktok.com', 'https://tiktok.com@evil.com', 'https://user:pass@tiktok.com', 'http://tiktok.com', 'file:///C:/Windows', 'javascript:alert(1)', 'tiktok://home', null, '']) assert.equal(isTikTok(url), false, url);
});
test('Only exact identity provider hosts are allowed in auth windows', () => {
  for (const url of ['https://accounts.google.com/v3/signin', 'https://appleid.apple.com/auth', 'https://www.facebook.com/dialog/oauth', 'https://www.tiktok.com/login']) assert.equal(isAuth(url), true);
  for (const url of ['https://accounts.google.com.evil.com', 'https://evil.facebook.com', 'https://google.com', 'https://example.com']) assert.equal(isAuth(url), false);
});
test('External links exclude executable protocols and URL credentials', () => {
  assert.equal(httpsUrl('https://example.com').hostname, 'example.com');
  for (const url of ['file:///tmp/test', 'javascript:alert(1)', 'data:text/html,test', 'https://a:b@example.com']) assert.equal(httpsUrl(url), null);
});
test('Built-in routes remain on TikTok', () => {
  for (const url of Object.values(ROUTES)) assert.equal(isTikTok(url), true);
});
test('Mobile viewport stays centered and fits supported window sizes', () => {
  for (const [width, height] of [[800, 640], [1180, 900], [1920, 1080]]) {
    const bounds = layout(width, height, 'mobile');
    assert.equal(bounds.width, 420);
    assert.ok(bounds.x >= 238);
    assert.ok(bounds.x + bounds.width <= width - 24);
    assert.equal(bounds.y + bounds.height, height - 54);
  }
});
test('Desktop viewport fills the available area', () => {
  assert.deepEqual(layout(1180, 900, 'desktop'), { x: 238, y: 154, width: 918, height: 692 });
});
