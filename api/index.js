import { ApiError, authorize, rateLimit, getKey, validateSearch, searchMusic, checkConnections, videoInfo } from '../lib/providers.js';

export async function handleRequest(request, { env = process.env, fetcher = fetch } = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const send = (data, status = 200) => new Response(JSON.stringify(data), { status, headers });
  if (request.method !== 'GET') return new Response(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'שיטת הבקשה אינה נתמכת.' } }), { status: 405, headers: { ...headers, Allow: 'GET' } });
  try {
    authorize(request, env);
    rateLimit(request);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') === '/api' && url.searchParams.has('route') ? '/api/' + url.searchParams.get('route') : url.pathname.replace(/\/$/, '');
    const key = getKey(request, env);
    if (path === '/api/config') return send({ version: '2.0.0', youtubeConfigured: Boolean(key), accessProtected: Boolean(env.APP_ACCESS_TOKEN) });
    if (path === '/api/health') return send(await checkConnections(key, fetcher));
    if (path === '/api/search') return send(await searchMusic(validateSearch(url.searchParams), key, fetcher));
    if (path === '/api/video') return send(await videoInfo(url.searchParams.get('url') || '', fetcher));
    return send({ error: { code: 'NOT_FOUND', message: 'הכתובת אינה קיימת.' } }, 404);
  } catch (error) {
    if (error instanceof ApiError) return send({ error: { code: error.code, message: error.message } }, error.status);
    // Do not log provider URLs, client headers, or secrets.
    return send({ error: { code: 'INTERNAL_ERROR', message: 'אירעה שגיאת שרת. אפשר לנסות שוב.' } }, 500);
  }
}
export default { fetch: handleRequest };
