import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../api/index.js';
import { isoDuration, youtubeId } from '../lib/providers.js';
let requestNumber = 0;
const request = (route, headers = {}, method = 'GET') => new Request('https://muse.test' + route, { method, headers: { 'x-real-ip': 'test-' + (++requestNumber), ...headers } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const key = 'test-key-12345678901234567890';

test('server access code is checked before upstream requests', async () => {
  let called = false;
  const res = await handleRequest(request('/api/search?q=music'), { env: { APP_ACCESS_TOKEN: 'private-code' }, fetcher: async () => { called = true; } });
  assert.equal(res.status, 401); assert.equal(called, false); assert.equal((await res.json()).error.code, 'ACCESS_REQUIRED');
});
test('configuration returns key presence but never the key', async () => {
  const res = await handleRequest(request('/api/config'), { env: { YOUTUBE_API_KEY: key } }); const text = await res.text();
  assert.equal(res.status, 200); assert.equal(JSON.parse(text).youtubeConfigured, true); assert.equal(text.includes(key), false);
});
test('search validates query, source, offset and continuation tokens', async () => {
  for (const route of ['/api/search?q=', '/api/search?q=x&source=evil', '/api/search?q=x&offset=-1', '/api/search?q=x&page=%3Cscript%3E', '/api/search?q=x&duration=500']) {
    const res = await handleRequest(request(route), { env: {}, fetcher: () => { throw new Error('should not fetch'); } }); assert.equal(res.status, 400, route);
  }
});
test('missing YouTube key is actionable and does not masquerade as working search', async () => {
  const res = await handleRequest(request('/api/search?q=music&source=youtube'), { env: {} }); assert.equal(res.status, 503); assert.equal((await res.json()).error.code, 'KEY_REQUIRED');
});
test('catalog search maps real provider data, excludes explicit tracks and paginates', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ kind: 'song', trackId: 4000 + i, trackName: 'Song ' + i, artistName: 'Singer', trackViewUrl: 'https://music.apple.com/il/song/' + (4000 + i), artworkUrl100: 'https://is1-ssl.mzstatic.com/image/100x100bb.jpg', previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a', trackTimeMillis: 180000, trackExplicitness: i === 2 ? 'explicit' : 'notExplicit', primaryGenreName: 'World' }));
  let upstream;
  const fetcher = async url => { upstream = new URL(url); return response({ results: rows }); };
  const res = await handleRequest(request('/api/search?q=unique-catalog-test&source=itunes'), { env: {}, fetcher }); const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.items.length, 20); assert.equal(data.total, 24); assert.equal(data.nextOffset, 20); assert.equal(data.items[0].duration, 180); assert.equal(data.items.some(x => x.id === 'itunes:4002'), false); assert.equal(upstream.hostname, 'itunes.apple.com'); assert.equal(upstream.searchParams.get('explicit'), 'No');
  const page = await handleRequest(request('/api/search?q=unique-catalog-test&source=itunes&offset=20'), { env: {}, fetcher }); assert.equal((await page.json()).items.length, 4);
});
test('YouTube search requests embeddable music videos and enriches durations', async () => {
  const urls = [];
  const fetcher = async url => { const u = new URL(url); urls.push(u); return u.pathname.endsWith('/search') ? response({ items: [{ id: { videoId: 'abcdefghijk' }, snippet: { title: 'Live song', channelTitle: 'Artist', thumbnails: { high: { url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' } }, publishedAt: '2026-01-01' } }], nextPageToken: 'NEXT_TOKEN', pageInfo: { totalResults: 50 } }) : response({ items: [{ id: 'abcdefghijk', contentDetails: { duration: 'PT4M12S' }, statistics: { viewCount: '123' } }] }); };
  const res = await handleRequest(request('/api/search?q=unique-yt-test&source=youtube', { 'x-youtube-key': key }), { env: {}, fetcher }); const data = await res.json();
  assert.equal(res.status, 200); assert.equal(urls[0].searchParams.get('videoEmbeddable'), 'true'); assert.equal(urls[0].searchParams.get('safeSearch'), 'strict'); assert.equal(data.items[0].duration, 252); assert.equal(data.items[0].views, 123); assert.equal(data.nextPage, 'NEXT_TOKEN'); assert.equal(JSON.stringify(data).includes(key), false);
});
test('provider rejection maps to a redacted, useful error', async () => {
  const res = await handleRequest(request('/api/search?q=quota-test&source=youtube', { 'x-youtube-key': key }), { env: {}, fetcher: async () => response({ error: { message: 'SECRET:' + key, errors: [{ reason: 'quotaExceeded' }] } }, 403) });
  const text = await res.text(); assert.equal(res.status, 429); assert.equal(JSON.parse(text).error.code, 'QUOTA_EXCEEDED'); assert.equal(text.includes(key), false);
});
test('health distinguishes unconfigured YouTube, catalog failure and reachable server', async () => {
  const res = await handleRequest(request('/api/health'), { env: {}, fetcher: async () => { throw new Error('offline'); } }); const data = await res.json();
  assert.equal(data.checks.find(x => x.id === 'server').status, 'ok'); assert.equal(data.checks.find(x => x.id === 'catalog').status, 'error'); assert.equal(data.checks.find(x => x.id === 'youtube').status, 'unconfigured');
});
test('a key health check uses videos.list instead of consuming a search request', async () => {
  const urls = [];
  const res = await handleRequest(request('/api/health', { 'x-youtube-key': key }), { env: {}, fetcher: async url => { urls.push(new URL(url)); return response(String(url).includes('itunes') ? { results: [] } : { items: [] }); } });
  const data = await res.json(); assert.equal(data.checks.every(x => x.status === 'ok'), true); assert.equal(urls.some(x => x.pathname.endsWith('/search') && x.hostname.includes('googleapis')), false);
});
test('video import never fetches user-supplied hosts and keeps a valid link when metadata fails', async () => {
  let called = false;
  const bad = await handleRequest(request('/api/video?url=' + encodeURIComponent('https://evil.test/watch?v=abcdefghijk')), { env: {}, fetcher: () => { called = true; } }); assert.equal(bad.status, 400); assert.equal(called, false);
  const good = await handleRequest(request('/api/video?url=' + encodeURIComponent('https://youtu.be/abcdefghijk')), { env: {}, fetcher: async url => { assert.equal(new URL(url).hostname, 'www.youtube.com'); throw new Error('down'); } });
  const data = await good.json(); assert.equal(data.metadataAvailable, false); assert.equal(data.item.videoId, 'abcdefghijk');
});
test('Vercel rewritten API routes and HTTP method restrictions work', async () => {
  const routed = await handleRequest(request('/api?route=config'), { env: {} }); assert.equal(routed.status, 200);
  const post = await handleRequest(request('/api/config', {}, 'POST'), { env: {} }); assert.equal(post.status, 405); assert.equal(post.headers.get('Allow'), 'GET');
});
test('duration parsing and server URL validation match player expectations', () => { assert.equal(isoDuration('PT1H2M3S'), 3723); assert.equal(isoDuration('P1DT2S'), 86402); assert.equal(youtubeId('https://youtube.com.evil.test/watch?v=abcdefghijk'), ''); });
