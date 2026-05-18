import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

function isAllowedProtocol(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get('url');
  if (!rawUrl) {
    return new Response('Missing url', { status: 400 });
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(rawUrl);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }

  if (!isAllowedProtocol(upstreamUrl)) {
    return new Response('Unsupported protocol', { status: 400 });
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      'User-Agent': 'Resonator/1.0',
      'Accept': 'audio/*,*/*;q=0.8',
    },
    cache: 'no-store',
  });

  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return new Response('Upstream error', { status: upstreamResponse.status });
  }

  return new Response(upstreamResponse.body, {
    status: 200,
    headers: {
      'Content-Type': upstreamResponse.headers.get('Content-Type') || 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
