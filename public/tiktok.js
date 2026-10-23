// Keep post IDs as strings: TikTok IDs exceed JavaScript's safe integer range.
const TIKTOK_HOSTS = new Set(['www.tiktok.com', 'tiktok.com', 'm.tiktok.com']);
function inputURL(value) {
  try { const url = new URL(String(value).trim()); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.port ? url : null; } catch { return null; }
}
export function parseTikTokURL(value) {
  const url = inputURL(value);
  if (!url || !TIKTOK_HOSTS.has(url.hostname)) return null;
  const match = /^\/@([A-Za-z0-9._]{1,32})\/video\/(\d{15,24})\/?$/.exec(url.pathname.replace(/^\/%40/i, '/@'));
  if (!match) return null;
  return { id: match[2], author: match[1], url: `https://www.tiktok.com/@${match[1]}/video/${match[2]}` };
}
export function isShortTikTokURL(value) {
  const url = inputURL(value);
  return Boolean(url && ((['vm.tiktok.com', 'vt.tiktok.com'].includes(url.hostname) && /^\/[A-Za-z0-9]{5,40}\/?$/.test(url.pathname)) || (TIKTOK_HOSTS.has(url.hostname) && /^\/t\/[A-Za-z0-9]{5,40}\/?$/.test(url.pathname))));
}
export function extractTikTokLinks(value) {
  const links = String(value).match(/https?:\/\/[^\s<>"']+/g) || [];
  const unique = new Map();
  for (const raw of links) {
    const input = raw.replace(/[),.;!?\u05be]+$/, '');
    const parsed = parseTikTokURL(input);
    if (parsed) unique.set(parsed.id, parsed.url);
    else if (isShortTikTokURL(input)) unique.set(input, input);
  }
  return [...unique.values()].slice(0, 20);
}
export function tikTokPlayerURL(id, { muted = false, autoplay = true, controls = false } = {}) {
  if (!/^\d{15,24}$/.test(id)) return '';
  const url = new URL(`https://www.tiktok.com/player/v1/${id}`);
  url.search = new URLSearchParams({ autoplay: autoplay ? '1' : '0', muted: muted ? '1' : '0', controls: controls ? '1' : '0', description: '0', music_info: '0', rel: '0', loop: '1' });
  return url.href;
}
export function parseTikTokPlayerMessage(event, frameWindow) {
  if (!frameWindow || event.source !== frameWindow || event.origin !== 'https://www.tiktok.com') return null;
  let data = event.data;
  // The live player also sends JSON strings, although the API docs show objects.
  if (typeof data === 'string') { if (data.length > 10000) return null; try { data = JSON.parse(data); } catch { return null; } }
  return data && typeof data === 'object' && data['x-tiktok-player'] === true && ['onPlayerReady', 'onStateChange', 'onCurrentTime', 'onMute', 'onPlayerError', 'onError'].includes(data.type) ? data : null;
}
export function isTikTokPlayerMessage(event, frameWindow) { return Boolean(parseTikTokPlayerMessage(event, frameWindow)); }
