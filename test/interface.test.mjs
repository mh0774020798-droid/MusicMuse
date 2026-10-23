import test from 'node:test';
import assert from 'node:assert/strict';
import { searchKnownVideos, resolveMusicSearch } from '../public/search.js';
import { TikTokFeed } from '../public/shorts.js';
import { tikTokPlayerURL } from '../public/tiktok.js';
import { togglePlayerSize, closePlayerSize } from '../public/fullscreen.js';

const known = { id: 'youtube:abcdefghijk', source: 'youtube', videoId: 'abcdefghijk', title: 'Unique new upload', artist: 'Other artist' };
test('search includes discovered library videos and a server collection response cannot discard them', async () => {
  assert.equal(searchKnownVideos({ q: 'Unique new upload' }, [known]).items[0].id, known.id);
  const data = await resolveMusicSearch({ q: 'Unique new upload', source: 'youtube' }, { knownItems: [known], request: async () => ({ items: [], mode: 'collection' }) });
  assert.equal(data.items[0].id, known.id); assert.equal(data.source, 'youtube');
});
test('an unmatched video query uses an explicitly labeled music catalog without altering the query', async () => {
  const calls = [];
  const data = await resolveMusicSearch({ q: 'unmatched title xyz', source: 'youtube', kind: 'all' }, { request: async options => { calls.push(options); return options.source === 'youtube' ? { items: [], mode: 'collection' } : { items: [{ id: 'itunes:1' }], source: 'itunes', nextOffset: 20 }; } });
  assert.deepEqual(calls.map(x => x.source), ['youtube', 'itunes']); assert.equal(calls[1].q, 'unmatched title xyz'); assert.equal(data.fallback, 'catalog'); assert.equal(data.source, 'itunes'); assert.equal(data.nextOffset, 20);
});
test('full YouTube results stay YouTube results and cancelled searches do not trigger catalog requests', async () => {
  const response = { items: [known], source: 'youtube', nextPage: 'NEXT' };
  assert.equal(await resolveMusicSearch({ q: 'x', source: 'youtube' }, { request: async () => response }), response);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await assert.rejects(resolveMusicSearch({ q: 'x', source: 'youtube' }, { signal: controller.signal, request: async () => { calls++; throw new Error('cancelled'); } })); assert.equal(calls, 1);
});
test('catalog failure is reported instead of showing a false empty success', async () => {
  await assert.rejects(resolveMusicSearch({ q: 'no-match-xyz', source: 'youtube' }, { request: async options => { if (options.source === 'itunes') throw new Error('catalog offline'); return { mode: 'collection', items: [] }; } }), /catalog offline/);
});
test('TikTok keeps volume unlocked and uses site controls instead of the provider controls', () => {
  const url = new URL(tikTokPlayerURL('7162965398848097542'));
  assert.equal(url.searchParams.get('muted'), '0'); assert.equal(url.searchParams.get('controls'), '0'); assert.equal(url.searchParams.get('autoplay'), '1');
});
test('unmuting sends playback commands without replacing the iframe or seeking away', () => {
  const feed = Object.create(TikTokFeed.prototype), sent = [], frame = {};
  Object.assign(feed, { muted: true, preferredMute: true, frame, position: 17, send: type => sent.push(type), updateControls() {}, activate() { throw new Error('iframe must not reload'); } });
  feed.toggleMute(); assert.deepEqual(sent, ['unMute', 'play']); assert.equal(feed.frame, frame); assert.equal(feed.position, 17); assert.equal(feed.muted, false);
});
test('TikTok commands support object and JSON envelopes and target only the official active frame', () => {
  const feed = Object.create(TikTokFeed.prototype), sent = [];
  feed.frame = { contentWindow: { postMessage: (value, origin) => sent.push({ value, origin }) } };
  feed.send('unMute'); assert.equal(sent.length, 2); assert.equal(sent[0].value.type, 'unMute'); assert.deepEqual(JSON.parse(sent[1].value), sent[0].value); assert.ok(sent.every(x => x.origin === 'https://www.tiktok.com'));
});
test('enlarging uses the local player element and has a local fallback when fullscreen is unavailable', async () => {
  const previous = global.document, classes = new Set(), body = new Set(); let requests = 0;
  const root = { classList: { contains: x => classes.has(x), add: x => classes.add(x), remove: x => classes.delete(x) }, requestFullscreen: async () => { requests++; } };
  global.document = { fullscreenElement: null, body: { classList: { add: x => body.add(x), remove: x => body.delete(x) } }, querySelector: () => null };
  try {
    await togglePlayerSize(root); assert.equal(requests, 1); assert.equal(classes.size, 0);
    root.requestFullscreen = async () => { throw new Error('unsupported'); }; await togglePlayerSize(root); assert.equal(classes.has('expanded-player'), true); assert.equal(body.has('player-expanded'), true);
    closePlayerSize(root); assert.equal(classes.size, 0); assert.equal(body.size, 0);
  } finally { global.document = previous; }
});
