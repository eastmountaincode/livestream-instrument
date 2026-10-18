// Only the catalog's public audio providers may be fetched. Redirects are
// checked too: this must never become an unrestricted proxy.
const ORIGINS = new Set([
  'http://locus.creacast.com:9001',
  'https://locus.creacast.com:9443',
  'https://audio.wavefarm.org',
  'http://mp3s.nc.u-tokyo.ac.jp',
]);
const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
export function allowed(url) {
  return !url.username && !url.password && (ORIGINS.has(url.origin) ||
    (url.origin === 'https://s3-us-west-2.amazonaws.com' && url.pathname.startsWith('/audio-orcasound-net/')));
}
export default {
  async fetch(request) {
    const input = new URL(request.url);
    if (input.pathname === '/healthz') return Response.json({ ok: true, version: 1 }, { headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    let url;
    try { url = new URL(input.searchParams.get('url')); }
    catch { return new Response('Invalid url', { status: 400, headers: cors }); }
    const controller = new AbortController();
    // Limit connection establishment, never the lifetime of healthy audio.
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      for (let redirects = 0; redirects <= 3; redirects++) {
        if (!allowed(url)) return new Response('Unsupported source', { status: 403, headers: cors });
        const upstream = await fetch(url, {
          headers: { 'Accept': 'audio/*,*/*;q=0.8', 'User-Agent': 'Cicada/1.0' },
          redirect: 'manual', signal: controller.signal,
          cf: { cacheTtl: 0, cacheEverything: false },
        });
        if ([301, 302, 303, 307, 308].includes(upstream.status)) {
          await upstream.body?.cancel();
          const location = upstream.headers.get('Location');
          if (!location) break;
          url = new URL(location, url);
          continue;
        }
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel();
          console.warn(JSON.stringify({ event: 'source_unavailable', host: url.host, status: upstream.status }));
          return new Response('Source unavailable', { status: 502, headers: cors });
        }
        // Direct body passthrough preserves streaming, backpressure and client
        // cancellation without loading an endless response into memory.
        return new Response(upstream.body, { headers: {
          ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'audio/mpeg',
        } });
      }
      return new Response('Source redirect failed', { status: 502, headers: cors });
    } catch (error) {
      console.error(JSON.stringify({ event: 'source_connect_failed', host: url.host, message: String(error) }));
      return new Response('Source connection failed', { status: 502, headers: cors });
    } finally { clearTimeout(timeout); }
  },
};
