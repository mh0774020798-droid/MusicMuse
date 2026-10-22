export const VERSION = '2.0.0';
export const DEFAULT_SETTINGS = Object.freeze({ source: 'itunes', country: 'IL', layout: 'grid', sort: 'relevance', volume: .75, speed: 1, resume: true, autoNext: true, compact: false, reducedMotion: false });
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function formatTime(seconds) {
  if (!Number.isFinite(Number(seconds)) || seconds < 0) return '0:00';
  const n = Math.floor(seconds), h = Math.floor(n / 3600);
  return h ? `${h}:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
}
export function videoId(input) {
  try {
    const u = new URL(input); if (!['https:', 'http:'].includes(u.protocol)) return '';
    const id = u.hostname === 'youtu.be' ? u.pathname.split('/')[1] : ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'www.youtube-nocookie.com'].includes(u.hostname) ? (u.searchParams.get('v') || (/^\/(shorts|embed|live)\//.test(u.pathname) ? u.pathname.split('/')[2] : '')) : '';
    return /^[\w-]{11}$/.test(id) ? id : '';
  } catch { return ''; }
}
function text(value, max = 250) { return typeof value === 'string' ? value.slice(0, max) : ''; }
function safeURL(value, hosts) {
  try { const u = new URL(value); return u.protocol === 'https:' && (!hosts || hosts.some(h => u.hostname === h || u.hostname.endsWith('.' + h))) ? u.href : ''; } catch { return ''; }
}
export function normalizeTrack(value) {
  if (!value || typeof value !== 'object') return null;
  const source = value.source;
  if (!['youtube', 'itunes', 'local'].includes(source)) return null;
  let id = text(value.id, 100), url = '', yt = '';
  if (source === 'youtube') { yt = text(value.videoId) || videoId(value.url); if (!/^[\w-]{11}$/.test(yt)) return null; id = `youtube:${yt}`; url = `https://www.youtube.com/watch?v=${yt}`; }
  if (source === 'itunes') { if (!/^itunes:\d{1,20}$/.test(id)) return null; url = safeURL(value.url, ['apple.com']); if (!url) return null; }
  if (source === 'local' && !/^local:[\w-]{1,80}$/.test(id)) return null;
  return { id, source, videoId: yt, title: text(value.title) || 'ללא כותרת', artist: text(value.artist) || (source === 'local' ? 'מהמכשיר שלך' : 'אמן לא ידוע'),
    album: text(value.album), genre: text(value.genre), description: text(value.description, 1500),
    artwork: safeURL(value.artwork, source === 'youtube' ? ['ytimg.com'] : ['mzstatic.com']),
    previewUrl: source === 'itunes' ? safeURL(value.previewUrl, ['itunes.apple.com']) : '', url,
    duration: Math.max(0, Math.min(Number(value.duration) || 0, 86400 * 7)), views: Math.max(0, Number(value.views) || 0),
    publishedAt: text(value.publishedAt, 40), addedAt: Number(value.addedAt) || Date.now(), fetchedAt: Number(value.fetchedAt) || Date.now(),
    tags: Array.isArray(value.tags) ? value.tags.slice(0, 8).filter(x => typeof x === 'string').map(x => x.slice(0, 50)) : [],
    filename: text(value.filename), fileType: value.fileType === 'video' ? 'video' : 'audio', size: Math.max(0, Number(value.size) || 0) };
}
export function emptyState() { return { schema: 2, tracks: {}, likes: [], saved: [], queue: [], history: [], playlists: [], followed: [], hidden: [], blocked: [], searchHistory: [], positions: {}, settings: { ...DEFAULT_SETTINGS } }; }
const stringList = (input, limit = 1000) => [...new Set((Array.isArray(input) ? input : []).filter(x => typeof x === 'string' && x.length <= 250))].slice(0, limit);
export function sanitizeState(input) {
  const result = emptyState();
  if (!input || typeof input !== 'object') return result;
  if (input.tracks && typeof input.tracks === 'object' && !Array.isArray(input.tracks)) {
    for (const value of Object.values(input.tracks).slice(0, 1500)) { const track = normalizeTrack(value); if (track) result.tracks[track.id] = track; }
  }
  const known = id => Object.hasOwn(result.tracks, id);
  for (const field of ['likes', 'saved', 'queue', 'hidden']) result[field] = stringList(input[field]).filter(known);
  result.queue = result.queue.filter(id => result.tracks[id].source !== 'itunes');
  result.followed = stringList(input.followed, 100); result.blocked = stringList(input.blocked, 100); result.searchHistory = stringList(input.searchHistory, 12).map(x => x.slice(0, 150));
  result.history = (Array.isArray(input.history) ? input.history : []).filter(x => x && known(x.id) && Number.isFinite(x.at)).slice(0, 200).map(x => ({ id: x.id, at: x.at }));
  result.playlists = (Array.isArray(input.playlists) ? input.playlists : []).filter(x => x && /^pl:[\w-]+$/.test(x.id) && typeof x.name === 'string').slice(0, 100).map(x => ({ id: x.id, name: x.name.slice(0, 80), tracks: stringList(x.tracks).filter(known), createdAt: Number(x.createdAt) || Date.now() }));
  if (input.positions && typeof input.positions === 'object') for (const [id, pos] of Object.entries(input.positions).slice(0, 1000)) if (known(id) && Number.isFinite(pos) && pos >= 0) result.positions[id] = Math.min(pos, 604800);
  const s = input.settings || {};
  for (const k of ['resume', 'autoNext', 'compact', 'reducedMotion']) if (typeof s[k] === 'boolean') result.settings[k] = s[k];
  for (const [k, allowed] of Object.entries({ source: ['itunes', 'youtube'], country: ['IL', 'US', 'GB', 'FR', 'CA'], layout: ['grid', 'list'], sort: ['relevance', 'title', 'newest', 'duration'] })) if (allowed.includes(s[k])) result.settings[k] = s[k];
  if (Number.isFinite(s.volume)) result.settings.volume = Math.min(1, Math.max(0, s.volume));
  if ([.5, .75, 1, 1.25, 1.5, 2].includes(s.speed)) result.settings.speed = s.speed;
  return result;
}
export function mergeState(current, incoming) {
  const next = sanitizeState(incoming);
  const playlists = new Map(current.playlists.map(x => [x.id, x]));
  for (const p of next.playlists) playlists.set(p.id, playlists.has(p.id) ? { ...p, tracks: stringList([...playlists.get(p.id).tracks, ...p.tracks]) } : p);
  return sanitizeState({ ...current, tracks: { ...current.tracks, ...next.tracks }, likes: [...current.likes, ...next.likes], saved: [...current.saved, ...next.saved], queue: [...current.queue, ...next.queue], playlists: [...playlists.values()], followed: [...current.followed, ...next.followed], blocked: [...current.blocked, ...next.blocked], hidden: [...current.hidden, ...next.hidden], history: [...next.history, ...current.history].sort((a, b) => b.at - a.at), positions: { ...current.positions, ...next.positions } });
}
export function moveItem(list, index, direction) { const next = [...list], target = index + direction; if (index >= 0 && target >= 0 && target < next.length) [next[index], next[target]] = [next[target], next[index]]; return next; }
export function visibleTracks(tracks, { hidden = [], blocked = [], query = '', sort = 'relevance', genre = '' } = {}) {
  const q = query.trim().toLocaleLowerCase('he');
  const items = tracks.filter(x => x && !hidden.includes(x.id) && !blocked.includes(x.artist) && (!genre || x.genre === genre) && (!q || `${x.title} ${x.artist} ${x.album} ${x.tags.join(' ')}`.toLocaleLowerCase('he').includes(q)));
  if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'he'));
  if (sort === 'newest') items.sort((a, b) => (Date.parse(b.publishedAt) || b.addedAt) - (Date.parse(a.publishedAt) || a.addedAt));
  if (sort === 'duration') items.sort((a, b) => a.duration - b.duration);
  return items;
}
export function toM3U(tracks, name = 'Music Muse') {
  const clean = value => String(value).replace(/[\r\n]/g, ' ');
  return '#EXTM3U\n#PLAYLIST:' + clean(name) + '\n' + tracks.map(x => `#EXTINF:${Math.floor(x.duration || -1)},${clean(x.artist)} - ${clean(x.title)}\n${x.source === 'local' ? clean(x.filename) : x.url}\n`).join('');
}
export function parseM3U(content) {
  const output = []; let label = '';
  for (const line of content.split(/\r?\n/).slice(0, 5000)) {
    const value = line.trim();
    if (value.startsWith('#EXTINF:')) label = value.split(',').slice(1).join(',').slice(0, 250);
    else if (value && !value.startsWith('#')) { const id = videoId(value); if (id) output.push(normalizeTrack({ id: `youtube:${id}`, source: 'youtube', videoId: id, title: label || 'סרטון YouTube', artist: 'YouTube', artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` })); label = ''; }
  }
  return [...new Map(output.map(x => [x.id, x])).values()];
}
