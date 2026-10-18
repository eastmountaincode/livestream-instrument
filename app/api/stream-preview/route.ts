import { NextRequest } from 'next/server';

// The browser must follow this redirect. Proxying the response body here would
// still terminate a healthy live source when the Vercel Function expires.
export function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl) return new Response('Missing url', { status: 400 });
  try {
    const source = new URL(rawUrl);
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error('protocol');
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  const relay = new URL('https://cicada-stream-relay.andreweboylan.workers.dev/');
  relay.searchParams.set('url', rawUrl);
  return new Response(null, { status: 307, headers: {
    Location: relay.toString(), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*',
  } });
}
