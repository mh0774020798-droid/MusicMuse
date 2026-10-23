import test from 'node:test';
import assert from 'node:assert/strict';
import { orderFeed, mergeFeedSession, channelFeedEntries } from '../public/feed-order.js';
import { youtubeEmbedURL, channelEmbedURL } from '../public/youtube.js';
import { YouTubeFeed } from '../public/watch-feed.js';
import { handleRequest } from '../api/index.js';
import { YOUTUBE_CHANNELS } from '../public/discovery.js';

const items = [
  { id: 'youtube:abcdefghij1', source: 'youtube', videoId: 'abcdefghij1', artist: 'A' },
  { id: 'youtube:abcdefghij2', source: 'youtube', videoId: 'abcdefghij2', artist: 'A' },
  { id: 'youtube:abcdefghij3', source: 'youtube', videoId: 'abcdefghij3', artist: 'B' }
];
test('the viewing feed mixes artists, prioritizes unwatched videos and never duplicates a clip', () => {
  assert.deepEqual(orderFeed([...items, items[0]]).map(x => x.id), [items[0].id, items[2].id, items[1].id]);
  assert.deepEqual(orderFeed(items, [{ id: items[0].id }]).map(x => x.id), [items[1].id, items[2].id, items[0].id]);
  assert.equal(orderFeed(items, [], ['B'])[0].artist, 'B');
  assert.equal(orderFeed([{ ...items[0], videoId: '<script>' }]).length, 0);
});
test('a background refresh appends new clips without reordering the active viewing session', () => {
  const current = [items[2], items[0]], incoming = [items[0], items[1], items[2]];
  assert.deepEqual(mergeFeedSession(current, incoming).map(x => x.id), [items[2].id, items[0].id, items[1].id]);
  assert.deepEqual(mergeFeedSession(current, [items[0]]).map(x => x.id), [items[0].id]);
});
test('YouTube embeds use the official player with muted autoplay and visible native controls', () => {
  const url = new URL(youtubeEmbedURL('abcdefghijk', 'https://muse.test'));
  assert.equal(url.origin, 'https://www.youtube-nocookie.com'); assert.equal(url.pathname, '/embed/abcdefghijk');
  for (const [key, value] of Object.entries({ autoplay: '1', mute: '1', controls: '1', enablejsapi: '1', origin: 'https://muse.test' })) assert.equal(url.searchParams.get(key), value);
  assert.equal(new URL(youtubeEmbedURL('abcdefghijk', 'https://muse.test', false)).searchParams.get('autoplay'), '0');
  assert.throws(() => youtubeEmbedURL('https://evil.test', 'https://muse.test'));
});
test('the feed endpoint discovers newly published videos without a query, link or API key', async () => {
  const urls = [];
  const fetcher = async input => {
    const url = new URL(input); urls.push(url);
    const channel = YOUTUBE_CHANNELS.find(x => x.id === url.searchParams.get('channel_id'));
    assert.ok(channel);
    return new Response(`<feed><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channel.id}</yt:channelId><title>A new music video</title></entry></feed>`);
  };
  const res = await handleRequest(new Request('https://muse.test/api/feed', { headers: { 'x-real-ip': 'feed-live' } }), { env: {}, fetcher });
  const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.youtubeMode, 'channels'); assert.equal(data.channelsAvailable, 2);
  assert.ok(data.items.some(x => x.videoId === 'abcdefghijk')); assert.ok(data.items.filter(x => x.source === 'youtube').length > 30);
  assert.equal(data.items.filter(x => x.source === 'tiktok').length, 2); assert.equal(data.tiktokMode, 'selection');
  assert.ok(Number.isFinite(Date.parse(data.checkedAt)));
  assert.equal(urls.length, 2); assert.ok(urls.every(x => x.hostname === 'www.youtube.com' && !x.searchParams.has('key') && !x.searchParams.has('q')));
});
test('a feed outage keeps real built-in videos and reports fallback rather than a live connection', async () => {
  const res = await handleRequest(new Request('https://muse.test/api?route=feed', { headers: { 'x-real-ip': 'feed-offline' } }), { env: {}, fetcher: async () => { throw new Error('offline'); } });
  const data = await res.json(); assert.equal(res.status, 200); assert.equal(data.youtubeMode, 'collection'); assert.equal(data.channelsAvailable, 0); assert.ok(data.items.length >= 35);
});

