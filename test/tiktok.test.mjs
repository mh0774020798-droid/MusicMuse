import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTikTokURL, isShortTikTokURL, extractTikTokLinks, tikTokPlayerURL, isTikTokPlayerMessage, parseTikTokPlayerMessage } from '../public/tiktok.js';
import { emptyState, normalizeTrack, sanitizeState, mergeState } from '../public/core.js';
import { handleRequest } from '../api/index.js';
import { TikTokFeed } from '../public/shorts.js';

const postURL = 'https://www.tiktok.com/@artist/video/6718335390845095173';
let requests = 0;
const request = url => new Request('https://muse.test/api/tiktok?url=' + encodeURIComponent(url), { headers: { 'x-real-ip': 'tiktok-test-' + (++requests) } });
const metadata = { type: 'video', provider_name: 'TikTok', title: 'מוזיקה חדשה', author_name: 'Artist', thumbnail_url: 'https://p16.muscdn.com/test.jpg', html: '<script>alert(1)</script>' };

test('TikTok links are canonicalized without rounding 64-bit post IDs', () => {
  const post = parseTikTokURL(postURL + '?is_from_webapp=1&sender_device=pc');
  assert.equal(post.id, '6718335390845095173'); assert.equal(typeof post.id, 'string'); assert.equal(post.url, postURL);
  assert.equal(parseTikTokURL(postURL.replace('/@', '/%40')).url, postURL);
  for (const input of ['https://www.tiktok.com.evil.test/@artist/video/6718335390845095173', 'javascript:alert(1)', 'https://user:pass@www.tiktok.com/@artist/video/6718335390845095173', 'https://www.tiktok.com/@artist/photo/6718335390845095173', 'https://www.tiktok.com/@artist/video/123']) assert.equal(parseTikTokURL(input), null);
});
test('bulk import deduplicates copied links and accepts supported TikTok short links', () => {
  assert.deepEqual(extractTikTokLinks(`סרטון ${postURL}\n${postURL}?foo=bar\nhttps://evil.test/x\nhttps://vt.tiktok.com/ZS12345/`), [postURL, 'https://vt.tiktok.com/ZS12345/']);
  assert.equal(isShortTikTokURL('https://vt.tiktok.com.evil.test/ZS12345/'), false);
  assert.equal(extractTikTokLinks('https://youtube.com/watch?v=abcdefghijk').length, 0);
});
test('TikTok saved items and playlists survive backup round trips and merging', () => {
  const state = emptyState(); const item = normalizeTrack({ source: 'tiktok', url: postURL, title: 'שיר', artist: 'זמר' });
  state.tracks[item.id] = item; state.saved = [item.id]; state.likes = [item.id]; state.queue = [item.id]; state.playlists = [{ id: 'pl:tt', name: 'רצף', tracks: [item.id] }];
  const restored = sanitizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.tracks[item.id].tiktokId, '6718335390845095173'); assert.deepEqual(restored.saved, [item.id]); assert.deepEqual(restored.queue, []);
  assert.deepEqual(mergeState(emptyState(), restored).playlists[0].tracks, [item.id]);
});
test('player messages are accepted only from the active official iframe', () => {
  const active = {}, other = {};
  const event = { origin: 'https://www.tiktok.com', source: active, data: { 'x-tiktok-player': true, type: 'onPlayerReady' } };
  assert.equal(isTikTokPlayerMessage(event, active), true); assert.equal(isTikTokPlayerMessage(event, other), false);
  assert.equal(isTikTokPlayerMessage({ ...event, origin: 'https://evil.test' }, active), false); assert.equal(isTikTokPlayerMessage({ ...event, data: { type: 'onPlayerReady' } }, active), false);
  assert.equal(new URL(tikTokPlayerURL('6718335390845095173')).hostname, 'www.tiktok.com'); assert.equal(tikTokPlayerURL('javascript:bad'), '');
});
test('leaving the vertical feed pauses and removes its iframe', () => {
  const sent = []; let removed = false;
  const controller = Object.create(TikTokFeed.prototype);
  controller.frame = { contentWindow: { postMessage: (message, origin) => sent.push({ message, origin }) }, remove: () => { removed = true; } }; controller.root = { hidden: false }; controller.playing = true;
  controller.hide();
  assert.equal(sent[0].message.type, 'pause'); assert.equal(sent[0].origin, 'https://www.tiktok.com'); assert.equal(removed, true); assert.equal(controller.frame, null); assert.equal(controller.root.hidden, true); assert.equal(controller.playing, false);
});
test('live TikTok JSON string messages are decoded safely with the same origin and source checks', () => {
  const frame = {}, data = { 'x-tiktok-player': true, type: 'onPlayerReady' };
  const event = { source: frame, origin: 'https://www.tiktok.com', data: JSON.stringify(data) };
  assert.deepEqual(parseTikTokPlayerMessage(event, frame), data);
  assert.equal(parseTikTokPlayerMessage({ ...event, data: 'not json' }, frame), null);
  assert.equal(parseTikTokPlayerMessage({ ...event, data: 'x'.repeat(10001) }, frame), null);
  assert.equal(parseTikTokPlayerMessage({ ...event, origin: 'https://evil.test' }, frame), null);
});
test('TikTok metadata uses the official endpoint and never injects returned HTML', async () => {
  const result = await handleRequest(request(postURL), { env: {}, fetcher: async url => { assert.equal(new URL(url).hostname, 'www.tiktok.com'); assert.equal(new URL(url).pathname, '/oembed'); return Response.json(metadata); } });
  const data = await result.json(); assert.equal(result.status, 200); assert.equal(data.item.source, 'tiktok'); assert.equal(data.metadataAvailable, true); assert.equal(data.item.title, metadata.title); assert.equal(JSON.stringify(data).includes('<script>'), false);
});
test('TikTok metadata failure retains a valid link and reports the missing metadata', async () => {
  const result = await handleRequest(request(postURL), { env: {}, fetcher: async () => { throw new Error('offline'); } }); const data = await result.json();
  assert.equal(result.status, 200); assert.equal(data.metadataAvailable, false); assert.equal(data.item.url, postURL); assert.ok(data.warning);
});
test('TikTok short-link resolution rejects external redirects before fetching them', async () => {
  const calls = [];
  const result = await handleRequest(request('https://vt.tiktok.com/ZS12345/'), { env: {}, fetcher: async (url, options) => { calls.push(url); assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://evil.test/private' } }); } });
  assert.equal(result.status, 400); assert.equal(calls.length, 1);
});
test('official short links resolve to a video before metadata is requested', async () => {
  const calls = [];
  const result = await handleRequest(request('https://vm.tiktok.com/ZS12345/'), { env: {}, fetcher: async url => { calls.push(String(url)); return String(url).startsWith('https://vm.tiktok.com/') ? new Response(null, { status: 302, headers: { Location: postURL } }) : Response.json(metadata); } });
  const data = await result.json(); assert.equal(result.status, 200); assert.equal(calls.length, 2); assert.equal(data.item.tiktokId, '6718335390845095173');
});
