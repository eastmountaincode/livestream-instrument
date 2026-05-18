import { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const EARTHCAM_TIMES_SQUARE_PAGE = 'https://www.earthcam.com/usa/newyork/timessquare/';
const EARTHCAM_REFERER = `${EARTHCAM_TIMES_SQUARE_PAGE}?cam=tsstreet`;
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36';

interface EarthCamRouteContext {
  params: Promise<{
    cam: string;
    path?: string[];
  }>;
}

interface EarthCamConfig {
  cam?: Record<string, {
    stream?: string;
  }>;
}

function readBalancedObject(source: string, startIndex: number): string {
  const start = source.indexOf('{', startIndex);
  if (start === -1) throw new Error('EarthCam config object not found');

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }

  throw new Error('EarthCam config object was incomplete');
}

async function resolveEarthCamStream(cam: string): Promise<string> {
  const pageUrl = `${EARTHCAM_TIMES_SQUARE_PAGE}?cam=${encodeURIComponent(cam)}`;
  const response = await fetch(pageUrl, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Referer': EARTHCAM_REFERER,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`EarthCam page returned ${response.status}`);
  }

  const html = await response.text();
  const markerIndex = html.indexOf('var json_base');
  if (markerIndex === -1) throw new Error('EarthCam config not found');

  const config = JSON.parse(readBalancedObject(html, markerIndex)) as EarthCamConfig;
  const stream = config.cam?.[cam]?.stream;
  if (!stream || !stream.includes('.m3u8')) {
    throw new Error(`No HLS stream found for EarthCam camera ${cam}`);
  }

  return stream;
}

function proxiedUrl(request: NextRequest, cam: string, upstreamUrl: string): string {
  const upstreamPath = new URL(upstreamUrl).pathname.toLowerCase();
  const proxyPath = upstreamPath.endsWith('.m3u8')
    ? 'proxy.m3u8'
    : upstreamPath.endsWith('.ts')
      ? 'segment.ts'
      : 'media';
  const url = new URL(`/api/earthcam-hls/${encodeURIComponent(cam)}/${proxyPath}`, request.url);
  url.searchParams.set('url', upstreamUrl);
  return url.toString();
}

function rewritePlaylist(playlist: string, upstreamUrl: string, request: NextRequest, cam: string): string {
  return playlist.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return line;

    const absoluteUrl = new URL(trimmed, upstreamUrl).toString();
    return proxiedUrl(request, cam, absoluteUrl);
  }).join('\n');
}

async function fetchEarthCamUrl(url: string): Promise<Response> {
  return fetch(url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Referer': EARTHCAM_REFERER,
      'Accept': 'application/vnd.apple.mpegurl,video/*,audio/*,*/*;q=0.8',
    },
    cache: 'no-store',
  });
}

export async function GET(request: NextRequest, context: EarthCamRouteContext) {
  const { cam } = await context.params;
  const requestedUrl = request.nextUrl.searchParams.get('url');

  try {
    const upstreamUrl = requestedUrl || await resolveEarthCamStream(cam);
    const upstreamResponse = await fetchEarthCamUrl(upstreamUrl);

    if (!upstreamResponse.ok || !upstreamResponse.body) {
      return new Response('EarthCam upstream error', { status: upstreamResponse.status });
    }

    const contentType = upstreamResponse.headers.get('Content-Type') || '';
    const isPlaylist = contentType.includes('mpegurl') || upstreamUrl.includes('.m3u8');

    if (isPlaylist) {
      const playlist = await upstreamResponse.text();
      return new Response(rewritePlaylist(playlist, upstreamUrl, request, cam), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-cache, no-store',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(upstreamResponse.body, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'video/mp2t',
        'Cache-Control': 'no-cache, no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : 'Failed to resolve EarthCam stream', { status: 502 });
  }
}
