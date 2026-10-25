const { httpsUrl } = require('./policy.cjs');

function isMediaUrl(value) {
  const url = httpsUrl(value);
  return Boolean(url && (!url.port || url.port === '443') && ['tiktok.com', 'tiktokcdn.com', 'tiktokv.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'byteoversea.com', 'ibytedtos.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`)));
}

// Runs in the page, without a preload or access to Node. Never uses a different
// feed item's source as a fallback for the selected video.
function inspectPlayingVideo() {
  const visible = [...document.querySelectorAll('video')].map(video => {
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)) * Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
    const style = getComputedStyle(video);
    const shown = style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    return { video, area: shown ? area : 0, score: area * (!video.paused && !video.ended ? 1.15 : 1) };
  }).filter(item => item.area > 2500).sort((a, b) => b.score - a.score);
  if (!visible.length) return { error: 'Brak widocznego filmu. Otwórz film i rozpocznij odtwarzanie.' };
  const video = visible[0].video;
  const container = video.closest('article, [data-e2e="recommend-list-item-container"], [data-e2e="feed-item"]');
  const link = container?.querySelector('a[href*="/video/"]')?.href || '';
  let id = link.match(/\/video\/(\d+)/)?.[1] || (visible.length === 1 ? location.pathname.match(/\/video\/(\d+)/)?.[1] : '') || '';
  const source = video.currentSrc || video.src || video.querySelector('source')?.src || '';
  if (source.startsWith('https://')) return { url: source, id, source: 'video' };
  // TikTok's MediaSource player keeps the original MP4 address in the props of
  // this video's own React ancestors. Do not traverse siblings or feed lists.
  let element = video;
  let fiber;
  for (let i = 0; element && i < 8; i++, element = element.parentElement) {
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber'));
    if (key) { fiber = element[key]; break; }
  }
  if (fiber) {
    let root = fiber;
    for (let i = 0; root.return && i < 100; i++) root = root.return;
    if (root.stateNode?.current && root.stateNode.current !== root) fiber = fiber.alternate || fiber;
    const addresses = [];
    const downloads = [];
    for (let i = 0; fiber && i < 14; i++, fiber = fiber.return) {
      const props = fiber.memoizedProps || {};
      if (props.list) break;
      const itemId = String(props.teaParams?.group_id || props.videoSource?.groupId || '');
      if (id && itemId && id !== itemId) continue;
      if (!id && /^\d+$/.test(itemId)) id = itemId;
      const info = props.videoInfo;
      if (typeof info?.downloadAddr === 'string' && info.downloadAddr.startsWith('https://')) downloads.push(info.downloadAddr);
      for (const address of [props.url, props.src, info?.playAddr, props.videoSource?.playAddr, props.videoSource?.url]) {
        if (typeof address === 'string' && address.startsWith('https://')) addresses.push(address);
      }
    }
    const urls = [...new Set([...addresses, ...downloads])];
    if (urls.length) return { url: urls[0], id, source: 'player' };
  }
  // Some players expose a MediaSource blob. Only use embedded metadata when its
  // item ID is known to match this exact visible feed item.
  if (id) {
    const queue = [];
    for (const selector of ['#__UNIVERSAL_DATA_FOR_REHYDRATION__', '#SIGI_STATE']) {
      const text = document.querySelector(selector)?.textContent;
      if (text && text.length < 20_000_000) { try { queue.push(JSON.parse(text)); } catch {} }
    }
    let visited = 0;
    while (queue.length && visited++ < 30000) {
      const item = queue.shift();
      if (!item || typeof item !== 'object') continue;
      if (String(item.id || '') === id && item.video) {
        for (const address of [item.video.playAddr, item.video.downloadAddr]) {
          if (typeof address === 'string' && address.startsWith('https://')) return { url: address, id, source: 'metadata' };
        }
      }
      queue.push(...Object.values(item).filter(value => value && typeof value === 'object'));
    }
  }
  return { error: 'Ten film nie udostępnia bezpośredniego pliku do pobrania. Spróbuj w drugim trybie widoku lub wybierz inny film.' };
}

const VIDEO_SCRIPT = `(${inspectPlayingVideo.toString()})()`;
function videoFilename(id, timestamp = Date.now()) {
  return `TikTok-${/^\d{5,30}$/.test(id || '') ? id : timestamp}.mp4`;
}
module.exports = { isMediaUrl, VIDEO_SCRIPT, inspectPlayingVideo, videoFilename };
