import { VERSION, escapeHtml as esc, formatTime, normalizeTrack, videoId, emptyState, sanitizeState, mergeState, moveItem, visibleTracks, toM3U, parseM3U } from './core.js';
import { loadState, saveState, fileStore } from './storage.js';
import { parseTikTokURL, isShortTikTokURL, extractTikTokLinks } from './tiktok.js';
import { TikTokFeed } from './shorts.js';
import { initCreatorPromo } from './creator-promo.js';
import { DISCOVERY_ITEMS, discoveryTracks, seedDiscovery, searchCollection } from './discovery.js';
import { YouTubeFeed } from './watch-feed.js';
import { loadYouTubeAPI as ytAPI } from './youtube.js';
import { orderFeed, channelFeedEntries } from './feed-order.js';

const $ = id => document.getElementById(id);
let state = loadState();
if (seedDiscovery(state)) saveState(state);
let tab = 'watch', activePlaylist = '', results = [], query = '', loading = false, nextPage = null, nextOffset = null, total = 0;
let watchIds = orderFeed(discoveryTracks('youtube'), state.history, state.followed).map(x => x.id), watchRefreshing = false, feedNote = 'מוכן לצפייה';
const playlistIds = new Set();
let searchController, searchVersion = 0, lastSearch = null, lastError = '', storageWarning = false;
let accessToken = '', healthReport = null, configured = false, accessProtected = false, collectionMode = true;
let current = null, isPlaying = false, currentPosition = 0, currentDuration = 0, queueIndex = -1;
let ytPlayer = null, ytPlayerReady = null, youtubeLoading = false, playVersion = 0, activeObjectURL = '', repeat = 'off', shuffle = false;
let lastPositionSave = 0, sleepTimer = null, sleepUntil = 0, installPrompt = null, dialogCleanup = null, toastTimer;
let currentMedia = $('audio');
const kindQueries = { live: ' live performance concert', cover: ' acoustic cover', official: ' official music video' };
const sourceNames = { youtube: 'YouTube', itunes: 'iTunes', local: 'מהמכשיר שלך', tiktok: 'TikTok' };
const isRemoteTab = () => ['discover', 'live', 'cover', 'official'].includes(tab);
const track = id => state.tracks[id];
const button = (action, label, extra = '', cls = 'secondary') => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const shorts = new TikTokFeed($('tiktokView'), {
  add: () => tikTokLinkDialog(),
  youtube: () => { setTab('watch'); render(); },
  settings,
  like: id => toggle('likes', id), save: id => toggle('saved', id),
  share: id => shareTrack(id), menu: id => trackMenu(id), onPlay: item => recordPlay(item),
  onActivate: () => { savePosition(); pause(); $('stage').hidden = true; }
});
const watchFeed = new YouTubeFeed($('watchView'), {
  like: id => toggle('likes', id), save: id => toggle('saved', id), menu: id => trackMenu(id),
  settings, refresh: refreshViewingFeed, onPlay: item => { if (!track(item.id)) remember([item]); recordPlay(track(item.id)); },
  onItem: item => { if (!track(item.id) || track(item.id).title.startsWith('סרטון מערוץ ')) remember([item]); return track(item.id); },
  onDiscover: items => { for (const item of items) playlistIds.add(item.id); remember(items.filter(item => !track(item.id))); watchIds = [...new Set([...watchIds, ...items.map(x => x.id)])]; persist(); if (tab === 'watch') render(); },
  onActivate: () => { savePosition(); pause(); $('stage').hidden = true; }
});

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3800); }
function persist() {
  if (!saveState(state) && !storageWarning) { storageWarning = true; toast('לא ניתן לשמור בדפדפן. ייצא גיבוי דרך ההגדרות לפני סגירת הלשונית.'); }
  updateStats();
}
function remember(items) {
  for (const value of items) { const item = normalizeTrack(value); if (item) state.tracks[item.id] = { ...state.tracks[item.id], ...item }; }
  // Keep referenced records; bound transient search metadata.
  const pinned = new Set([...DISCOVERY_ITEMS.map(x => x.id), ...state.likes, ...state.saved, ...state.queue, ...state.history.map(x => x.id), ...state.playlists.flatMap(x => x.tracks), ...(current ? [current.id] : [])]);
  const transient = Object.values(state.tracks).filter(x => x.source !== 'local' && !pinned.has(x.id)).sort((a, b) => b.fetchedAt - a.fetchedAt);
  for (const item of transient.slice(300)) delete state.tracks[item.id];
}
function updateStats() {
  $('likeCount').textContent = state.likes.length; $('saveCount').textContent = state.saved.length; $('viewCount').textContent = new Set(state.history.map(x => x.id)).size;
  $('queueCount').textContent = state.queue.length;
  $('tasteArtists').innerHTML = state.followed.slice(0, 4).map(x => `<button data-action="search-artist" data-artist="${esc(x)}">${esc(x)}</button>`).join('');
  $('nowLike').classList.toggle('on', Boolean(current && state.likes.includes(current.id))); $('nowLike').textContent = current && state.likes.includes(current.id) ? '♥' : '♡';
  renderQueue();
}
function applySettings() {
  watchFeed.autoNext = state.settings.autoNext; watchFeed.reducedMotion = state.settings.reducedMotion; shorts.reducedMotion = state.settings.reducedMotion;
  $('source').value = state.settings.source; $('sort').value = state.settings.sort;
  $('volume').value = state.settings.volume; $('speed').value = state.settings.speed;
  document.body.classList.toggle('compact', state.settings.compact); document.body.classList.toggle('reduced-motion', state.settings.reducedMotion);
  currentMedia.volume = state.settings.volume;
  if (ytPlayer?.setVolume) ytPlayer.setVolume(state.settings.volume * 100);
}
function showMessage(text = '', type = 'info') { $('message').textContent = text; $('message').className = type === 'error' ? 'inline-error' : 'info-message'; $('message').hidden = !text; }
function openExternal(url) { const w = window.open(url, '_blank', 'noopener,noreferrer'); if (!w) { /* noopener can return null even on success */ } }
async function api(endpoint, params = {}, signal) {
  const url = new URL('/api/' + endpoint, location.origin); for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  const headers = { Accept: 'application/json' }; if (accessToken) headers['x-access-token'] = accessToken;
  const timeout = AbortSignal.timeout(25000), requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try { response = await fetch(url, { headers, signal: requestSignal, cache: 'no-store' }); }
  catch (error) { if (signal?.aborted) throw error; const e = new Error(navigator.onLine ? 'לא התקבלה תשובה מהשרת. בדוק שהאתר עלה ל־Vercel, או נסה שוב.' : 'אין חיבור לאינטרנט. הספרייה המקומית עדיין זמינה.'); e.code = 'NETWORK_ERROR'; throw e; }
  let data;
  try { data = await response.json(); } catch { const e = new Error('השרת אינו מחזיר תשובת API. יש להפעיל את הפרויקט ב־Vercel או באמצעות npm start.'); e.code = 'API_NOT_RUNNING'; throw e; }
  if (!response.ok) { const error = new Error(data.error?.message || 'הבקשה נכשלה.'); error.code = data.error?.code; throw error; }
  return data;
}
function updateSuggestions() {
  const suggestions = [...new Set([...state.searchHistory.slice(0, 3), 'ישי ריבו', 'בני פרידמן', 'מרדכי שפירא', 'הופעה חיה'])].slice(0, 6);
  $('suggestions').innerHTML = '<span>מתחילים עם</span>' + suggestions.map(x => `<button data-action="search-artist" data-artist="${esc(x)}">${esc(x)}</button>`).join('');
}
function setTab(value, playlist = '') {
  const changed = tab !== value;
  if (tab === 'tiktok' && value !== 'tiktok') shorts.hide();
  if (tab === 'watch' && value !== 'watch') watchFeed.hide();
  tab = value; activePlaylist = playlist; $('localFilter').value = ''; $('genre').value = ''; $('duration').value = 'any'; lastError = ''; showMessage();
  document.querySelectorAll('[data-tab]').forEach(b => { const selected = b.dataset.tab === tab; b.classList.toggle('selected', selected); if (selected) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const viewing = ['watch', 'tiktok'].includes(tab);
  $('filters').hidden = viewing || (tab === 'playlists' && !activePlaylist);
  if (viewing && changed) { savePosition(); pause(); $('stage').hidden = true; }
  $('playerbar').hidden = viewing || !current;
  document.body.classList.toggle('has-player', !viewing && Boolean(current));
  if (!isRemoteTab()) { searchController?.abort(); searchVersion++; loading = false; }
}
function currentItems() {
  if (tab === 'watch') return [...channelFeedEntries(), ...watchIds.map(track)];
  if (tab === 'tiktok') return Object.values(state.tracks).filter(x => x.source === 'tiktok').sort((a, b) => b.addedAt - a.addedAt);
  if (tab === 'saved') return state.saved.map(track);
  if (tab === 'liked') return state.likes.map(track);
  if (tab === 'history') return [...new Set(state.history.map(x => x.id))].map(track);
  if (tab === 'local') return Object.values(state.tracks).filter(x => x.source === 'local').sort((a, b) => b.addedAt - a.addedAt);
  if (tab === 'playlists') return (state.playlists.find(x => x.id === activePlaylist)?.tracks || []).map(track);
  return results.map(track);
}
function filteredItems() {
  let items = visibleTracks(currentItems().filter(Boolean), { hidden: state.hidden, blocked: state.blocked, query: $('localFilter').value, sort: state.settings.sort, genre: $('genre').value });
  const duration = $('duration').value;
  if (duration !== 'any') items = items.filter(x => duration === 'short' ? x.duration > 0 && x.duration < 240 : duration === 'medium' ? x.duration >= 240 && x.duration <= 1200 : x.duration > 1200);
  return items;
}
function card(x) {
  const liked = state.likes.includes(x.id), saved = state.saved.includes(x.id), preview = x.source === 'itunes';
  const artwork = (x.artwork ? `<img src="${esc(x.artwork)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '') + '<span class="fallback-note" aria-hidden="true">♫</span>';
  const playlist = tab === 'playlists' && activePlaylist;
  return `<article class="clip ${current?.id === x.id ? 'playing-card' : ''}" data-id="${esc(x.id)}"><div class="clip-head"><div class="creator"><div class="avatar">${x.source === 'local' ? '♫' : x.source === 'youtube' ? '▶' : '♪'}</div><div><b title="${esc(x.artist)}">${esc(x.artist)}</b><small>${esc(x.source === 'local' ? 'ספרייה אישית' : x.genre || (x.publishedAt ? new Date(x.publishedAt).getFullYear() || 'מוזיקה' : 'מוזיקה'))}</small></div></div><span class="source ${x.source}">${esc(sourceNames[x.source])}</span></div><button class="artwork" data-action="play" data-id="${esc(x.id)}" aria-label="${preview ? 'השמעת קטע היכרות' : 'ניגון'}: ${esc(x.title)}">${artwork}<span class="play-overlay">▶</span>${preview ? '<span class="preview-badge">קטע היכרות</span>' : ''}<span class="duration-label">${x.duration ? formatTime(x.duration) : x.source === 'youtube' ? 'וידאו' : x.source === 'tiktok' ? 'TikTok' : 'מקומי'}</span></button><div class="details"><h3 title="${esc(x.title)}">${esc(x.title)}</h3><p>${esc(x.album || x.artist)}</p><div class="tags">${x.tags.slice(0, 2).map(t => `<span class="tag">${esc(t)}</span>`).join('')}${x.views ? `<span class="tag">${new Intl.NumberFormat('he', { notation: 'compact' }).format(x.views)} צפיות</span>` : ''}</div></div>${preview ? `<div class="card-store"><span>provided courtesy of iTunes</span><a class="store-badge" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer"><small>Download on</small> iTunes</a></div>` : ''}<div class="actions"><button class="action ${liked ? 'on' : ''}" data-action="like" data-id="${esc(x.id)}" aria-pressed="${liked}">${liked ? '♥ אהבתי' : '♡ אהבתי'}</button><button class="action ${saved ? 'on' : ''}" data-action="save" data-id="${esc(x.id)}" aria-pressed="${saved}">${saved ? '✓ נשמר' : '＋ שמירה'}</button><button class="action menu-action" data-action="track-menu" data-id="${esc(x.id)}" aria-label="עוד אפשרויות: ${esc(x.title)}">⋯</button>${playlist ? `<button class="action menu-action" data-action="playlist-remove" data-id="${esc(x.id)}" aria-label="הסרה מהפלייליסט">✕</button>` : ''}</div></article>`;
}
function render() {
  const isTikTok = tab === 'tiktok', isWatch = tab === 'watch';
  document.body.classList.toggle('watch-mode', isTikTok || isWatch);
  $('feed').hidden = isTikTok || isWatch; $('watchView').hidden = !isWatch; $('tiktokView').hidden = !isTikTok; $('layoutBtn').hidden = isTikTok || isWatch;
  if (isWatch) {
    const items = filteredItems();
    $('sectionTitle').textContent = 'פחות לחפש. יותר לגלות.'; $('sectionEyebrow').textContent = 'YOUR NEXT FAVORITE';
    $('resultCount').textContent = `${items.filter(x => !x.channelId).length} סרטונים · YouTube · ${playlistIds.size ? 'רשימות הערוצים נטענו אוטומטית' : feedNote}${watchRefreshing ? ' · מעדכנים…' : ''}`;
    $('loadMore').hidden = true; $('feed').setAttribute('aria-busy', 'false');
    watchFeed.render(items, { likes: state.likes, saved: state.saved, hidden: state.hidden, reducedMotion: state.settings.reducedMotion, autoNext: state.settings.autoNext });
    updateStats(); return;
  }
  if (isTikTok) {
    const items = filteredItems();
    $('sectionTitle').textContent = 'אותה מוזיקה. תנועה חדשה.'; $('sectionEyebrow').textContent = 'SCROLL INTO YOUR NEXT FAVORITE';
    $('resultCount').textContent = `${items.length} סרטונים · בחירת האתר והספרייה שלך`; $('loadMore').hidden = true; $('feed').setAttribute('aria-busy', 'false');
    shorts.render(items, { likes: state.likes, saved: state.saved, reducedMotion: state.settings.reducedMotion }); updateStats(); return;
  }
  const titles = { discover: query ? `התוצאות של ״${query}״` : 'קצת השראה, הרבה מוזיקה', live: 'האנרגיה של הופעה חיה', cover: 'שירים מוכרים, צליל חדש', official: 'לראות את המוזיקה', saved: 'המוזיקה ששמרת', liked: 'מה שעשה לך טוב', history: 'מה שהתנגן אצלך', local: 'הספרייה מהמכשיר', playlists: activePlaylist ? state.playlists.find(x => x.id === activePlaylist)?.name || 'פלייליסט' : 'האוספים שלך' };
  $('sectionTitle').textContent = titles[tab]; $('sectionEyebrow').textContent = isRemoteTab() ? 'FIND YOUR SOUND' : 'YOUR OWN LITTLE WORLD';
  $('feed').classList.toggle('list', state.settings.layout === 'list'); $('layoutBtn').textContent = state.settings.layout === 'grid' ? '☷' : '▦'; $('layoutBtn').setAttribute('aria-label', state.settings.layout === 'grid' ? 'מעבר לתצוגת רשימה' : 'מעבר לתצוגת כרטיסים');
  $('feed').setAttribute('aria-busy', String(loading)); $('loadMore').hidden = loading || !isRemoteTab() || (nextPage === null && nextOffset === null);
  if (loading && !results.length && isRemoteTab()) { $('feed').innerHTML = '<div class="skeleton"></div>'.repeat(4); $('resultCount').textContent = 'מביאים תוצאות אמיתיות ממקור המוזיקה…'; return; }
  if (tab === 'playlists' && !activePlaylist) { renderPlaylists(); updateStats(); return; }
  const all = currentItems().filter(Boolean);
  const genreValue = $('genre').value;
  const genres = [...new Set(all.map(x => x.genre).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
  $('genre').innerHTML = '<option value="">כל הסגנונות</option>' + genres.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join('');
  $('genre').value = genres.includes(genreValue) ? genreValue : '';
  const items = filteredItems();
  $('resultCount').textContent = `${items.length} ${tab === 'local' ? 'קבצים' : 'פריטים'}${isRemoteTab() ? ' · ' + sourceNames[state.settings.source] + (state.settings.source === 'youtube' && collectionMode ? ' · אוסף האתר' : '') : ''}${isRemoteTab() && total > results.length ? ' · אפשר לטעון עוד' : ''}`;
  let toolbar = '';
  if (tab === 'local') toolbar = `<div class="pl-toolbar">${button('import-local', '＋ הוספת קבצים')}${button('queue-visible', '☷ הוספה לתור')}</div>`;
  if (tab === 'playlists' && activePlaylist) toolbar = `<div class="pl-toolbar">${button('all-playlists', '→ כל הפלייליסטים')}${button('queue-playlist', '▶ ניגון האוסף')}${button('rename-playlist', 'שינוי שם')}${button('export-m3u', 'ייצוא M3U8')}${button('delete-playlist', 'מחיקת האוסף', '', 'secondary danger')}</div>`;
  $('feed').innerHTML = toolbar + (items.length ? items.map(card).join('') : emptyView());
  if (toolbar) $('feed').querySelector('.pl-toolbar').style.gridColumn = '1 / -1';
  updateStats();
}
async function refreshViewingFeed() {
  if (watchRefreshing) return;
  watchRefreshing = true;
  if (['watch', 'tiktok'].includes(tab)) render();
  try {
    const data = await api('feed'); remember(data.items);
    const incoming = orderFeed(data.items, state.history, state.followed).map(x => x.id);
    watchIds = [...new Set([...watchIds.filter(id => incoming.includes(id) || playlistIds.has(id)), ...incoming])];
    feedNote = data.youtubeMode === 'channels' ? 'מתעדכן מערוצי המוזיקה' : 'בחירת האתר · עדכון הערוצים אינו זמין כרגע';
    persist();
  } catch (error) {
    feedNote = 'בחירת האתר · עדכון הערוצים אינו זמין כרגע';
    if (error.code === 'ACCESS_REQUIRED') accessProtected = true;
  } finally { watchRefreshing = false; if (['watch', 'tiktok'].includes(tab)) render(); }
}
function emptyView() {
  if (lastError && isRemoteTab()) return `<div class="empty"><div class="empty-icon">⌁</div><h3>החיפוש לא הושלם</h3><p>${esc(lastError)}</p>${button('retry', 'ניסיון נוסף', '', 'primary')}${button('connections', 'הגדרות חיבור')}</div>`;
  const messages = { saved: ['♡', 'כל מה ששווה לחזור אליו', 'שומרים שיר או סרטון בכפתור ״שמירה״, והוא יופיע כאן.'], liked: ['♥', 'כאן ייאספו האהובים שלך', 'לחיצה על הלב בכרטיס תוסיף אותו לאוסף הזה.'], history: ['◷', 'הסיפור המוזיקלי שלך מתחיל כאן', 'פריטים שהשמעת יופיעו כאן.'], local: ['♫', 'כל המוזיקה שלך, קרוב אליך', 'בחר קבצי שמע או וידאו מהמכשיר, או גרור אותם לכאן. הקבצים נשמרים בדפדפן ואינם נשלחים לשרת.'], playlists: ['☷', 'האוסף מחכה לצליל הראשון', 'אפשר להוסיף שירים דרך תפריט שלוש הנקודות בכרטיס.'] };
  const [icon, title, description] = messages[tab] || ['⌕', 'לא מצאנו התאמה הפעם', 'נסה שם אמן אחר, החלף אזור או נקה את הסינון.'];
  return `<div class="empty"><div class="empty-icon">${icon}</div><h3>${title}</h3><p>${description}</p>${button(tab === 'local' ? 'import-local' : 'go-discover', tab === 'local' ? '＋ בחירת קבצים' : 'בחזרה לגילוי', '', 'primary')}${button('clear-filters', 'ניקוי סינון')}</div>`;
}
async function searchMusic({ append = false, phrase } = {}) {
  const input = phrase ?? $('search').value.trim();
  if (parseTikTokURL(input) || isShortTikTokURL(input)) { await importTikTok(input); return; }
  if (videoId(input)) { await importVideo(input); return; }
  const baseQuery = input || (state.settings.source === 'youtube' ? '' : state.followed[0] || 'אברהם פריד');
  if (!isRemoteTab()) setTab('discover');
  searchController?.abort(); const controller = new AbortController(); searchController = controller; const version = ++searchVersion;
  query = baseQuery; $('search').value = baseQuery;
  const baseResults = append ? [...results] : [];
  const opts = { q: baseQuery, source: state.settings.source, kind: kindQueries[tab] ? tab : 'all', country: state.settings.country, duration: $('duration').value, order: state.settings.sort === 'newest' ? 'date' : 'relevance', page: append ? nextPage : null, offset: append ? nextOffset : 0 };
  if (!append) { results = []; nextPage = null; nextOffset = null; total = 0; }
  const accept = data => {
    remember(data.items); results = [...new Set([...baseResults, ...data.items.map(x => x.id)])].filter(id => track(id));
    nextPage = data.nextPage; nextOffset = data.nextOffset; total = data.total; collectionMode = ['collection', 'channels'].includes(data.mode);
  };
  const builtIn = opts.source === 'youtube' ? searchCollection(opts) : null;
  lastSearch = { phrase: baseQuery }; lastError = ''; loading = true; showMessage();
  // The first screen is immediately usable, even before a server or channel feed replies.
  if (builtIn) { accept(builtIn); loading = false; }
  render();
  try {
    const data = await api('search', opts, controller.signal);
    if (version !== searchVersion) return;
    accept(data);
    if (baseQuery) state.searchHistory = [...new Set([baseQuery, ...state.searchHistory])].slice(0, 12);
    persist(); updateSuggestions();
    if (state.settings.source === 'itunes') showMessage('קטלוג להיכרות עם מוזיקה. הקטעים באדיבות iTunes; לשיר המלא ולרכישה, פותחים את הקישור לחנות שעל הכרטיס.');
    else showMessage(collectionMode ? (data.mode === 'channels' ? 'ערוצי האתר התעדכנו אוטומטית. מחפשים באוסף, בוחרים סרטון ולוחצים ניגון.' : 'בחירת האתר מוכנה לצפייה. החיפוש מסנן את האוסף — בלי חשבון, מפתח או קישורים.') : 'תוצאות YouTube נטענו אוטומטית. בוחרים סרטון ולוחצים ניגון.');
  } catch (error) {
    if (controller.signal.aborted || version !== searchVersion) return;
    if (builtIn) { accept(builtIn); persist(); showMessage('בחירת האתר מוכנה לצפייה. החיפוש מסנן את האוסף — בלי חשבון, מפתח או קישורים.'); }
    else if (append) toast(error.message);
    else { lastError = error.message; showMessage(error.message, 'error'); }
    if (error.code === 'ACCESS_REQUIRED') { accessProtected = true; $('statusDot').className = 'status-dot error'; }
  } finally { if (version === searchVersion) { loading = false; render(); } }
}

function renderQueue() {
  $('queueList').innerHTML = state.queue.length ? state.queue.map((id, i) => {
    const x = track(id); if (!x) return '';
    return `<div class="queue-row ${current?.id === id ? 'current' : ''}"><button class="queue-play" data-action="play" data-id="${esc(id)}" aria-label="ניגון ${esc(x.title)}">▶</button><div><b>${esc(x.title)}</b><small>${esc(x.artist)}</small></div><div class="queue-move"><button data-action="queue-up" data-id="${esc(id)}" aria-label="הזזת ${esc(x.title)} למעלה" ${i === 0 ? 'disabled' : ''}>▴</button><button data-action="queue-down" data-id="${esc(id)}" aria-label="הזזת ${esc(x.title)} למטה" ${i === state.queue.length - 1 ? 'disabled' : ''}>▾</button></div><button class="queue-remove" data-action="queue-remove" data-id="${esc(id)}" aria-label="הסרת ${esc(x.title)} מהתור">✕</button></div>`;
  }).join('') : '<p class="muted">מוסיפים שירים דרך תפריט הכרטיס.<br>קטעי היכרות של iTunes מושמעים בנפרד.</p>';
  $('queuePlay').disabled = !state.queue.length;
}
function addQueue(id, next = false) {
  const item = track(id); if (!item) return;
  if (item.source === 'tiktok') { toast('סרטוני TikTok מתנגנים בלשונית TikTok, בגלילה מסרטון לסרטון.'); return; }
  if (item.source === 'itunes') { toast('קטעי היכרות זמינים בכרטיס ובחנות. התור מיועד לסרטוני YouTube ולקבצים האישיים שלך.'); return; }
  state.queue = state.queue.filter(x => x !== id);
  if (next && current && state.queue.includes(current.id)) state.queue.splice(state.queue.indexOf(current.id) + 1, 0, id); else if (next) state.queue.unshift(id); else state.queue.push(id);
  queueIndex = current ? state.queue.indexOf(current.id) : -1; persist(); toast(next ? 'יתנגן הבא בתור' : 'נוסף לתור');
}
function renderPlaylists() {
  $('resultCount').textContent = `${state.playlists.length} פלייליסטים אישיים`;
  $('feed').classList.remove('list');
  $('feed').innerHTML = `<div class="pl-toolbar">${button('new-playlist', '＋ פלייליסט חדש', '', 'primary')}${button('import-m3u', 'ייבוא M3U / M3U8')}</div>` + (state.playlists.length ? state.playlists.map(p => `<article class="playlist-card"><span class="pl-icon">☷</span><h3>${esc(p.name)}</h3><p>${p.tracks.length} פריטים · אוסף אישי</p><div class="pl-actions">${button('open-playlist', 'פתיחת האוסף ←', `data-playlist="${esc(p.id)}"`)}${button('play-list', '▶', `data-playlist="${esc(p.id)}" aria-label="ניגון ${esc(p.name)}"`)}</div></article>`).join('') : `<div class="empty"><div class="empty-icon">☷</div><h3>כל מצב רוח והאוסף שלו</h3><p>צור פלייליסט והוסף אליו שירים ששמרת, קבצים אישיים וסרטונים.</p>${button('new-playlist', 'יצירת האוסף הראשון', '', 'primary')}</div>`);
  $('feed').querySelector('.pl-toolbar').style.gridColumn = '1 / -1';
}
function modal(title, body, cleanup) {
  closeDialog(); $('dialogTitle').textContent = title; $('dialogBody').innerHTML = body; dialogCleanup = cleanup || null; $('dialog').showModal();
}
function closeDialog() { if ($('dialog').open) $('dialog').close(); dialogCleanup?.(); dialogCleanup = null; }
function nameDialog(title, initial, onSave) {
  modal(title, `<form id="nameForm"><label class="field">שם האוסף<input id="playlistName" maxlength="80" required value="${esc(initial)}" autocomplete="off"></label><div class="dialog-actions"><button class="primary" type="submit">שמירה</button>${button('close-dialog', 'ביטול')}</div></form>`);
  $('nameForm').onsubmit = e => { e.preventDefault(); const name = $('playlistName').value.trim(); if (!name) return; closeDialog(); onSave(name); };
  setTimeout(() => { $('playlistName')?.focus(); $('playlistName')?.select(); }, 0);
}
function confirmDialog(title, description, onConfirm) {
  modal(title, `<p class="dialog-copy">${esc(description)}</p><div class="dialog-actions"><button class="secondary danger" id="confirmAction">אישור</button>${button('close-dialog', 'ביטול')}</div>`);
  $('confirmAction').onclick = async () => { closeDialog(); try { await onConfirm(); } catch (error) { toast(error.message); } };
}
function newPlaylist(addId) { nameDialog('פלייליסט חדש', '', name => { const p = { id: 'pl:' + crypto.randomUUID(), name, tracks: addId ? [addId] : [], createdAt: Date.now() }; state.playlists.push(p); persist(); if (!addId) { setTab('playlists', p.id); render(); } toast('האוסף נוצר'); }); }
function playlistPicker(id) {
  modal('הוספה לפלייליסט', `<div class="track-menu">${state.playlists.map(p => `<button data-action="add-to-playlist" data-id="${esc(id)}" data-playlist="${esc(p.id)}">☷ ${esc(p.name)} <span>${p.tracks.includes(id) ? '✓ כבר נוסף' : '＋'}</span></button>`).join('')}${button('new-playlist-with-track', '＋ יצירת פלייליסט חדש', `data-id="${esc(id)}"`)}</div>`);
}
function trackMenu(id) {
  const x = track(id); if (!x) return;
  const youtubeActions = ['youtube', 'local'].includes(x.source) ? `${button('queue-add', '☷ הוספה לתור', `data-id="${esc(id)}"`)}${button('queue-next', '⏭ נגן הבא', `data-id="${esc(id)}"`)}` : '';
  modal('הצליל שלך, הבחירה שלך', `<div class="dialog-track">${x.artwork ? `<img src="${esc(x.artwork)}" alt="">` : ''}<div><b>${esc(x.title)}</b><small>${esc(x.artist)}</small></div></div><div class="track-menu">${youtubeActions}${button('playlist-picker', '＋ הוספה לפלייליסט', `data-id="${esc(id)}"`)}${button('share-track', '↗ העתקת קישור', `data-id="${esc(id)}"`)}${button('search-artist', '⌕ עוד של ' + esc(x.artist), `data-artist="${esc(x.artist)}"`)}${button('follow-artist', state.followed.includes(x.artist) ? '✓ ביטול מעקב אחרי האמן' : '✧ מעקב אחרי האמן', `data-id="${esc(id)}"`)}${x.url ? button('open-track', '↗ פתיחה באתר המקורי', `data-id="${esc(id)}"`) : ''}${tab === 'playlists' && activePlaylist ? `${button('playlist-up', '↑ הזזה למעלה באוסף', `data-id="${esc(id)}"`)}${button('playlist-down', '↓ הזזה למטה באוסף', `data-id="${esc(id)}"`)}` : ''}${button('hide-track', '⊘ הסתרת הפריט מהתצוגות', `data-id="${esc(id)}"`)}${button('block-artist', '⊘ הסתרת האמן מהתצוגות', `data-id="${esc(id)}"`)}${x.source === 'local' ? button('delete-local', 'מחיקת העותק מהדפדפן', `data-id="${esc(id)}"`, 'secondary danger') : ''}</div>`);
}
async function importVideo(input) {
  if (parseTikTokURL(input) || isShortTikTokURL(input)) return importTikTok(input);
  const id = videoId(input);
  if (!id) { toast('יש להזין קישור לסרטון YouTube בודד.'); return; }
  closeDialog(); toast('מוסיפים את הסרטון…');
  let data;
  try { data = await api('video', { url: `https://www.youtube.com/watch?v=${id}` }); }
  catch { data = { item: { id: `youtube:${id}`, source: 'youtube', videoId: id, title: 'סרטון YouTube', artist: 'YouTube', artwork: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, tags: ['קישור אישי'] }, warning: 'הקישור נשמר ללא כותרת. ההשמעה תיבדק בעת פתיחת הנגן הרשמי.' }; }
  remember([data.item]); if (!state.saved.includes(data.item.id)) state.saved.unshift(data.item.id); persist(); setTab('saved'); render(); toast(data.warning || 'הסרטון נוסף לשמורים');
}
function addLinkDialog() {
  if (tab === 'tiktok') { tikTokLinkDialog(); return; }
  modal('צליל טוב שמצאת ברשת?', '<p class="dialog-copy">הדבק קישור לסרטון YouTube או TikTok כדי לשמור ולנגן אותו כאן. סרטוני TikTok יופיעו ברצף גלילה אנכי.</p><form id="linkForm"><label class="field">קישור לסרטון<input id="videoURL" type="url" dir="ltr" placeholder="https://www.youtube.com/watch?v=…" required></label><button class="primary" type="submit">הוספת הסרטון</button></form>');
  $('linkForm').onsubmit = e => { e.preventDefault(); importVideo($('videoURL').value.trim()); }; $('videoURL').focus();
}
function tikTokLinkDialog() {
  shorts.pause();
  modal('סרטונים טובים מגיעים ברצף', `<p class="dialog-copy">מדביקים קישורי TikTok, וכל סרטון מקבל מקום ברצף הגלילה שלך. אפשר להדביק עד 20 קישורים, בשורות נפרדות.</p><form id="tikTokLinksForm"><label class="field">קישורים לסרטונים<textarea id="tikTokLinks" rows="5" dir="ltr" maxlength="10000" placeholder="https://www.tiktok.com/@artist/video/…" required></textarea></label><div class="dialog-actions"><button class="primary" type="submit">＋ הוספת הסרטונים</button><button class="secondary" type="button" id="tikTokSearchLink">חיפוש ב־TikTok ↗</button></div><p class="form-note">הסרטונים מוצגים בנגן הרשמי. פריטים שתוסיף נשמרים גם בספרייה האישית.</p><p class="form-note" id="tikTokImportStatus" role="status"></p></form>`);
  $('tikTokSearchLink').onclick = () => openExternal('https://www.tiktok.com/search?q=' + encodeURIComponent($('search').value || 'music'));
  $('tikTokLinksForm').onsubmit = async event => {
    event.preventDefault(); const links = extractTikTokLinks($('tikTokLinks').value);
    if (!links.length) { $('tikTokImportStatus').textContent = 'לא נמצאו קישורי סרטונים תקינים של TikTok.'; return; }
    const form = event.currentTarget, submit = form.querySelector('[type="submit"]'); submit.disabled = true; $('tikTokImportStatus').textContent = 'מוסיפים את הסרטונים…';
    try { await importTikTok(links); } finally { if (submit.isConnected) submit.disabled = false; }
  };
  $('tikTokLinks').focus();
}
async function importTikTok(input) {
  const links = Array.isArray(input) ? input : extractTikTokLinks(input);
  if (!links.length) { toast('יש להזין קישור תקין לסרטון TikTok.'); return; }
  const responses = await Promise.allSettled(links.map(async url => {
    try { return await api('tiktok', { url }); }
    catch (error) {
      const post = parseTikTokURL(url);
      if (!post || error.code === 'ACCESS_REQUIRED') throw error;
      return { item: { id: `tiktok:${post.id}`, tiktokId: post.id, source: 'tiktok', title: 'סרטון TikTok', artist: '@' + post.author, url: post.url, tags: ['TikTok'] }, metadataAvailable: false };
    }
  }));
  const added = responses.filter(x => x.status === 'fulfilled').map(x => x.value);
  const failed = responses.length - added.length;
  if (!added.length) { const message = responses[0]?.reason?.message || 'לא ניתן להוסיף את הסרטונים. נסה קישור מלא.'; if ($('tikTokImportStatus')) $('tikTokImportStatus').textContent = message; else toast(message); return; }
  remember(added.map(x => x.item));
  for (const { item } of added) if (!state.saved.includes(item.id)) state.saved.unshift(item.id);
  persist(); closeDialog(); setTab('tiktok'); render();
  shorts.focus(added[0].item.id); $('content').scrollIntoView({ behavior: state.settings.reducedMotion ? 'auto' : 'smooth', block: 'start' });
  toast(`${added.length} סרטונים נוספו${failed ? ` · ${failed} קישורים לא נוספו` : ''}${added.some(x => !x.metadataAvailable) ? ' · חלקם ללא כותרת; הזמינות תיבדק בנגן' : ''}`);
}
async function importFiles(files) {
  const accepted = [...files].filter(f => /^(audio\/|video\/)/.test(f.type) || /\.(mp3|m4a|flac|wav|ogg|aac|opus|mp4|webm)$/i.test(f.name));
  if (!accepted.length) { toast('לא נמצאו קבצי שמע או וידאו נתמכים.'); return; }
  let count = 0, failed = 0; toast('מוסיפים קבצים לספרייה המקומית…');
  for (const file of accepted.slice(0, 200)) {
    if (file.size > 300 * 1024 * 1024) { failed++; continue; }
    const existing = Object.values(state.tracks).find(x => x.source === 'local' && x.filename === file.name && x.size === file.size);
    const id = existing?.id || 'local:' + crypto.randomUUID();
    try {
      await fileStore.put(id, file);
      remember([{ ...existing, id, source: 'local', title: existing?.title || file.name.replace(/\.[^.]+$/, ''), artist: existing?.artist || 'מהמכשיר שלך', filename: file.name, size: file.size, fileType: file.type.startsWith('video') || /\.(mp4|webm)$/i.test(file.name) ? 'video' : 'audio', tags: ['מקומי', 'פרטי'], addedAt: existing?.addedAt || Date.now() }]); count++;
    } catch { failed++; }
  }
  persist(); setTab('local'); render(); $('localFiles').value = '';
  toast(`${count} קבצים נוספו${failed ? ` · ${failed} לא נוספו (מקום פנוי או גודל מעל 300MB)` : ''}${accepted.length > 200 ? ' · עד 200 קבצים בכל הוספה' : ''}`);
}
function removeTrack(id) {
  delete state.tracks[id]; for (const field of ['likes', 'saved', 'queue', 'hidden']) state[field] = state[field].filter(x => x !== id);
  state.history = state.history.filter(x => x.id !== id); for (const p of state.playlists) p.tracks = p.tracks.filter(x => x !== id); delete state.positions[id]; results = results.filter(x => x !== id);
}

async function ensureYouTubePlayer() {
  await ytAPI();
  if (ytPlayerReady) return ytPlayerReady;
  if (!$('youtubeMount')) { const mount = document.createElement('div'); mount.id = 'youtubeMount'; $('youtubeHost').replaceChildren(mount); }
  ytPlayerReady = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ytPlayer?.destroy?.(); ytPlayer = null; ytPlayerReady = null; reject(new Error('הנגן לא השיב. אפשר לנסות שוב או לפתוח את הסרטון ב־YouTube.')); }, 12000);
    ytPlayer = new window.YT.Player('youtubeMount', { host: 'https://www.youtube-nocookie.com', playerVars: { playsinline: 1, origin: location.origin, rel: 0 }, events: {
      onReady: () => { clearTimeout(timeout); resolve(ytPlayer); },
      onStateChange: e => { if (current?.source !== 'youtube') return; if (e.data === 1) { setPlaying(true); ytPlayer?.setPlaybackRate?.(state.settings.speed); recordPlay(current); } else if (e.data === 2) setPlaying(false); else if (e.data === 0) ended(); },
      onError: e => { if (current?.source !== 'youtube') return; setPlaying(false); const messages = { 2: 'קישור הסרטון אינו תקין.', 5: 'הדפדפן לא הצליח לנגן את הסרטון.', 100: 'הסרטון הוסר או אינו ציבורי.', 101: 'בעל הסרטון חסם ניגון באתרים אחרים.', 150: 'בעל הסרטון חסם ניגון באתרים אחרים.', 153: 'YouTube דורש זיהוי אתר. פתח את האתר בכתובת HTTPS ולא כקובץ מקומי.' }; playerError((messages[e.data] || 'YouTube אינו מצליח לנגן את הסרטון.') + ' אפשר לפתוח אותו באתר המקורי דרך תפריט הכרטיס.'); }
    } });
  });
  return ytPlayerReady;
}
function playerError(message) { $('playerError').textContent = message; $('playerError').hidden = false; toast(message); }
function recordPlay(item) {
  state.history = [{ id: item.id, at: Date.now() }, ...state.history.filter(x => x.id !== item.id)].slice(0, 200); persist();
  if (tab === 'history') render();
}
function setPlaying(value) { isPlaying = value; $('playPauseBtn').textContent = value ? 'Ⅱ' : '▶'; $('playPauseBtn').setAttribute('aria-label', value ? 'השהיה' : 'ניגון'); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = value ? 'playing' : 'paused'; }
function pause() {
  shorts.pause();
  watchFeed.pause();
  currentMedia.pause(); if (ytPlayer?.pauseVideo) ytPlayer.pauseVideo(); setPlaying(false);
}
function savePosition() {
  if (current && current.source !== 'itunes' && currentPosition > 3 && state.settings.resume) { state.positions[current.id] = currentPosition; persist(); }
}
function stopPlayer() {
  savePosition(); playVersion++; pause(); youtubeLoading = false; currentMedia.removeAttribute('src'); currentMedia.load();
  if (ytPlayer?.stopVideo) ytPlayer.stopVideo();
  if (activeObjectURL) { URL.revokeObjectURL(activeObjectURL); activeObjectURL = ''; }
  current = null; currentPosition = 0; currentDuration = 0; $('playerbar').hidden = true; $('stage').hidden = true; document.body.classList.remove('has-player'); render();
}
async function play(id, { forceStart = false } = {}) {
  const item = track(id); if (!item) return;
  if (item.source === 'tiktok') { setTab('tiktok'); render(); shorts.focus(id); $('content').scrollIntoView({ behavior: state.settings.reducedMotion ? 'auto' : 'smooth' }); return; }
  if (['watch', 'tiktok'].includes(tab)) { setTab('discover'); render(); }
  savePosition(); pause(); const version = ++playVersion; youtubeLoading = false;
  if (activeObjectURL) { URL.revokeObjectURL(activeObjectURL); activeObjectURL = ''; }
  $('audio').removeAttribute('src'); $('audio').load(); $('localVideo').removeAttribute('src'); $('localVideo').load();
  current = item; currentPosition = 0; currentDuration = 0; queueIndex = state.queue.indexOf(id);
  $('playerbar').hidden = false; document.body.classList.add('has-player'); $('nowTitle').textContent = item.title; $('nowArtist').textContent = item.artist;
  $('nowArt').innerHTML = item.artwork ? `<img src="${esc(item.artwork)}" alt="">` : '♫';
  $('stage').hidden = true; $('localVideo').hidden = true; $('youtubeHost').hidden = true; $('playerError').hidden = true;
  $('previewLabel').hidden = item.source !== 'itunes'; $('previewStoreLink').href = item.url || '#';
  for (const node of [$('shuffleBtn'), $('repeatBtn'), $('nextBtn'), $('prevBtn'), $('speed')]) node.disabled = item.source === 'itunes';
  const start = !forceStart && state.settings.resume ? state.positions[id] || 0 : 0;
  try {
    if (item.source === 'youtube') {
      youtubeLoading = true; $('stage').hidden = false; $('youtubeHost').hidden = false; $('stageTitle').textContent = item.title; $('stageNote').textContent = 'ניגון בנגן הרשמי של YouTube. אם הסרטון אינו זמין להטמעה, אפשר לפתוח אותו באתר המקורי.';
      await ensureYouTubePlayer(); if (version !== playVersion) return;
      ytPlayer.setVolume(state.settings.volume * 100); ytPlayer.loadVideoById({ videoId: item.videoId, startSeconds: start });
      if (version !== playVersion) return;
      youtubeLoading = false; $('stage').scrollIntoView({ behavior: state.settings.reducedMotion ? 'instant' : 'smooth', block: 'start' });
    } else {
      if (item.source === 'local') {
        const blob = await fileStore.get(id); if (version !== playVersion) return;
        if (!blob) throw new Error('הקובץ אינו שמור בדפדפן הזה. הוסף שוב את הקובץ המקורי דרך ״מהמכשיר״.');
        activeObjectURL = URL.createObjectURL(blob); currentMedia = item.fileType === 'video' ? $('localVideo') : $('audio'); currentMedia.src = activeObjectURL;
        if (item.fileType === 'video') { $('stage').hidden = false; $('localVideo').hidden = false; $('stageTitle').textContent = item.title; $('stageNote').textContent = 'הקובץ מתנגן מהמכשיר שלך ואינו נשלח לשרת.'; }
      } else { if (!item.previewUrl) throw new Error('אין קטע היכרות זמין לפריט הזה. אפשר לפתוח את השיר בחנות.'); currentMedia = $('audio'); currentMedia.src = item.previewUrl; }
      currentMedia.volume = state.settings.volume; currentMedia.playbackRate = item.source === 'itunes' ? 1 : state.settings.speed;
      if (start > 0) currentMedia.addEventListener('loadedmetadata', function resume() { if (version === playVersion && start < currentMedia.duration - 3) currentMedia.currentTime = start; }, { once: true });
      await currentMedia.play(); if (version !== playVersion) return; setPlaying(true); recordPlay(item);
    }
    if ('mediaSession' in navigator && 'MediaMetadata' in window) navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.artist, album: item.album, artwork: item.artwork ? [{ src: item.artwork }] : [] });
  } catch (error) { if (version !== playVersion) return; setPlaying(false); youtubeLoading = false; if (error.name === 'NotAllowedError') toast('הדפדפן דורש לחיצה נוספת על כפתור הניגון.'); else playerError(error.message || 'לא ניתן לנגן את הקובץ בדפדפן הזה.'); }
  render(); updatePlayerProgress();
}
async function togglePlay() {
  if (!current) { if (state.queue.length) await play(state.queue[0]); return; }
  if (isPlaying) { pause(); savePosition(); return; }
  try { if (current.source === 'youtube') { if (!ytPlayer?.playVideo || youtubeLoading) { await play(current.id); return; } ytPlayer.playVideo(); } else { await currentMedia.play(); setPlaying(true); } }
  catch { toast('לא ניתן להתחיל ניגון. נסה לבחור שוב את השיר.'); }
}
function skip(direction = 1, automatic = false) {
  if (current?.source === 'itunes') return;
  if (!state.queue.length) { if (!automatic) toast('התור ריק. אפשר להוסיף פריטים דרך שלוש הנקודות בכרטיס.'); setPlaying(false); return; }
  if (direction < 0 && currentPosition > 4) { seek(0); return; }
  let index = current ? state.queue.indexOf(current.id) : -1;
  if (shuffle && direction > 0 && state.queue.length > 1) { const choices = state.queue.filter(id => id !== current?.id); play(choices[Math.floor(Math.random() * choices.length)], { forceStart: true }); return; }
  index += direction;
  if (index >= state.queue.length) { if (repeat === 'all' || !automatic) index = 0; else { setPlaying(false); return; } }
  if (index < 0) index = state.queue.length - 1;
  play(state.queue[index], { forceStart: true });
}
function ended() {
  if (!current) return; delete state.positions[current.id]; persist();
  if (current.source === 'itunes') { setPlaying(false); return; }
  if (repeat === 'one') { play(current.id, { forceStart: true }); return; }
  if (state.settings.autoNext) skip(1, true); else setPlaying(false);
}
function seek(seconds) { if (!current) return; if (current.source === 'youtube' && ytPlayer?.seekTo) ytPlayer.seekTo(seconds, true); else currentMedia.currentTime = seconds; currentPosition = seconds; }
function updatePlayerProgress() {
  if (!current) return;
  if (current.source === 'youtube' && ytPlayer?.getCurrentTime) { currentPosition = ytPlayer.getCurrentTime() || 0; currentDuration = ytPlayer.getDuration() || 0; }
  else if (current.source !== 'youtube') { currentPosition = currentMedia.currentTime || 0; currentDuration = Number.isFinite(currentMedia.duration) ? currentMedia.duration : 0; }
  $('elapsed').textContent = formatTime(currentPosition); $('totalTime').textContent = formatTime(currentDuration); $('seek').value = currentDuration ? currentPosition / currentDuration * 100 : 0; $('seek').disabled = !currentDuration;
  if (isPlaying && Date.now() - lastPositionSave > 6000) { lastPositionSave = Date.now(); savePosition(); }
}
for (const media of [$('audio'), $('localVideo')]) {
  media.addEventListener('ended', () => { if (media === currentMedia && current?.source !== 'youtube') ended(); });
  media.addEventListener('play', () => { if (media === currentMedia && current?.source !== 'youtube') setPlaying(true); });
  media.addEventListener('pause', () => { if (media === currentMedia && current?.source !== 'youtube') setPlaying(false); });
  media.addEventListener('loadedmetadata', () => { if (media === currentMedia && current?.source === 'local' && Number.isFinite(media.duration)) { current.duration = media.duration; state.tracks[current.id].duration = media.duration; persist(); } });
  media.addEventListener('error', () => { if (media === currentMedia && current?.source !== 'youtube' && media.hasAttribute('src')) { setPlaying(false); playerError('לא ניתן לנגן את הקובץ. הפורמט עשוי לא להיתמך, או שכתובת הקטע אינה זמינה.'); } });
}
setInterval(updatePlayerProgress, 700);

