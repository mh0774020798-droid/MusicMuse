import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeTrack, sanitizeState } from '../public/core.js';
import { DISCOVERY_ITEMS, YOUTUBE_CHANNELS, seedDiscovery, searchCollection, discoveryTracks } from '../public/discovery.js';
import { parseChannelFeed, discoverYouTube } from '../lib/discovery.js';

test('a first visit has a ready YouTube library and TikTok feed without keys, links or saved favorites', () => {
  const state = emptyState();
  assert.equal(seedDiscovery(state), true);
  assert.equal(state.settings.source, 'youtube');
  assert.equal(state.settings.discoveryReady, true);
  assert.ok(discoveryTracks('youtube').length >= 30);
  assert.equal(discoveryTracks('tiktok').length, 2);
  assert.ok(discoveryTracks().every(x => x && x.url.startsWith('https://www.') && !x.url.includes('key=')));
  assert.deepEqual(state.saved, []); assert.deepEqual(state.likes, []);
  const count = Object.keys(state.tracks).length;
  assert.equal(seedDiscovery(state), false); assert.equal(Object.keys(state.tracks).length, count);
});

test('upgrading an existing visitor preserves saved items, likes, hidden items and chosen settings', () => {
  const state = emptyState(), item = normalizeTrack({ source: 'youtube', videoId: 'abcdefghijk', title: 'פריט אישי' });
  state.settings.source = 'itunes'; state.tracks[item.id] = item; state.saved = [item.id]; state.likes = [item.id]; state.hidden = [item.id];
  seedDiscovery(state);
  assert.equal(state.tracks[item.id].title, 'פריט אישי'); assert.deepEqual(state.saved, [item.id]); assert.deepEqual(state.likes, [item.id]); assert.deepEqual(state.hidden, [item.id]);
  const restored = sanitizeState(JSON.parse(JSON.stringify(state)));
  restored.settings.source = 'itunes'; seedDiscovery(restored);
  assert.equal(restored.settings.source, 'itunes', 'do not repeatedly override the visitor after the initial migration');
});

test('collection search supports Hebrew artist names, categories and pagination without duplicate videos', () => {
  const first = searchCollection(), second = searchCollection({ offset: first.nextOffset });
  assert.equal(first.items.length, 20); assert.equal(first.mode, 'collection');
  assert.equal(new Set([...first.items, ...second.items].map(x => x.id)).size, first.total);
  assert.ok(searchCollection({ q: 'בני פרידמן' }).items.length > 0);
  assert.ok(searchCollection({ q: 'מרדכי שפירא' }).items.length > 0);
  const live = searchCollection({ kind: 'live' }); assert.ok(live.items.length > 0); assert.ok(live.items.every(x => x.tags.includes('הופעה חיה')));
  assert.equal(searchCollection({ q: 'not-in-this-collection-unique' }).total, 0);
  assert.equal(new Set(DISCOVERY_ITEMS.map(x => x.id)).size, DISCOVERY_ITEMS.length);
});

const feed = channel => `<feed><entry><yt:videoId>abcdefghijk</yt:videoId><yt:channelId>${channel.id}</yt:channelId><title><![CDATA[Live &amp; music]]></title><published>2026-10-01T10:00:00Z</published><link href="https://evil.test/video"/></entry></feed>`;
test('official channel feeds accept only valid videos from the intended channel and construct safe URLs', () => {
  const channel = YOUTUBE_CHANNELS[0], [item] = parseChannelFeed(feed(channel), channel);
  assert.equal(item.title, 'Live & music'); assert.equal(item.kind, 'live'); assert.equal(item.artist, channel.name);
  assert.equal(item.url, 'https://www.youtube.com/watch?v=abcdefghijk'); assert.equal(item.artwork, 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  assert.equal(parseChannelFeed(feed(channel), YOUTUBE_CHANNELS[1]).length, 0);
  assert.equal(parseChannelFeed(feed(channel).replace('abcdefghijk', 'bad'), channel).length, 0);
  assert.equal(parseChannelFeed('<!DOCTYPE feed [<!ENTITY secret SYSTEM "file:///etc/passwd">]>' + feed(channel), channel).length, 0);
  assert.equal(parseChannelFeed('x'.repeat(262145), channel).length, 0);
});

test('automatic channel discovery uses fixed public endpoints, shares in-flight work and caches responses', async () => {
  const calls = [];
  const fetcher = async (input, options) => {
    const url = new URL(input); calls.push(url.href); assert.equal(url.hostname, 'www.youtube.com'); assert.equal(url.pathname, '/feeds/videos.xml'); assert.equal(options.redirect, 'error'); assert.equal(url.searchParams.has('key'), false);
    const channel = YOUTUBE_CHANNELS.find(x => x.id === url.searchParams.get('channel_id')); assert.ok(channel);
    return new Response(feed(channel));
  };
  const [a, b] = await Promise.all([discoverYouTube(fetcher), discoverYouTube(fetcher)]);
  assert.equal(a.mode, 'channels'); assert.equal(a.channelsAvailable, 2); assert.deepEqual(a, b); assert.equal(calls.length, 2);
  assert.ok(a.items.some(x => x.videoId === 'abcdefghijk'));
  await discoverYouTube(fetcher); assert.equal(calls.length, 2);
});

test('a provider outage leaves the full built-in collection usable without claiming a successful connection', async () => {
  const data = await discoverYouTube(async () => { throw new Error('offline'); });
  assert.equal(data.mode, 'collection'); assert.equal(data.channelsAvailable, 0);
  assert.equal(data.items.length, discoveryTracks('youtube').length);
  assert.ok(searchCollection({ items: data.items, q: 'ישי ריבו' }).items.length > 0);
});
