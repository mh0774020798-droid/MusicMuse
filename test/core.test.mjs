import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeTrack, sanitizeState, mergeState, videoId, visibleTracks, moveItem, formatTime, toM3U, parseM3U, escapeHtml } from '../public/core.js';
const yt = (id = 'abcdefghijk', title = 'שיר ראשון') => normalizeTrack({ source: 'youtube', videoId: id, title, artist: 'אמן', duration: 245 });
const local = () => normalizeTrack({ source: 'local', id: 'local:a-1', title: 'מקומי', filename: 'song.wav', duration: 10 });

test('accepts real YouTube URL formats and rejects deceptive or executable URLs', () => {
  for (const url of ['https://youtu.be/abcdefghijk?t=2', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://youtube.com/shorts/abcdefghijk', 'https://m.youtube.com/live/abcdefghijk']) assert.equal(videoId(url), 'abcdefghijk');
  for (const url of ['https://youtube.com.evil.test/watch?v=abcdefghijk', 'javascript:alert(1)', 'https://youtu.be/short', 'https://youtube.com/playlist?list=abcdefghijk']) assert.equal(videoId(url), '');
});
test('imports cannot inject arbitrary media URLs or overwrite application objects', () => {
  assert.equal(normalizeTrack({ source: 'youtube', videoId: 'abcdefghijk', url: 'javascript:alert(1)', previewUrl: 'https://evil.test' }).url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(normalizeTrack({ source: 'itunes', id: 'itunes:12', url: 'https://evil.test/12' }), null);
  const item = normalizeTrack({ source: 'itunes', id: 'itunes:12', url: 'https://music.apple.com/il/song/12', previewUrl: 'https://evil.test/media', artwork: 'javascript:alert(1)' });
  assert.equal(item.previewUrl, ''); assert.equal(item.artwork, '');
  const clean = sanitizeState(JSON.parse('{"tracks":{"__proto__":{"source":"local","id":"__proto__"}},"settings":{"volume":500,"source":"malware"}}'));
  assert.equal(Object.keys(clean.tracks).length, 0); assert.equal(clean.settings.volume, 1); assert.equal(clean.settings.source, 'youtube');
});
test('backup round trip preserves saved search results, playlists, queue and resume positions', () => {
  const state = emptyState(), item = yt(); state.tracks[item.id] = item; state.saved = [item.id]; state.likes = [item.id]; state.queue = [item.id]; state.positions[item.id] = 125; state.playlists.push({ id: 'pl:one', name: 'שירים', tracks: [item.id], createdAt: 1 });
  const restored = sanitizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.tracks[item.id].title, item.title); assert.deepEqual(restored.saved, [item.id]); assert.deepEqual(restored.playlists[0].tracks, [item.id]); assert.equal(restored.positions[item.id], 125);
});
test('malformed storage and unknown references do not crash or create broken queue entries', () => {
  assert.deepEqual(sanitizeState(null), emptyState());
  const clean = sanitizeState({ tracks: { a: yt() }, saved: ['youtube:abcdefghijk', 'missing'], history: [null, { id: 'missing', at: 1 }], playlists: [{ id: 'bad', name: 'x' }], settings: { speed: 999, resume: 'yes' } });
  assert.deepEqual(clean.saved, ['youtube:abcdefghijk']); assert.equal(clean.history.length, 0); assert.equal(clean.playlists.length, 0); assert.equal(clean.settings.speed, 1); assert.equal(clean.settings.resume, true);
});
test('backup merge keeps existing files and merges playlist contents without duplicates', () => {
  const a = emptyState(), b = emptyState(), x = yt(), y = local();
  a.tracks[x.id] = x; a.saved = [x.id]; a.playlists = [{ id: 'pl:a', name: 'אוסף', tracks: [x.id], createdAt: 1 }];
  b.tracks[y.id] = y; b.tracks[x.id] = x; b.saved = [x.id, y.id]; b.playlists = [{ id: 'pl:a', name: 'אוסף', tracks: [y.id], createdAt: 1 }];
  const merged = mergeState(a, b); assert.deepEqual(merged.saved, [x.id, y.id]); assert.deepEqual(merged.playlists[0].tracks, [x.id, y.id]); assert.equal(merged.tracks[y.id].filename, 'song.wav');
});
test('queue reorder changes only the selected neighboring pair and handles boundaries', () => {
  assert.deepEqual(moveItem(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c']); assert.deepEqual(moveItem(['a', 'b'], 0, -1), ['a', 'b']); assert.deepEqual(moveItem(['a'], -1, 1), ['a']);
});
test('search within saved metadata respects hidden items and blocked artists', () => {
  const x = yt(), y = yt('lmnopqrstuv', 'שיר שני'); y.artist = 'אחר';
  assert.deepEqual(visibleTracks([x, y], { blocked: ['אמן'] }).map(x => x.id), [y.id]);
  assert.deepEqual(visibleTracks([x, y], { hidden: [y.id], query: 'ראשון' }).map(x => x.id), [x.id]);
  assert.deepEqual(visibleTracks([x, y], { query: 'לא נמצא' }), []);
});
test('M3U exports platform links and reimports only valid YouTube entries', () => {
  const text = toM3U([yt(), local()], 'אוסף\n#bad');
  assert.ok(text.startsWith('#EXTM3U\n')); assert.ok(text.includes('song.wav')); assert.equal(parseM3U(text).length, 1); assert.equal(parseM3U(text)[0].title, 'אמן - שיר ראשון');
  assert.deepEqual(parseM3U('#EXTM3U\nhttps://evil.test/music\njavascript:alert(1)'), []);
});
test('time formatting and HTML escaping cover edge cases', () => {
  assert.equal(formatTime(NaN), '0:00'); assert.equal(formatTime(3661), '1:01:01'); assert.equal(formatTime(-4), '0:00'); assert.equal(escapeHtml('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;');
});