function connections() {
  modal('כל החיבורים, במקום אחד', `<p class="dialog-copy">סרטוני YouTube ו־TikTok שבאוסף נטענים אוטומטית, ללא חיבור חשבון או הזנת מפתח. כאן אפשר לבדוק את שרת האתר ואת השירותים הנוספים. זמינות כל סרטון נקבעת גם על ידי המקור והרשת.</p>${accessProtected ? `<label class="field">קוד גישה לאתר שהוגדר בידי בעל האתר<input id="accessToken" type="password" dir="ltr" autocomplete="off" value="${esc(accessToken)}"></label>` : ''}<div class="dialog-actions"><button class="primary" id="runHealth">בדיקת חיבור</button></div><div id="healthResults" aria-live="polite"></div><p class="form-note" id="healthNote"></p><div class="dialog-actions">${button('export-health', 'ייצוא דוח בדיקה')}${button('help-connections', 'איך הסרטונים נטענים?')}</div>`);
  $('runHealth').onclick = runHealth;
  if (healthReport) renderHealth(); else runHealth();
}

async function runHealth() {
  const run = $('runHealth'); if (!run) return;
  if ($('accessToken')) accessToken = $('accessToken').value.trim(); run.disabled = true; run.textContent = 'בודקים…'; $('healthResults').innerHTML = '<p class="dialog-copy">שולחים בקשת בדיקה לכל מקור…</p>';
  const start = performance.now();
  try { healthReport = await api('health'); configured = healthReport.youtubeConfigured; const server = healthReport.checks.find(x => x.id === 'server'); if (server) server.latency = Math.round(performance.now() - start); }
  catch (error) { healthReport = { checkedAt: new Date().toISOString(), version: VERSION, checks: [{ id: 'server', status: 'error', message: error.message, code: error.code || 'NETWORK_ERROR', latency: Math.round(performance.now() - start) }] }; }
  const works = healthReport.checks.every(x => x.status !== 'error'); $('statusDot').className = 'status-dot ' + (works ? 'ok' : 'error');
  if ($('healthResults')) renderHealth();
  if ($('runHealth') === run) { run.disabled = false; run.textContent = 'בדיקה חוזרת'; }
}
function renderHealth() {
  const names = { server: 'שרת Music Muse', catalog: 'קטלוג iTunes', youtube: 'חיפוש מורחב ב־YouTube — אופציונלי לבעל האתר' };
  if (!$('healthResults')) return;
  $('healthResults').innerHTML = healthReport.checks.map(x => `<div class="connection-check"><span class="check-dot ${x.status}">${x.status === 'ok' ? '✓' : x.status === 'unconfigured' ? '−' : '!'}</span><div><b>${esc(names[x.id] || x.id)}</b><small>${esc(x.message)}</small></div><time dir="ltr">${x.latency} ms</time></div>`).join('');
  $('healthNote').textContent = 'נבדק ב־' + new Date(healthReport.checkedAt).toLocaleString('he-IL') + (configured ? ' · חיפוש מורחב זמין אוטומטית לכל המבקרים' : ' · הצפייה והחיפוש באוסף האתר זמינים ללא חיבור חשבון או מפתח');
}
function download(content, filename, type) { const u = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement('a'); a.href = u; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
function exportBackup() { download(JSON.stringify({ ...state, exportedAt: new Date().toISOString(), app: 'Music Muse', version: VERSION }, null, 2), 'MusicMuse-backup.json', 'application/json'); toast('הגיבוי כולל העדפות ומידע על השירים. קובצי השמע עצמם אינם כלולים.'); }
async function readBackup(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('קובץ הגיבוי גדול מדי (עד 10MB).'); return; }
  try {
    const input = JSON.parse(await file.text()); if (input.schema !== 2 || !input.tracks || !Array.isArray(input.playlists)) throw new Error('זה אינו גיבוי נתמך של Music Muse.');
    const safe = sanitizeState(input); confirmDialog('ייבוא גיבוי', `למזג ${Object.keys(safe.tracks).length} פריטים ו־${safe.playlists.length} אוספים עם הספרייה הקיימת? קבצים מקומיים יש להוסיף מחדש אם אינם שמורים בדפדפן הזה.`, () => { state = mergeState(state, safe); persist(); applySettings(); render(); updateSuggestions(); toast('הגיבוי מוזג לספרייה'); });
  } catch (error) { toast(error.message || 'לא ניתן לקרוא את הגיבוי.'); }
  $('backupFile').value = '';
}
async function readM3U(file) {
  if (!file || file.size > 2 * 1024 * 1024) { toast('קובץ הפלייליסט חסר או גדול מדי (עד 2MB).'); return; }
  const text = await file.text(), items = parseM3U(text);
  if (!items.length) { toast('לא נמצאו קישורי YouTube נתמכים. ייבוא M3U כאן תומך בקישורי YouTube בלבד; קבצים מקומיים מוסיפים בנפרד.'); return; }
  remember(items); const p = { id: 'pl:' + crypto.randomUUID(), name: file.name.replace(/\.m3u8?$/i, ''), tracks: items.map(x => x.id), createdAt: Date.now() }; state.playlists.push(p); persist(); setTab('playlists', p.id); render(); $('m3uFile').value = ''; toast(`${items.length} סרטונים יובאו. שורות אחרות לא יובאו.`);
}
function settings() {
  modal('המקום שלך, בדרך שלך', `<label class="field">אזור חיפוש<select id="countrySetting">${[['IL', 'ישראל'], ['US', 'ארצות הברית'], ['GB', 'בריטניה'], ['FR', 'צרפת'], ['CA', 'קנדה']].map(([id, label]) => `<option value="${id}" ${state.settings.country === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="check-field"><input id="resumeSetting" type="checkbox" ${state.settings.resume ? 'checked' : ''}>המשך מהמקום שעצרתי בקבצים וב־YouTube</label><label class="check-field"><input id="nextSetting" type="checkbox" ${state.settings.autoNext ? 'checked' : ''}>מעבר אוטומטי לסרטון הבא בפיד ובתור</label><label class="check-field"><input id="compactSetting" type="checkbox" ${state.settings.compact ? 'checked' : ''}>תצוגה קומפקטית</label><label class="check-field"><input id="motionSetting" type="checkbox" ${state.settings.reducedMotion ? 'checked' : ''}>צמצום תנועה ואנימציות</label><div class="dialog-actions">${button('connections', 'בדיקת זמינות השירותים')}${button('export-backup', '↓ ייצוא גיבוי')}${button('import-backup', '↑ ייבוא גיבוי')}</div><p class="form-note">גיבוי JSON שומר פלייליסטים והעדפות, ללא קבצים או מפתחות. קבצים מיובאים נשמרים בדפדפן הזה; מחיקת נתוני האתר עלולה למחוק אותם.</p><section class="settings-section"><h3>אמנים במעקב</h3><div class="manage-list">${state.followed.map((x, i) => `<button data-action="unfollow" data-index="${i}">${esc(x)} ✕</button>`).join('') || '<p>אפשר לעקוב אחרי אמן מתפריט של שיר.</p>'}</div></section><section class="settings-section"><h3>ניהול התוכן</h3><p>${state.hidden.length} פריטים מוסתרים · ${state.blocked.length} אמנים מוסתרים</p><div class="dialog-actions">${button('unhide-all', 'הצגת כל הפריטים המוסתרים')}${button('unblock-all', 'הצגת כל האמנים')}${button('clear-history', 'ניקוי היסטוריית ניגון')}${button('clear-search', 'ניקוי חיפושים אחרונים')}</div></section><section class="settings-section"><h3>נתוני המכשיר</h3><p id="storageEstimate">בודקים מקום פנוי…</p><div class="dialog-actions">${button('reset-data', 'איפוס הספרייה וההעדפות', '', 'secondary danger')}</div></section>`);
  $('countrySetting').onchange = e => { state.settings.country = e.target.value; persist(); toast('אזור החיפוש עודכן. השינוי יחול בחיפוש הבא.'); };
  for (const [id, field] of [['resumeSetting', 'resume'], ['nextSetting', 'autoNext'], ['compactSetting', 'compact'], ['motionSetting', 'reducedMotion']]) $(id).onchange = e => { state.settings[field] = e.target.checked; persist(); applySettings(); };
  navigator.storage?.estimate?.().then(e => { if ($('storageEstimate')) $('storageEstimate').textContent = `בשימוש בדפדפן: ${Math.round((e.usage || 0) / 1024 / 1024)}MB · מכסה משוערת: ${Math.round((e.quota || 0) / 1024 / 1024)}MB`; }).catch(() => { if ($('storageEstimate')) $('storageEstimate').textContent = 'הדפדפן אינו מאפשר להעריך את המקום הפנוי.'; });
  if (!navigator.storage?.estimate) $('storageEstimate').textContent = 'הדפדפן אינו מציג נתוני אחסון.';
}
function help(connectionsOnly = false) {
  modal(connectionsOnly ? 'פשוט לבחור סרטון ולנגן' : 'כמה דברים שיעזרו להקשיב', `<div class="dialog-copy"><p><b>מוכנים לצפייה:</b> אוסף סרטוני YouTube נטען כבר בכניסה. בלשונית TikTok מחכה רצף מוכן בגלילה אנכית. אין צורך להיכנס לחשבון, להזין מפתח או להדביק קישור.</p><p><b>עדכון אוטומטי:</b> שרת האתר בודק את העדכונים הציבוריים של ערוצי המוזיקה שנבחרו. כשאי אפשר לעדכן, מוצג האוסף המובנה. TikTok מציג את בחירת האתר ואת הסרטונים שהוספת מרצונך; זהו אוסף האתר ואינו פיד ההמלצות האישי של TikTok.</p><p><b>חיפוש:</b> ללא הגדרה נוספת מחפשים באוסף האתר. אם בעל האתר הגדיר מפתח חיפוש בשרת, חיפוש YouTube המורחב זמין למבקרים אוטומטית. ניגון האוסף אינו דורש מפתח.</p><p><b>ספרייה אישית:</b> אפשר לשמור, לסמן אהבתי, ליצור אוספים ולהוסיף קבצים מהמכשיר. הוספת קישור אישי נשארת אפשרות נוספת בלבד.</p><p><b>ניגון:</b> הסרטונים מוצגים בנגנים הרשמיים. סרטון פרטי, מוסר, מוגבל באזור או חסום ברשת עשוי שלא להתנגן. בנגן ניתן להפעיל צליל ולצפות במסך מלא.</p><p><b>גיבוי וללא חיבור:</b> הספרייה נשמרת בדפדפן הזה. גיבוי JSON שומר מידע והעדפות, ללא קובצי המדיה. סרטונים חיצוניים דורשים חיבור לאינטרנט; קבצים אישיים שכבר נוספו זמינים מקומית.</p></div>${connectionsOnly ? '' : '<div class="shortcut"><span>ניגון / השהיה</span><kbd>Space</kbd></div><div class="shortcut"><span>חיפוש</span><kbd>/</kbd></div><div class="shortcut"><span>השיר הבא / הקודם</span><kbd>N / P</kbd></div><div class="shortcut"><span>קפיצה של 10 שניות</span><kbd>→ / ←</kbd></div><div class="shortcut"><span>השתקה</span><kbd>M</kbd></div><div class="shortcut"><span>שמירת הפריט הנוכחי</span><kbd>S</kbd></div>'}`);
}

function sleepDialog() {
  modal('להירדם עם הצליל הנכון', `<p class="dialog-copy">${sleepUntil ? 'הניגון ייעצר ב־' + new Date(sleepUntil).toLocaleTimeString('he', { hour: '2-digit', minute: '2-digit' }) : 'בוחרים בעוד כמה זמן הניגון ייעצר בלשונית הזו.'}</p><div class="sleep-buttons">${[5, 15, 30, 45, 60, 90].map(x => button('set-sleep', x + ' דקות', `data-minutes="${x}"`)).join('')}</div><div class="dialog-actions">${button('cancel-sleep', 'ביטול הטיימר')}</div>`);
}
function setSleep(minutes) {
  clearTimeout(sleepTimer); sleepUntil = minutes ? Date.now() + minutes * 60_000 : 0;
  if (minutes) sleepTimer = setTimeout(() => { pause(); savePosition(); sleepUntil = 0; $('sleepBtn').classList.remove('sleep-active'); toast('טיימר השינה עצר את הניגון'); }, minutes * 60_000);
  $('sleepBtn').classList.toggle('sleep-active', Boolean(minutes)); closeDialog(); toast(minutes ? `הניגון ייעצר בעוד ${minutes} דקות` : 'טיימר השינה בוטל');
}
async function shareTrack(id) {
  const x = track(id); if (!x) return;
  if (!x.url) { toast('הקובץ פרטי למכשיר. אפשר לייצא את רשימת השירים כגיבוי, ללא הקובץ עצמו.'); return; }
  try { await navigator.clipboard.writeText(x.url); toast('הקישור הועתק'); }
  catch { modal('קישור לשיתוף', `<label class="field">קישור לפריט<input id="copyURL" dir="ltr" readonly value="${esc(x.url)}"></label><p class="form-note">בחר והעתק את הקישור.</p>`); $('copyURL').select(); }
}
function toggle(field, id) { if (!track(id)) return; state[field] = state[field].includes(id) ? state[field].filter(x => x !== id) : [id, ...state[field]]; persist(); render(); }
function taste() {
  const likedArtists = state.likes.map(id => track(id)?.artist).filter(Boolean), artists = [...state.followed, ...likedArtists];
  if (!artists.length) { toast('אהב שיר או עקוב אחרי אמן כדי לבנות את הטעם שלך.'); return; }
  setTab('discover'); searchMusic({ phrase: artists[Math.floor(Math.random() * artists.length)] });
}

const actions = {
  play: el => { closeDialog(); return play(el.dataset.id); }, like: el => toggle('likes', el.dataset.id), save: el => { toggle('saved', el.dataset.id); toast(state.saved.includes(el.dataset.id) ? 'נשמר בספרייה שלך' : 'הוסר מהשמורים'); },
  'track-menu': el => trackMenu(el.dataset.id), 'playlist-picker': el => playlistPicker(el.dataset.id),
  'queue-add': el => { addQueue(el.dataset.id); closeDialog(); }, 'queue-next': el => { addQueue(el.dataset.id, true); closeDialog(); },
  'queue-remove': el => { state.queue = state.queue.filter(id => id !== el.dataset.id); persist(); },
  'queue-up': el => { state.queue = moveItem(state.queue, state.queue.indexOf(el.dataset.id), -1); persist(); }, 'queue-down': el => { state.queue = moveItem(state.queue, state.queue.indexOf(el.dataset.id), 1); persist(); },
  'search-artist': el => { closeDialog(); setTab('discover'); $('search').value = el.dataset.artist; return searchMusic({ phrase: el.dataset.artist }); },
  'follow-artist': el => { const artist = track(el.dataset.id)?.artist; if (!artist) return; state.followed = state.followed.includes(artist) ? state.followed.filter(x => x !== artist) : [...state.followed, artist]; persist(); closeDialog(); toast('האמנים במעקב עודכנו'); },
  'hide-track': el => { state.hidden.push(el.dataset.id); persist(); closeDialog(); render(); toast('הפריט הוסתר. אפשר להחזיר אותו בהגדרות.'); },
  'block-artist': el => { const artist = track(el.dataset.id)?.artist; if (artist && !state.blocked.includes(artist)) state.blocked.push(artist); persist(); closeDialog(); render(); toast('האמן הוסתר. אפשר להחזיר אותו בהגדרות.'); },
  'open-track': el => { const x = track(el.dataset.id); if (x?.url) openExternal(x.url); }, 'share-track': el => shareTrack(el.dataset.id),
  'new-playlist': () => newPlaylist(), 'new-playlist-with-track': el => newPlaylist(el.dataset.id),
  'all-playlists': () => { setTab('playlists'); render(); }, 'open-playlist': el => { setTab('playlists', el.dataset.playlist); render(); },
  'add-to-playlist': el => { const p = state.playlists.find(x => x.id === el.dataset.playlist); if (!p) return; if (!p.tracks.includes(el.dataset.id)) p.tracks.push(el.dataset.id); persist(); closeDialog(); render(); toast('נוסף לפלייליסט'); },
  'playlist-remove': el => { const p = state.playlists.find(x => x.id === activePlaylist); if (p) p.tracks = p.tracks.filter(x => x !== el.dataset.id); persist(); render(); },
  'playlist-up': el => { const p = state.playlists.find(x => x.id === activePlaylist); if (p) p.tracks = moveItem(p.tracks, p.tracks.indexOf(el.dataset.id), -1); persist(); closeDialog(); render(); },
  'playlist-down': el => { const p = state.playlists.find(x => x.id === activePlaylist); if (p) p.tracks = moveItem(p.tracks, p.tracks.indexOf(el.dataset.id), 1); persist(); closeDialog(); render(); },
  'rename-playlist': () => { const p = state.playlists.find(x => x.id === activePlaylist); if (p) nameDialog('איך נקרא לאוסף?', p.name, name => { p.name = name; persist(); render(); }); },
  'delete-playlist': () => { const p = state.playlists.find(x => x.id === activePlaylist); if (p) confirmDialog('מחיקת האוסף', `למחוק את ״${p.name}״? השירים עצמם יישארו בספרייה.`, () => { state.playlists = state.playlists.filter(x => x.id !== p.id); persist(); setTab('playlists'); render(); }); },
  'queue-playlist': () => playPlaylist(activePlaylist), 'play-list': el => playPlaylist(el.dataset.playlist),
  'queue-visible': () => { const ids = filteredItems().filter(x => ['youtube', 'local'].includes(x.source)).map(x => x.id); state.queue = [...new Set([...state.queue, ...ids])]; persist(); toast(`${ids.length} פריטים הוספו לתור`); },
  'export-m3u': () => { const p = state.playlists.find(x => x.id === activePlaylist); if (!p) return; download(toM3U(p.tracks.map(track).filter(Boolean), p.name), p.name.replace(/[<>:"/\\|?*]/g, '-') + '.m3u8', 'audio/x-mpegurl;charset=utf-8'); toast('הקובץ כולל קישורים ושמות קבצים. לא כל נגן חיצוני תומך בקישורי YouTube.'); },
  'import-m3u': () => $('m3uFile').click(), 'import-local': () => $('localFiles').click(),
  'delete-local': el => { const x = track(el.dataset.id); if (x) confirmDialog('מחיקת עותק מקומי', `למחוק את העותק של ״${x.title}״ מהדפדפן? הקובץ המקורי במכשיר לא יימחק.`, async () => { if (current?.id === x.id) stopPlayer(); await fileStore.remove(x.id); removeTrack(x.id); persist(); render(); toast('העותק הוסר מהדפדפן'); }); },
  'go-discover': () => { setTab('watch'); render(); }, 'retry': () => searchMusic(lastSearch || {}),
  'clear-filters': () => { $('localFilter').value = ''; $('duration').value = 'any'; $('genre').value = ''; render(); },
  connections, 'help-connections': () => help(true), 'export-backup': exportBackup,
  'import-backup': () => $('backupFile').click(), 'close-dialog': closeDialog,
  'export-health': () => { if (!healthReport) { toast('יש לבצע בדיקת חיבור תחילה.'); return; } download(JSON.stringify(healthReport, null, 2), 'MusicMuse-connection-report.json', 'application/json'); },
  unfollow: el => { state.followed.splice(Number(el.dataset.index), 1); persist(); settings(); },
  'unhide-all': () => { state.hidden = []; persist(); render(); settings(); }, 'unblock-all': () => { state.blocked = []; persist(); render(); settings(); },
  'clear-history': () => confirmDialog('ניקוי היסטוריית הניגון', 'הפעולה תמחק את רשימת הפריטים שהתנגנו במכשיר הזה.', () => { state.history = []; persist(); render(); toast('היסטוריית הניגון נוקתה'); }),
  'clear-search': () => { state.searchHistory = []; persist(); updateSuggestions(); toast('החיפושים האחרונים נוקו'); },
  'reset-data': () => confirmDialog('איפוס הספרייה במכשיר הזה', 'כל הפלייליסטים, השמורים, ההעדפות והעותקים של קובצי המדיה בדפדפן יימחקו. מומלץ לייצא גיבוי תחילה. הקבצים המקוריים במכשיר אינם מושפעים.', async () => { stopPlayer(); await fileStore.clear(); state = emptyState(); seedDiscovery(state); persist(); applySettings(); updateSuggestions(); setSleep(0); watchIds = orderFeed(discoveryTracks('youtube')).map(x => x.id); setTab('watch'); results = []; render(); refreshViewingFeed(); toast('נתוני הספרייה אופסו'); }),
  'set-sleep': el => setSleep(Number(el.dataset.minutes)), 'cancel-sleep': () => setSleep(0)
};
async function playPlaylist(id) {
  const p = state.playlists.find(x => x.id === id); if (!p) return;
  state.queue = p.tracks.filter(id => track(id) && ['youtube', 'local'].includes(track(id).source)); persist();
  if (!state.queue.length) { toast('באוסף הזה אין קבצים או סרטונים לתור. קטעי iTunes מושמעים בנפרד מתוך הכרטיס.'); return; }
  closeDialog(); await play(state.queue[0]);
}
document.addEventListener('click', async e => {
  const el = e.target.closest('[data-action]'); if (!el || el.disabled) return;
  const action = actions[el.dataset.action]; if (!action) return;
  try { await action(el); } catch (error) { toast(error.message || 'הפעולה לא הושלמה.'); }
});
$('searchForm').onsubmit = e => { e.preventDefault(); setTab('discover'); searchMusic(); };
$('feed').addEventListener('error', e => { if (e.target instanceof HTMLImageElement && e.target.closest('.artwork')) e.target.remove(); }, true);
$('tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (!b) return; setTab(b.dataset.tab); if (kindQueries[tab]) { state.settings.source = 'youtube'; $('source').value = 'youtube'; persist(); searchMusic(); } else if (tab === 'discover') searchMusic(); else render(); };
$('source').onchange = e => { state.settings.source = e.target.value; persist(); if (isRemoteTab()) searchMusic(); };
$('sort').onchange = e => { state.settings.sort = e.target.value; persist(); render(); };
$('duration').onchange = () => { if (isRemoteTab() && state.settings.source === 'youtube') searchMusic(); else render(); };
$('genre').onchange = render; $('localFilter').oninput = render;
$('layoutBtn').onclick = () => { state.settings.layout = state.settings.layout === 'grid' ? 'list' : 'grid'; persist(); render(); };
$('loadMore').onclick = () => searchMusic({ append: true });
$('homeBtn').onclick = () => { setTab('watch'); render(); window.scrollTo({ top: 0, behavior: state.settings.reducedMotion ? 'auto' : 'smooth' }); };
$('discoverBtn').onclick = () => { setTab('watch'); render(); };
$('savedTop').onclick = () => { setTab('saved'); render(); $('content').scrollIntoView({ behavior: 'smooth' }); };
$('connectionBtn').onclick = connections; $('settingsBtn').onclick = settings; $('helpBtn').onclick = () => help(); $('tasteBtn').onclick = taste; $('addLinkBtn').onclick = addLinkDialog;
$('importLocalTop').onclick = () => $('localFiles').click(); $('localFiles').onchange = e => importFiles(e.target.files);
$('backupFile').onchange = e => readBackup(e.target.files[0]); $('m3uFile').onchange = e => readM3U(e.target.files[0]);
$('queueClear').onclick = () => { state.queue = []; persist(); toast('התור נוקה'); }; $('queuePlay').onclick = () => { if (state.queue.length) play(state.queue[0]); };
$('youtubeExternal').onclick = () => openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent($('search').value || 'מוזיקה'));
$('tiktokExternal').onclick = () => openExternal('https://www.tiktok.com/search?q=' + encodeURIComponent($('search').value || 'music')); $('kopiko').onclick = () => openExternal('https://kofiko.net/');
$('closeDialog').onclick = closeDialog; $('dialog').addEventListener('click', e => { if (e.target === $('dialog')) { const r = $('dialog').getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(); } });
$('dialog').addEventListener('cancel', () => { dialogCleanup?.(); dialogCleanup = null; });
$('playPauseBtn').onclick = togglePlay; $('nextBtn').onclick = () => skip(1); $('prevBtn').onclick = () => skip(-1); $('closePlayer').onclick = stopPlayer; $('closeStage').onclick = stopPlayer;
$('nowLike').onclick = () => { if (current) toggle('likes', current.id); };
$('seek').oninput = e => seek(currentDuration * Number(e.target.value) / 100);
$('volume').oninput = e => { state.settings.volume = Number(e.target.value); currentMedia.volume = state.settings.volume; ytPlayer?.setVolume?.(state.settings.volume * 100); persist(); };
$('muteBtn').onclick = () => { const muted = state.settings.volume > 0; state.settings.volume = muted ? 0 : .75; applySettings(); persist(); $('muteBtn').textContent = muted ? '⊘' : '♫'; };
$('speed').onchange = e => { state.settings.speed = Number(e.target.value); if (current?.source === 'youtube') ytPlayer?.setPlaybackRate?.(state.settings.speed); else currentMedia.playbackRate = state.settings.speed; persist(); };
$('shuffleBtn').onclick = () => { shuffle = !shuffle; $('shuffleBtn').classList.toggle('on', shuffle); $('shuffleBtn').setAttribute('aria-pressed', shuffle); toast(shuffle ? 'ערבוב מופעל' : 'ערבוב כבוי'); };
$('repeatBtn').onclick = () => { repeat = { off: 'all', all: 'one', one: 'off' }[repeat]; $('repeatBtn').classList.toggle('on', repeat !== 'off'); $('repeatBtn').textContent = repeat === 'one' ? '↻¹' : '↻'; const label = { off: 'חזרה כבויה', all: 'חזרה על התור', one: 'חזרה על השיר' }[repeat]; $('repeatBtn').setAttribute('aria-label', label); toast(label); }; $('sleepBtn').onclick = sleepDialog;
let dragCount = 0;
document.addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { dragCount++; $('dropZone').hidden = false; } });
document.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave', () => { if (--dragCount <= 0) { dragCount = 0; $('dropZone').hidden = true; } });
document.addEventListener('drop', e => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); dragCount = 0; $('dropZone').hidden = true; importFiles(e.dataTransfer.files); });
document.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,select,[contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
  if (e.code === 'Space' && e.target.closest('button,a')) return;
  if (tab === 'watch' && e.key.toLowerCase() === 'm') { e.preventDefault(); watchFeed.toggleMute(); return; }
  if (tab === 'watch' && ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'n', 'N', 'p', 'P', ' '].includes(e.key)) {
    e.preventDefault();
    if (e.code === 'Space') watchFeed.togglePlay();
    else watchFeed.navigate(['ArrowDown', 'PageDown', 'n', 'N'].includes(e.key) ? 1 : -1);
    return;
  }
  if (tab === 'tiktok' && e.key.toLowerCase() === 'm') { e.preventDefault(); shorts.toggleMute(); return; }
  if (tab === 'tiktok' && ['ArrowDown', 'ArrowUp', 'n', 'N', 'p', 'P', ' '].includes(e.key)) {
    e.preventDefault();
    if (e.code === 'Space') shorts.togglePlay();
    else shorts.navigate(['ArrowDown', 'n', 'N'].includes(e.key) ? 1 : -1);
    return;
  }
  if (e.key === '/') { e.preventDefault(); setTab('discover'); render(); $('search').focus(); } else if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.key.toLowerCase() === 'n') skip(1); else if (e.key.toLowerCase() === 'p') skip(-1); else if (e.key.toLowerCase() === 'm') $('muteBtn').click(); else if (e.key.toLowerCase() === 's' && current) toggle('saved', current.id);
  else if (e.key === 'ArrowRight' && current) { e.preventDefault(); seek(Math.min(currentDuration || currentPosition + 10, currentPosition + 10)); } else if (e.key === 'ArrowLeft' && current) { e.preventDefault(); seek(Math.max(0, currentPosition - 10)); }
});
window.addEventListener('beforeunload', savePosition); document.addEventListener('visibilitychange', () => { if (document.hidden) savePosition(); if (sleepUntil && Date.now() >= sleepUntil) { pause(); setSleep(0); } });
window.addEventListener('online', () => { $('offlineBadge').hidden = true; toast('החיבור חזר'); }); window.addEventListener('offline', () => { $('offlineBadge').hidden = false; toast('החיבור נותק. קבצים שכבר הוספת זמינים בספרייה המקומית.'); }); $('offlineBadge').hidden = navigator.onLine;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $('installBtn').hidden = false; }); $('installBtn').onclick = async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('installBtn').hidden = true; } };
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; toast('Music Muse נוסף למסך הבית'); });
if ('mediaSession' in navigator) for (const [name, handler] of Object.entries({ play: () => { if (!isPlaying) togglePlay(); }, pause, nexttrack: () => skip(1), previoustrack: () => skip(-1), seekbackward: () => seek(Math.max(0, currentPosition - 10)), seekforward: () => seek(Math.min(currentDuration, currentPosition + 10)) })) { try { navigator.mediaSession.setActionHandler(name, handler); } catch { /* Device-specific action unsupported. */ } }
if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', 'terminal.local'].includes(location.hostname))) navigator.serviceWorker.register('/sw.js').catch(() => {});

applySettings(); updateSuggestions(); updateStats();
initCreatorPromo($('creatorPromo'));
// Remove old unreferenced API metadata after 30 days; user-owned local media is retained.
const references = new Set([...DISCOVERY_ITEMS.map(x => x.id), ...state.saved, ...state.likes, ...state.queue, ...state.playlists.flatMap(x => x.tracks)]);
for (const x of Object.values(state.tracks)) if (x.source !== 'local' && !references.has(x.id) && Date.now() - x.fetchedAt > 30 * 86400000) { removeTrack(x.id); }
const sharedVideo = new URLSearchParams(location.search).get('video');
if (sharedVideo && /^[\w-]{11}$/.test(sharedVideo)) importVideo('https://www.youtube.com/watch?v=' + sharedVideo);
else { setTab('watch'); render(); refreshViewingFeed(); }
setInterval(() => { if (!document.hidden && navigator.onLine && ['watch', 'tiktok'].includes(tab)) refreshViewingFeed(); }, 5 * 60 * 1000);
api('config').then(data => { configured = data.youtubeConfigured; accessProtected = data.accessProtected; }).catch(() => {});