function viewer() {
  const feed = Object.create(YouTubeFeed.prototype), plays = [], moves = [], messages = [];
  Object.assign(feed, { items, index: 0, recorded: new Set(), autoNext: true, callbacks: { onPlay: x => plays.push(x.id) }, canPlay: () => true, status: x => messages.push(x), updateControls() {}, navigate: delta => moves.push(delta), playing: false, intent: true, suspended: false });
  return { feed, plays, moves, messages };
}
test('feed history is recorded only after actual playback, and a hidden player cannot keep playing', () => {
  const { feed, plays } = viewer();
  feed.stateChange(3); assert.deepEqual(plays, []);
  feed.stateChange(1); feed.stateChange(1); assert.deepEqual(plays, [items[0].id]);
  let pauses = 0; feed.player = { pauseVideo: () => pauses++ }; feed.canPlay = () => false;
  feed.index = 1; feed.stateChange(1); assert.equal(pauses, 1); assert.equal(feed.playing, false); assert.deepEqual(plays, [items[0].id]);
});
test('ending a video advances only while visible and enabled, and stops honestly at the end', () => {
  const { feed, moves, messages } = viewer();
  feed.stateChange(0); assert.deepEqual(moves, [1]);
  feed.autoNext = false; feed.stateChange(0); assert.equal(moves.length, 1);
  feed.autoNext = true; feed.canPlay = () => false; feed.stateChange(0); assert.equal(moves.length, 1);
  feed.canPlay = () => true; feed.index = items.length - 1; feed.stateChange(0); assert.equal(moves.length, 1); assert.match(messages.at(-1), /סוף/);
  let stops = 0; feed.items = channelFeedEntries(); feed.index = 0; feed.autoNext = false; feed.player = { getPlaylist: () => [], stopVideo: () => stops++ };
  feed.root = { querySelectorAll: () => [{ querySelectorAll: () => [] }] }; feed.stateChange(0); feed.stateChange(0); assert.equal(stops, 1, 'do not let the native playlist advance when automatic playback is disabled');
});
test('closing the feed destroys the official player and its iframe', () => {
  const { feed } = viewer(); let destroyed = 0, removed = 0, disconnected = 0;
  Object.assign(feed, { root: { hidden: false }, player: { destroy: () => destroyed++ }, frame: { remove: () => removed++ }, resizeObserver: { disconnect: () => disconnected++ } });
  feed.hide(); assert.equal(feed.root.hidden, true); assert.equal(feed.frame, null); assert.equal(feed.player, null); assert.equal(destroyed, 1); assert.equal(removed, 1); assert.equal(disconnected, 1);
});
test('dialog suspension resumes only a feed the visitor had not manually paused', () => {
  const { feed } = viewer(); let starts = 0;
  feed.player = { pauseVideo() {}, playVideo: () => starts++ };
  feed.suspend(); feed.syncVisibility(); assert.equal(starts, 1);
  feed.pause(); feed.suspend(); feed.syncVisibility(); assert.equal(starts, 1);
});

test('automatic uploads use only approved public channel playlists and require no key or query', () => {
  const entries = channelFeedEntries(); assert.ok(entries.length > 0);
  for (const channel of entries) {
    const url = new URL(channelEmbedURL(channel.channelId, 'https://muse.test'));
    assert.equal(url.hostname, 'www.youtube-nocookie.com'); assert.equal(url.pathname, '/embed/videoseries');
    assert.equal(url.searchParams.get('list'), 'UU' + channel.channelId.slice(2));
    assert.equal(url.searchParams.get('listType'), 'playlist'); assert.equal(url.searchParams.get('key'), null); assert.equal(url.searchParams.get('q'), null);
  }
  assert.throws(() => channelEmbedURL('UCnot-an-approved-channel', 'https://muse.test'));
});

test('official playlist discovery deduplicates valid IDs and actions refer to the actual current video', () => {
  const { feed } = viewer(), discovered = [], captions = { textContent: '' };
  const buttons = ['like', 'save', 'menu'].map(action => ({ dataset: { watchAction: action }, disabled: true, setAttribute() {} }));
  const slide = { querySelectorAll: () => buttons, querySelector: () => captions };
  let playlist = ['abcdefghijk', 'abcdefghijk', 'bad', 'https://evil.test'];
  Object.assign(feed, { items: channelFeedEntries(), index: 0, discoveredChannels: new Map(), root: { querySelectorAll: () => [slide] }, frame: { title: 'A public video title' }, player: { getVideoUrl: () => 'https://www.youtube.com/watch?v=abcdefghijk', getPlaylist: () => playlist }, syncActions() {} });
  feed.callbacks = { onItem: item => item, onDiscover: clips => discovered.push(clips) };
  feed.syncChannel(); assert.equal(feed.activeItem.id, 'youtube:abcdefghijk'); assert.equal(captions.textContent, 'A public video title');
  assert.ok(buttons.every(x => x.dataset.id === 'youtube:abcdefghijk' && !x.disabled));
  assert.equal(discovered.length, 1); assert.equal(discovered[0].length, 1);
  feed.syncChannel(); assert.equal(discovered.length, 1);
  playlist = ['abcdefghijk', 'abcdefghij2']; feed.syncChannel(); assert.equal(discovered.length, 2);
});

test('a channel cannot save or record its placeholder when no actual YouTube video is available', () => {
  const { feed } = viewer(), buttons = [{ disabled: false }];
  Object.assign(feed, { items: channelFeedEntries(), index: 0, activeItem: items[0], discoveredChannels: new Map(), root: { querySelectorAll: () => [{ querySelectorAll: () => buttons }] }, player: { getVideoUrl: () => 'https://evil.test/watch?v=abcdefghijk', getPlaylist: () => [] } });
  feed.syncChannel(); assert.equal(feed.activeItem, null); assert.equal(buttons[0].disabled, true);
});

test('a hidden channel video is paused and skipped without recording a playback', () => {
  const { feed, plays, moves } = viewer(); let pauses = 0;
  Object.assign(feed, { activeItem: items[0], hidden: new Set([items[0].id]), player: { pauseVideo: () => pauses++ } });
  feed.suppressHidden(); feed.suppressHidden(); assert.equal(pauses, 1); assert.deepEqual(moves, [1]); assert.equal(feed.intent, false);
  feed.stateChange(1); assert.deepEqual(plays, []); assert.equal(feed.playing, false);
});
