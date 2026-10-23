import { normalizeTrack } from './core.js';

export const YOUTUBE_CHANNELS = Object.freeze([
  { id: 'UCHwxQ7twj_VWIPMcJ3Zdyqg', name: 'ישי ריבו | Ishay Ribo', alias: 'ישי ריבו', embeddedUploads: true },
  { id: 'UCefarW8iWzuNO7NedV-om-w', name: 'Benny Friedman', alias: 'בני פרידמן' }
]);

// Public videos selected for the site. These are ordinary official embeds,
// never a visitor's private subscriptions or personal TikTok For You feed.
const youtubeSeeds = [
  {
    "videoId": "T5Wf3gmF6Do",
    "title": "סיבת הסיבות",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official"
  },
  {
    "videoId": "Y30pfWIQfoo",
    "title": "לשוב הביתה",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official"
  },
  {
    "videoId": "JN5AVdAzmzU",
    "title": "הכל משמים",
    "artist": "Mordechai Shapiro",
    "kind": "official"
  },
  {
    "videoId": "W5zhEum4eRU",
    "title": "דרך העושים מאהבה - Ishay Ribo feat. Zusha",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2026-09-08T08:00:05+00:00"
  },
  {
    "videoId": "8Be-_tkVljQ",
    "title": "ישי ריבו - לא לחינם | Ishay Ribo - Lo Lehinam",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2026-03-29T07:40:34+00:00"
  },
  {
    "videoId": "E01BBtVXHWA",
    "title": "ישי ריבו - הנשמה לא meta",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2026-02-15T10:30:00+00:00"
  },
  {
    "videoId": "5UwGI33ZMRg",
    "title": "ישי ריבו - בן אדם (אלול תשפ״ד) | Ishay Ribo - Ben Adam (Live at Madison Square Garden) 2024",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "live",
    "publishedAt": "2025-09-11T07:00:04+00:00"
  },
  {
    "videoId": "u2FzBma7eIA",
    "title": "Ishay Ribo - Od Yishama  | ישי ריבו - עוד ישמע (גרסת החופה)",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2025-08-11T08:00:07+00:00"
  },
  {
    "videoId": "5ADkXL76qzA",
    "title": "סיבת הסיבות (Madison Square Garden - Live)",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "live",
    "publishedAt": "2025-08-05T16:34:01+00:00"
  },
  {
    "videoId": "ZxflGzdnKVY",
    "title": "ישי ריבו - סיבת הסיבות | Ishay Ribo - Sibat Hasibot (Live at Madison Square Garden) 2024",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "live",
    "publishedAt": "2025-08-05T08:00:07+00:00"
  },
  {
    "videoId": "WWuRyXGIZJk",
    "title": "Ishay Ribo at The Garden II 2024",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2025-01-21T11:36:13+00:00"
  },
  {
    "videoId": "6EcDNWjQxMk",
    "title": "Ishay Ribo - Akadem Et Paneich | ישי ריבו - אקדם את פנייך",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:48:24+00:00"
  },
  {
    "videoId": "OkZ30zLdHTY",
    "title": "Ishay Ribo - Erets Israel | ישי ריבו - ארץ ישראל",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:48:21+00:00"
  },
  {
    "videoId": "erPMOwjcC74",
    "title": "Ishay Ribo - Kan Ata | ישי ריבו - כאן אתה",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:48:15+00:00"
  },
  {
    "videoId": "YvETUFACpUA",
    "title": "Ishay Ribo - Lama Lanu Ledaber Me'Acherim | ישי ריבו - למה לנו לדבר מאחרים",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:48:11+00:00"
  },
  {
    "videoId": "7mAUWMDZKXA",
    "title": "Ishay Ribo - Lule' Toratcha | ישי ריבו - לולא תורתך",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:48:01+00:00"
  },
  {
    "videoId": "jDmmNSTSjds",
    "title": "Ishay Ribo - Porchim Le'shuvam | ישי ריבו - פורחים לשובם",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:47:38+00:00"
  },
  {
    "videoId": "CvMjfvhYyqA",
    "title": "Ishay Ribo - Rabbi Shimon | ישי ריבו - רבי שמעון",
    "artist": "ישי ריבו | Ishay Ribo",
    "kind": "official",
    "publishedAt": "2024-09-17T14:47:17+00:00"
  },
  {
    "videoId": "Ru0TV94byaI",
    "title": "BACKSTAGE WITH HERSHY! New Episode Out Now",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-10-13T21:38:14+00:00"
  },
  {
    "videoId": "0DB1_4oSQ5Q",
    "title": "The Songs Along the Way | Hershy Weinberger | Backstage with Benny",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-10-13T21:15:29+00:00"
  },
  {
    "videoId": "-zdd6meMR_4",
    "title": "Benny & Friends 2: Whee Are Homeward Bound! Sukkos '26 Concert Recap",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-10-09T04:55:49+00:00"
  },
  {
    "videoId": "P8vu2OWlvbQ",
    "title": "Benny & Friends 2: Whee Are Homeward Bound!",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-22T02:43:27+00:00"
  },
  {
    "videoId": "3OlKZ4YQLrA",
    "title": "The Story Behind \"V'nacha\"",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-15T01:37:56+00:00"
  },
  {
    "videoId": "FnSwBbp5wkk",
    "title": "Backstage with Eitan! OUT NOW 🙌",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-10T14:11:40+00:00"
  },
  {
    "videoId": "OhyvTsWQLFA",
    "title": "The Niggun Within | Eitan Katz | Backstage with Benny",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-10T13:59:56+00:00"
  },
  {
    "videoId": "YWc5-rP8QIY",
    "title": "NEW VLOG: The Making of Homeward Bound",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-03T22:46:38+00:00"
  },
  {
    "videoId": "PLWCD2w2TZI",
    "title": "The Making of Homeward Bound | Benny Friedman",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-09-03T22:32:45+00:00"
  },
  {
    "videoId": "l040rHwfRT8",
    "title": "Backstage with Benny Episode 2!",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-08-06T19:15:54+00:00"
  },
  {
    "videoId": "jxentNpZWdo",
    "title": "The Music Was Always There | Baruch Levine | Backstage with Benny",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-08-06T18:59:12+00:00"
  },
  {
    "videoId": "OamUxmbW6JQ",
    "title": "(From the archive) We Traveled to Kazakhstan ",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-08-03T13:58:14+00:00"
  },
  {
    "videoId": "IEdtYdhB4lY",
    "title": "NEW EP OUT NOW!",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-07-26T18:52:46+00:00"
  },
  {
    "videoId": "3TFy2aXlJjc",
    "title": "It's time to go home... stay tuned!",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-07-24T17:38:27+00:00"
  },
  {
    "videoId": "Vv_VP8A6WOg",
    "title": "What if Shlomo Carlebach sang “Bekitcha”? 💭",
    "artist": "Benny Friedman",
    "kind": "official",
    "publishedAt": "2026-06-18T18:38:17+00:00"
  }
];
const tikTokSeeds = [
  { url: 'https://www.tiktok.com/@frasertsmith/video/7162965398848097542', title: 'רגע מוזיקלי מהאולפן', artist: 'Fraser T Smith' },
  { url: 'https://www.tiktok.com/@frasertsmith/video/7194489081521278214', title: 'עוד צליל מאולפן ההקלטות', artist: 'Fraser T Smith' }
];
export const DISCOVERY_ITEMS = Object.freeze([
  ...youtubeSeeds.map(x => ({ ...x, source: 'youtube', id: 'youtube:' + x.videoId, url: 'https://www.youtube.com/watch?v=' + x.videoId, artwork: `https://i.ytimg.com/vi/${x.videoId}/hqdefault.jpg`, tags: ['בחירת האתר', x.artist.includes('Benny') ? 'בני פרידמן' : x.artist.includes('Shapiro') ? 'מרדכי שפירא' : 'ישי ריבו', x.kind === 'live' ? 'הופעה חיה' : x.kind === 'cover' ? 'קאבר' : 'קליפ'] })),
  ...tikTokSeeds.map(x => ({ ...x, id: 'tiktok:' + x.url.split('/').at(-1), source: 'tiktok', tags: ['בחירת האתר', 'TikTok'] }))
]);
export function discoveryTracks(source) { return DISCOVERY_ITEMS.filter(x => !source || x.source === source).map(normalizeTrack).filter(Boolean); }

export function seedDiscovery(state) {
  let changed = false;
  for (const item of discoveryTracks()) if (!state.tracks[item.id]) { state.tracks[item.id] = item; changed = true; }
  if (!state.settings.discoveryReady) { state.settings.source = 'youtube'; state.settings.discoveryReady = true; changed = true; }
  return changed;
}

const fold = text => String(text).normalize('NFKD').replace(/[\u0591-\u05c7]/g, '').toLocaleLowerCase('he');
export function searchCollection({ q = '', kind = 'all', source = 'youtube', offset = 0, items = DISCOVERY_ITEMS } = {}) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const selected = [...new Map(items.filter(x => x.source === source && (kind === 'all' || x.kind === kind) && words.every(word => fold(`${x.title} ${x.artist} ${(x.tags || []).join(' ')}`).includes(word))).map(x => [x.id || x.source + ':' + (x.videoId || x.url), x])).values()];
  return { items: selected.slice(offset, offset + 20).map(normalizeTrack).filter(Boolean), total: selected.length, nextOffset: offset + 20 < selected.length ? offset + 20 : null, nextPage: null, source, query: q, mode: 'collection' };
}
