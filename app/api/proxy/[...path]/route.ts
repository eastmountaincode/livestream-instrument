import { NextRequest } from 'next/server';

const PROXY_TARGETS: Record<string, string> = {
  wavefarm: 'https://audio.wavefarm.org',
  cyberforest: 'http://mp3s.nc.u-tokyo.ac.jp',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const [target, ...rest] = path;
  const upstream = PROXY_TARGETS[target];
  if (!upstream) {
    return new Response('Unknown proxy target', { status: 404 });
  }

  const upstreamUrl = `${upstream}/${rest.join('/')}`;

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: { 'User-Agent': 'Resonator/1.0' },
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
