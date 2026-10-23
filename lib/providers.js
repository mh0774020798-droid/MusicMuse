import { createHash, timingSafeEqual } from 'node:crypto';
import { parseTikTokURL, isShortTikTokURL } from '../public/tiktok.js';
import { searchCollection } from '../public/discovery.js';
import { discoverYouTube } from './discovery.js';

export class ApiError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const cache = new Map();
const buckets = new Map();
const TTL = 5 * 60_000;

export function getKey(request, env) {
  const key = (request.headers.get('x-youtube-key') || env.YOUTUBE_API_KEY || '').trim();
  if (key && !/^[\w-]{20,200}$/.test(key)) throw new ApiError('INVALID_KEY', 'מבנה מפתח YouTube אינו תקין.');
  return key;
}
export function authorize(request, env) {
  if (!env.APP_ACCESS_TOKEN) return;
  const expected = createHash('sha256').update(env.APP_ACCESS_TOKEN).digest();
  const actual = createHash('sha256').update(request.headers.get('x-access-token') || '').digest();
  if (!timingSafeEqual(expected, actual)) throw new ApiError('ACCESS_REQUIRED', 'נדרש קוד הגישה של האתר. אפשר להזין אותו בחלון החיבורים.', 401);
}
export function rateLimit(request, now = Date.now()) {
  // Per warm instance only; a deployment-wide limit should be set in Vercel Firewall.
  const ip = request.headers.get('x-real-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local';
  const entry = buckets.get(ip);
  if (!entry || entry.reset < now) buckets.set(ip, { count: 1, reset: now + 60_000 });
  else if (++entry.count > 45) throw new ApiError('RATE_LIMITED', 'יותר מדי בקשות בדקה. המתן רגע ונסה שוב.', 429);
  if (buckets.size > 2000) for (const [id, value] of buckets) if (value.reset < now) buckets.delete(id);
}
function safeHttps(value, hosts) {
  try { const u = new URL(value); return u.protocol === 'https:' && (!hosts || hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) ? u.href : ''; } catch { return ''; }
}
function decodeTitle(value = '') {
  return String(value).replace(/&(amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity, code) => {
    if (code.startsWith('#')) { const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity; }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }[code.toLowerCase()] || entity;
  });
}
export function isoDuration(value = '') {
  const m = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value);
  return m ? Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0) : 0;
}
async function remote(url, fetcher, timeout = 12_000) {
  let response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } }); }
  catch { throw new ApiError('PROVIDER_UNAVAILABLE', 'ספק המוזיקה לא השיב. בדוק חיבור או סינון ונסה שוב.', 502); }
  let data;
  try { data = await response.json(); } catch { throw new ApiError('BAD_PROVIDER_RESPONSE', 'ספק המוזיקה החזיר תשובה שאינה תקינה.', 502); }
  if (!response.ok) {
    const reasons = data?.error?.errors?.map(x => x.reason) || [];
    if (response.status === 429 || reasons.some(x => /quota|dailyLimit/i.test(x))) throw new ApiError('QUOTA_EXCEEDED', 'מכסת הבקשות של ספק המוזיקה הסתיימה. נסה שוב מאוחר יותר או בדוק את המכסה בחשבון.', 429);
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new ApiError('KEY_REJECTED', 'המפתח נדחה או שה־API אינו פעיל. הפעל YouTube Data API v3 ובדוק את הגבלות המפתח.', 403);
    throw new ApiError('PROVIDER_UNAVAILABLE', 'ספק המוזיקה אינו זמין כרגע.', 502);
  }
  return data;
}
function cached(key, load) {
  const current = cache.get(key);
  if (current && current.until > Date.now()) return Promise.resolve({ ...current.value, cached: true });
  return load().then(value => {
    if (cache.size > 150) cache.delete(cache.keys().next().value);
    cache.set(key, { until: Date.now() + TTL, value });
    return { ...value, cached: false };
  });
}
export function validateSearch(params) {
  const q = (params.get('q') || '').trim();
  const source = params.get('source') || 'itunes';
  if (!['itunes', 'youtube'].includes(source)) throw new ApiError('INVALID_SOURCE', 'מקור החיפוש אינו נתמך.');
  if ((!q && source !== 'youtube') || q.length > 150) throw new ApiError('INVALID_QUERY', 'יש להזין חיפוש באורך 1–150 תווים.');
  const kind = params.get('kind') || 'all';
  if (!['all', 'live', 'cover', 'official'].includes(kind)) throw new ApiError('INVALID_KIND', 'סוג התצוגה אינו נתמך.');
  const country = (params.get('country') || 'IL').toUpperCase();
  if (!['IL', 'US', 'GB', 'FR', 'CA'].includes(country)) throw new ApiError('INVALID_COUNTRY', 'אזור החיפוש אינו נתמך.');
  const order = params.get('order') || 'relevance';
  if (!['relevance', 'date', 'viewCount'].includes(order)) throw new ApiError('INVALID_ORDER', 'סדר החיפוש אינו נתמך.');
  const duration = params.get('duration') || 'any';
  if (!['any', 'short', 'medium', 'long'].includes(duration)) throw new ApiError('INVALID_DURATION', 'סינון האורך אינו תקין.');
  const page = params.get('page') || '';
  if (page.length > 300 || (page && !/^[\w=-]+$/.test(page))) throw new ApiError('INVALID_PAGE', 'סמן העמוד אינו תקין.');
  const offset = Number(params.get('offset') || 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 180) throw new ApiError('INVALID_PAGE', 'מספר העמוד אינו תקין.');
  return { q, source, country, order, duration, page, offset, kind };
}
export async function searchMusic(options, key, fetcher = fetch) {
  const { q, source, country, order, duration, page, offset, kind = 'all' } = options;
  if (source === 'youtube' && (!key || !q)) {
    const feed = await discoverYouTube(fetcher);
    return { ...searchCollection({ q, kind, offset, items: feed.items }), mode: feed.mode, channelsAvailable: feed.channelsAvailable };
  }
  const fingerprint = source === 'youtube' ? createHash('sha256').update(key).digest('hex') : '';
  return cached(JSON.stringify({ ...options, fingerprint }), async () => {
    if (source === 'itunes') {
      const url = new URL('https://itunes.apple.com/search');
      url.search = new URLSearchParams({ term: q, country, media: 'music', entity: 'song', explicit: 'No', limit: '200' });
      const data = await remote(url, fetcher);
      const tracks = (data.results || []).filter(x => x.kind === 'song' && x.trackId && x.trackExplicitness !== 'explicit').map(x => ({
        id: `itunes:${x.trackId}`, source: 'itunes', title: String(x.trackName || ''), artist: String(x.artistName || ''),
        album: String(x.collectionName || ''), genre: String(x.primaryGenreName || ''),
        artwork: safeHttps(x.artworkUrl100?.replace('100x100', '600x600'), ['mzstatic.com']),
        previewUrl: safeHttps(x.previewUrl, ['itunes.apple.com']), url: safeHttps(x.trackViewUrl, ['apple.com']),
        duration: Math.round((x.trackTimeMillis || 0) / 1000), publishedAt: x.releaseDate || '', tags: ['קטע היכרות', x.primaryGenreName].filter(Boolean), fetchedAt: Date.now()
      }));
      return { items: tracks.slice(offset, offset + 20), nextOffset: offset + 20 < tracks.length ? offset + 20 : null, nextPage: null, total: tracks.length, source, query: q };
    }
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.search = new URLSearchParams({ part: 'snippet', type: 'video', videoEmbeddable: 'true', videoSyndicated: 'true', videoCategoryId: '10', safeSearch: 'strict', maxResults: '20', q: q + ({ live: ' live performance concert', cover: ' acoustic cover', official: ' official music video' }[kind] || ''), key, regionCode: country, relevanceLanguage: 'he', order, videoDuration: duration, ...(page ? { pageToken: page } : {}) });
    const data = await remote(url, fetcher);
    const ids = (data.items || []).map(x => x.id?.videoId).filter(id => /^[\w-]{11}$/.test(id));
    let details = new Map();
    if (ids.length) {
      const more = new URL('https://www.googleapis.com/youtube/v3/videos');
      more.search = new URLSearchParams({ part: 'contentDetails,statistics', id: ids.join(','), key });
      const extra = await remote(more, fetcher);
      details = new Map((extra.items || []).map(x => [x.id, x]));
    }
    return { items: (data.items || []).filter(x => ids.includes(x.id?.videoId)).map(x => {
      const id = x.id.videoId, s = x.snippet, detail = details.get(id);
      return { id: `youtube:${id}`, videoId: id, source: 'youtube', title: decodeTitle(s.title), artist: decodeTitle(s.channelTitle), channelId: s.channelId,
        description: s.description, artwork: safeHttps(s.thumbnails?.high?.url || s.thumbnails?.medium?.url, ['ytimg.com']),
        url: `https://www.youtube.com/watch?v=${id}`, duration: isoDuration(detail?.contentDetails?.duration),
        views: Number(detail?.statistics?.viewCount || 0), publishedAt: s.publishedAt, tags: ['YouTube'], fetchedAt: Date.now() };
    }), nextPage: data.nextPageToken || null, nextOffset: null, total: data.pageInfo?.totalResults || 0, source, query: q };
  });
}
export async function checkConnections(key, fetcher = fetch) {
  const tasks = [
    ['catalog', async () => { const u = new URL('https://itunes.apple.com/search'); u.search = new URLSearchParams({ term: 'Avraham Fried', media: 'music', entity: 'song', limit: '1', country: 'IL' }); const data = await remote(u, fetcher, 10000); if (!Array.isArray(data.results)) throw new ApiError('BAD_PROVIDER_RESPONSE', 'תשובת הקטלוג אינה תקינה.', 502); return 'קטלוג המוזיקה השיב לבקשת בדיקה'; }],
    ['youtube', async () => { if (!key) return null; const u = new URL('https://www.googleapis.com/youtube/v3/videos'); u.search = new URLSearchParams({ part: 'id', id: 'invalid0000', key }); await remote(u, fetcher, 10000); return 'המפתח התקבל ב־YouTube Data API'; }]
  ];
  const results = await Promise.all(tasks.map(async ([id, fn]) => {
    const start = Date.now();
    try { const message = await fn(); return { id, status: message ? 'ok' : 'unconfigured', message: message || 'לא הוגדר מפתח YouTube', latency: Date.now() - start }; }
    catch (error) { return { id, status: 'error', code: error.code || 'PROVIDER_UNAVAILABLE', message: error.message, latency: Date.now() - start }; }
  }));
  return { checkedAt: new Date().toISOString(), checks: [{ id: 'server', status: 'ok', message: 'שרת Music Muse זמין', latency: 0 }, ...results], youtubeConfigured: Boolean(key), version: '2.2.0' };
}
export function youtubeId(input) {
  try {
    const u = new URL(input);
    if (!['https:', 'http:'].includes(u.protocol)) return '';
    let id = '';
    if (u.hostname === 'youtu.be') id = u.pathname.split('/')[1];
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname)) id = u.searchParams.get('v') || (/^\/(shorts|embed|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : '');
    return /^[\w-]{11}$/.test(id) ? id : '';
  } catch { return ''; }
}
export async function videoInfo(input, fetcher = fetch) {
  const id = youtubeId(input);
  if (!id) throw new ApiError('INVALID_VIDEO', 'יש להזין קישור תקין לסרטון YouTube בודד.');
  const base = { id: `youtube:${id}`, source: 'youtube', videoId: id, title: 'סרטון YouTube', artist: 'YouTube', url: `https://www.youtube.com/watch?v=${id}`, artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, tags: ['קישור אישי'], fetchedAt: Date.now() };
  try {
    const u = new URL('https://www.youtube.com/oembed'); u.search = new URLSearchParams({ url: base.url, format: 'json' });
    const data = await remote(u, fetcher, 7000);
    return { item: { ...base, title: String(data.title || base.title), artist: String(data.author_name || base.artist) }, metadataAvailable: true };
  } catch { return { item: base, metadataAvailable: false, warning: 'הקישור נוסף, אבל לא ניתן היה לקבל כותרת. ההשמעה תלויה בזמינות הסרטון ובהרשאות ההטמעה שלו.' }; }
}

