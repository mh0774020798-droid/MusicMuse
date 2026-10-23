import { DISCOVERY_ITEMS, searchCollection } from './discovery.js';

export function searchKnownVideos(options, knownItems = [], remoteItems = []) {
  const items = [...new Map([...DISCOVERY_ITEMS, ...knownItems, ...remoteItems].filter(x => x?.source === 'youtube').map(x => [x.id, x])).values()];
  return searchCollection({ ...options, items });
}

export async function resolveMusicSearch(options, { knownItems = [], request, signal } = {}) {
  let data, failure;
  try { data = await request(options); }
  catch (error) { if (signal?.aborted) throw error; failure = error; }
  if (options.source !== 'youtube') { if (failure) throw failure; return data; }
  if (data && !['collection', 'channels'].includes(data.mode)) return data;
  const local = searchKnownVideos(options, knownItems, data?.items || []);
  if (local.total || !options.q || (options.kind && options.kind !== 'all')) return { ...local, mode: data?.mode || 'collection', channelsAvailable: data?.channelsAvailable || 0 };
  if (signal?.aborted) throw failure || new Error('Search cancelled');
  // A clearly labeled music catalog is useful when this site's video library
  // has no match. It is never presented as unrestricted YouTube search.
  return { ...await request({ ...options, source: 'itunes' }), fallback: 'catalog' };
}
