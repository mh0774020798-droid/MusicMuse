import { DISCOVERY_ITEMS, YOUTUBE_CHANNELS } from '../public/discovery.js';

const caches = new WeakMap();
const text = (entry, tag) => new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`).exec(entry)?.[1] || '';
function decode(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (_, code) => {
    if (code[0] !== '#') return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[code.toLowerCase()];
    const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).slice(0, 250);
}
export function parseChannelFeed(xml, channel) {
  if (typeof xml !== 'string' || xml.length > 262144 || /<!DOCTYPE|<!ENTITY/i.test(xml)) return [];
  const items = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)) {
    const entry = match[1], videoId = text(entry, 'yt:videoId');
    if (!/^[\w-]{11}$/.test(videoId) || text(entry, 'yt:channelId') !== channel.id) continue;
    const title = decode(text(entry, 'title'));
    if (!title) continue;
    const kind = /live|בהופעה|הופעה חיה|Madison Square Garden/i.test(title) ? 'live' : /cover|קאבר|ביצוע אקוסטי/i.test(title) ? 'cover' : 'official';
    const published = text(entry, 'published');
    items.push({ id: 'youtube:' + videoId, source: 'youtube', videoId, title, artist: channel.name, kind, url: 'https://www.youtube.com/watch?v=' + videoId, artwork: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, publishedAt: Number.isFinite(Date.parse(published)) ? published : '', tags: ['ערוצי האתר', channel.alias || channel.name, kind === 'live' ? 'הופעה חיה' : kind === 'cover' ? 'קאבר' : 'קליפ'] });
    if (items.length === 30) break;
  }
  return items;
}
export async function discoverYouTube(fetcher = fetch) {
  const previous = caches.get(fetcher);
  if (previous && previous.until > Date.now()) return previous.promise;
  const entry = { until: Date.now() + 15 * 60_000 };
  entry.promise = Promise.allSettled(YOUTUBE_CHANNELS.map(async channel => {
    const url = new URL('https://www.youtube.com/feeds/videos.xml');
    url.searchParams.set('channel_id', channel.id);
    const response = await fetcher(url, { redirect: 'error', headers: { Accept: 'application/atom+xml, application/xml' }, signal: AbortSignal.timeout(9000) });
    if (!response.ok) throw new Error('Channel unavailable');
    const items = parseChannelFeed(await response.text(), channel);
    if (!items.length) throw new Error('Channel feed unavailable');
    return items;
  })).then(results => {
    const live = results.filter(x => x.status === 'fulfilled');
    if (!live.length) entry.until = Date.now() + 60_000;
    const items = [...new Map([...DISCOVERY_ITEMS.filter(x => x.source === 'youtube'), ...live.flatMap(x => x.value)].map(x => [x.id, x])).values()];
    return { items, mode: live.length ? 'channels' : 'collection', channelsAvailable: live.length, checkedAt: new Date().toISOString() };
  });
  caches.set(fetcher, entry);
  return entry.promise;
}