export async function tikTokInfo(input, fetcher = fetch) {
  let post = parseTikTokURL(input);
  if (!post && !isShortTikTokURL(input)) throw new ApiError('INVALID_TIKTOK_VIDEO', 'יש להזין קישור תקין לסרטון TikTok.');
  // Resolve only TikTok's own short links. Never follow redirects to another host.
  let target = String(input).trim();
  for (let attempt = 0; !post && attempt < 3; attempt++) {
    let response;
    try { response = await fetcher(target, { redirect: 'manual', signal: AbortSignal.timeout(4000) }); }
    catch { throw new ApiError('TIKTOK_LINK_UNAVAILABLE', 'הקישור המקוצר לא השיב. נסה להעתיק את הקישור המלא לסרטון.', 502); }
    const location = response.headers.get('location');
    if (response.status < 300 || response.status >= 400 || !location) break;
    try { target = new URL(location, target).href; } catch { break; }
    post = parseTikTokURL(target);
    if (!post && !isShortTikTokURL(target)) throw new ApiError('INVALID_TIKTOK_VIDEO', 'הקישור אינו מפנה לסרטון TikTok נתמך. נסה את הקישור המלא.');
  }
  if (!post) throw new ApiError('TIKTOK_LINK_UNAVAILABLE', 'לא ניתן לפענח את הקישור המקוצר. העתק קישור מלא שמכיל ‎/@user/video/‎.', 422);
  const base = { id: `tiktok:${post.id}`, tiktokId: post.id, source: 'tiktok', title: 'סרטון TikTok', artist: '@' + post.author, url: post.url, tags: ['TikTok'], fetchedAt: Date.now() };
  try {
    const url = new URL('https://www.tiktok.com/oembed'); url.search = new URLSearchParams({ url: post.url });
    const data = await remote(url, fetcher, 7000);
    if (data.type !== 'video' || data.provider_name !== 'TikTok') throw new Error('Unexpected oEmbed response');
    return { item: { ...base, title: String(data.title || base.title).slice(0, 250), artist: String(data.author_name || base.artist).slice(0, 250), artwork: safeHttps(data.thumbnail_url, ['tiktokcdn.com', 'tiktokcdn-us.com', 'muscdn.com', 'tiktok.com', 'tiktokv.com', 'byteoversea.com', 'ibytedtos.com']) }, metadataAvailable: true };
  } catch {
    return { item: base, metadataAvailable: false, warning: 'הקישור נוסף ללא פרטי הסרטון. הנגן הרשמי יבדוק את זמינותו בעת הפתיחה.' };
  }
}
