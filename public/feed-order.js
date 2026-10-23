import { YOUTUBE_CHANNELS } from './discovery.js';
// A local viewing order for this site's sources. It is not the platforms'
// private recommendation algorithm. Preserve an active session as updates arrive.
export function orderFeed(items, history = [], followed = []) {
  const seen = new Set(history.map(x => typeof x === 'string' ? x : x.id));
  const unique = [...new Map(items.filter(x => x?.source === 'youtube' && /^[\w-]{11}$/.test(x.videoId)).map(x => [x.id, x])).values()];
  const result = [];
  for (const watched of [false, true]) {
    const groups = new Map();
    for (const item of unique.filter(x => seen.has(x.id) === watched)) {
      if (!groups.has(item.artist)) groups.set(item.artist, []);
      groups.get(item.artist).push(item);
    }
    const artists = [...groups.keys()].sort((a, b) => Number(followed.includes(b)) - Number(followed.includes(a)));
    while (artists.some(artist => groups.get(artist).length)) {
      for (const artist of artists) if (groups.get(artist).length) result.push(groups.get(artist).shift());
    }
  }
  return result;
}

export function mergeFeedSession(current, incoming) {
  const byId = new Map(incoming.map(x => [x.id, x]));
  return [...current.filter(x => byId.has(x.id)).map(x => byId.get(x.id)), ...incoming.filter(x => !current.some(old => old.id === x.id))];
}

export function channelFeedEntries() {
  return YOUTUBE_CHANNELS.filter(channel => channel.embeddedUploads).map(channel => ({ id: 'channel:' + channel.id, source: 'youtube', channelId: channel.id, artist: channel.name, title: 'העדכונים של ' + channel.alias, tags: ['עדכוני ערוץ'], duration: 0, genre: '' }));
}
