const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { VIDEO_SCRIPT, isMediaUrl, videoFilename } = require('../src/video.cjs');

function player(src, top = 0, paused = false, id = '') {
  return {
    currentSrc: src, paused, ended: false,
    getBoundingClientRect: () => ({ left: 0, right: 400, top, bottom: top + 700 }),
    closest: () => id ? { querySelector: () => ({ href: `https://www.tiktok.com/@test/video/${id}` }) } : null,
    querySelector: () => null
  };
}
function inspect(videos, metadata = null) {
  return vm.runInNewContext(VIDEO_SCRIPT, {
    document: { querySelectorAll: () => videos, querySelector: () => metadata ? { textContent: JSON.stringify(metadata) } : null },
    innerWidth: 420, innerHeight: 744,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1' }),
    location: { pathname: '/' }
  });
}
test('Selects the visible video, not a preloaded offscreen feed item', () => {
  const result = inspect([player('https://v.tiktokcdn.com/wrong.mp4', 800), player('https://v.tiktokcdn.com/right.mp4')]);
  assert.equal(result.url, 'https://v.tiktokcdn.com/right.mp4');
});
test('Can download a paused visible video', () => {
  assert.equal(inspect([player('https://v.tiktokcdn.com/paused.mp4', 0, true)]).source, 'video');
});
test('Reports no video for photo posts or offscreen players', () => {
  assert.ok(inspect([]).error);
  assert.ok(inspect([player('https://v.tiktokcdn.com/next.mp4', 800)]).error);
});
test('MediaSource fallback requires metadata belonging to exactly this item', () => {
  const videos = [player('blob:https://www.tiktok.com/player', 0, false, '123456789')];
  assert.ok(inspect(videos, { id: '987654321', video: { playAddr: 'https://v.tiktokcdn.com/wrong.mp4' } }).error);
  const result = inspect(videos, { item: { id: '123456789', video: { downloadAddr: 'https://v.tiktokcdn.com/right.mp4' } } });
  assert.equal(result.url, 'https://v.tiktokcdn.com/right.mp4');
  assert.equal(result.id, '123456789');
});
test('Media URLs reject local files, credentials, non-TikTok hosts and deceptive domains', () => {
  for (const url of ['https://v16.tiktokcdn.com/video', 'https://v.tiktokv.com/123', 'https://www.tiktok.com/media']) assert.equal(isMediaUrl(url), true);
  for (const url of ['file:///C:/test.mp4', 'http://v.tiktokcdn.com/video', 'https://127.0.0.1/video', 'https://tiktokcdn.com.evil.com/file', 'https://user:pass@v.tiktokcdn.com/file', 'https://v.tiktokcdn.com:123/file', 'https://example.com/video']) assert.equal(isMediaUrl(url), false);
});
test('Untrusted item IDs cannot control save paths or extensions', () => {
  assert.equal(videoFilename('123456789'), 'TikTok-123456789.mp4');
  for (const id of ['../../file', 'CON', 'x.exe', '', '123/456']) assert.equal(videoFilename(id, 123), 'TikTok-123.mp4');
});
test('MediaSource uses only the selected video player ancestors, never a feed list', () => {
  const video = player('blob:https://www.tiktok.com/current');
  video.__reactFiberTest = { memoizedProps: {}, return: {
    memoizedProps: { url: 'https://v.tiktokcdn.com/active.mp4', teaParams: { group_id: '123456789' } },
    return: { memoizedProps: { list: [{ videoInfo: { downloadAddr: 'https://v.tiktokcdn.com/other.mp4' } }] } }
  } };
  const result = inspect([video]);
  assert.equal(result.url, 'https://v.tiktokcdn.com/active.mp4');
  assert.equal(result.id, '123456789');
});
test('React alternate branch cannot return an old video after scrolling', () => {
  const video = player('blob:https://www.tiktok.com/current');
  const root = { stateNode: { current: {} } };
  video.__reactFiberTest = {
    memoizedProps: { url: 'https://v.tiktokcdn.com/old.mp4' }, return: root,
    alternate: { memoizedProps: { url: 'https://v.tiktokcdn.com/current.mp4' } }
  };
  assert.equal(inspect([video]).url, 'https://v.tiktokcdn.com/current.mp4');
});
