import type { StreamCandidate } from '../data/streamCandidates';

const LIVE_SOURCES_CACHE_KEY = 'resonator-live-sources-cache';

export interface LiveSource {
  id: string;
  name: string;
  location: string;
  type: string;
  category: string;
  description: string;
  timeZone?: string;
  imageUrl?: string;
  // For HLS streams (Orcasound)
  hlsBucket?: string;
  hlsNode?: string;
  latestTxtUrl?: string;
  hlsUrl?: string;
  // For Icecast streams
  url?: string;
  pageUrl?: string;
  format?: string;
  source?: string;
}

export interface LiveSourcesResult {
  sources: LiveSource[];
  configured: boolean;
  candidateCount: number;
  fromCache: boolean;
}

// All sources are TRULY LIVE — real microphones/antennas pointed at the world right now
export const LIVE_SOURCES: LiveSource[] = [
  // --- Orcasound Hydrophones (HLS via S3, CORS: *) ---
{
    id: 'orca-port-townsend',
    name: 'Port Townsend',
    location: 'Port Townsend, WA',
    type: 'hydrophone',
    category: 'underwater microphone',
    description: 'Hydrophone in Admiralty Inlet',
    imageUrl: 'https://s3-us-west-2.amazonaws.com/orcasite/rpi_port_townsend/thumbnail.png',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_port_townsend',
  },
  {
    id: 'orca-sunset-bay',
    name: 'Sunset Bay',
    location: 'San Juan Island, WA',
    type: 'hydrophone',
    category: 'underwater microphone',
    description: 'Hydrophone near Sunset Bay',
    imageUrl: 'https://s3-us-west-2.amazonaws.com/orcasite/rpi_sunset_bay/thumbnail.png',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_sunset_bay',
  },
  {
    id: 'orca-north-sjc',
    name: 'North San Juan Channel',
    location: 'San Juan Islands, WA',
    type: 'hydrophone',
    category: 'underwater microphone',
    description: 'North San Juan Channel hydrophone',
    imageUrl: 'https://s3-us-west-2.amazonaws.com/orcasite/rpi_north_sjc/thumbnail.png',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_north_sjc',
  },
  {
    id: 'orca-andrews-bay',
    name: 'Andrews Bay',
    location: 'San Juan Island, WA',
    type: 'hydrophone',
    category: 'underwater microphone',
    description: 'Hydrophone near San Juan County Park, between Orcasound Lab and Lime Kiln',
    imageUrl: '/images/andrews-bay.jpg',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_andrews_bay',
  },
  // --- Locustream Soundscapes (Icecast via locusonus/creacast) ---
  {
    id: 'ls-yamanakako',
    name: 'Yamanakako',
    location: 'Yamanashi, Japan',
    type: 'soundscape',
    category: 'nature',
    description: 'Open mic near Lake Yamanaka, Mt Fuji — University of Tokyo Forests',
    imageUrl: '/images/yamanakako.jpg',
    url: '/proxy/cyberforest/Fuji_CyberForest.mp3',
  },
  {
    id: 'ls-zalubice',
    name: 'Summer House',
    location: 'Zalubice Nowe, Poland',
    type: 'soundscape',
    category: 'nature',
    description: 'Open mic at a summer house in rural Poland',
    imageUrl: '/images/zalubice.jpg',
    url: 'https://locus.creacast.com:9443/zalubice_nowe_summer_house.mp3',
  },
  {
    id: 'ls-wave-farm',
    name: 'Pond Station',
    location: 'Wave Farm, NY',
    type: 'soundscape',
    category: 'nature',
    description: 'Pond station at Wave Farm, upstate New York',
    imageUrl: '/images/wave-farm.jpg',
    url: '/proxy/wavefarm/pondstation.mp3',
  },
];

/**
 * Fetch current HLS stream URL for an Orcasound node.
 * Their system writes a `latest.txt` with a timestamp, which is the current stream directory.
 */
export async function getOrcasoundStreamUrl(source: LiveSource): Promise<string> {
  if (source.latestTxtUrl) {
    const resp = await fetch(`/api/stream-preview?url=${encodeURIComponent(source.latestTxtUrl)}`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`Failed to fetch latest.txt: ${resp.status}`);
    const timestamp = (await resp.text()).trim();
    const baseUrl = source.latestTxtUrl.replace(/\/latest\.txt(?:\?.*)?$/, '');
    return `${baseUrl}/hls/${timestamp}/live.m3u8`;
  }

  if (!source.hlsBucket || !source.hlsNode) {
    throw new Error('Not an Orcasound source');
  }
  const latestUrl = `https://s3-us-west-2.amazonaws.com/${source.hlsBucket}/${source.hlsNode}/latest.txt`;
  const resp = await fetch(latestUrl);
  if (!resp.ok) throw new Error(`Failed to fetch latest.txt: ${resp.status}`);
  const timestamp = (await resp.text()).trim();
  return `https://s3-us-west-2.amazonaws.com/${source.hlsBucket}/${source.hlsNode}/hls/${timestamp}/live.m3u8`;
}

function sourceTypeFromCategory(category: string): string {
  const normalized = category.toLowerCase();
  if (normalized.includes('underwater') || normalized.includes('hydrophone')) return 'hydrophone';
  if (normalized.includes('weather')) return 'weather-radio';
  if (normalized.includes('vlf')) return 'vlf';
  return 'soundscape';
}

export function candidateToLiveSource(candidate: StreamCandidate): LiveSource | null {
  if (candidate.status !== 'accepted' || !candidate.streamUrl.trim()) return null;

  const isLatestTxtHls = candidate.format.toLowerCase().includes('hls via latest.txt');
  const isDirectHls = !isLatestTxtHls && (
    candidate.streamUrl.includes('.m3u8') ||
    candidate.format.toLowerCase().includes('hls')
  );
  return {
    id: candidate.id,
    name: candidate.name,
    location: candidate.location,
    type: sourceTypeFromCategory(candidate.category),
    category: candidate.category || 'uncategorized',
    description: candidate.notes || candidate.source || candidate.format,
    timeZone: candidate.timeZone,
    latestTxtUrl: isLatestTxtHls ? candidate.streamUrl : undefined,
    hlsUrl: isDirectHls ? candidate.streamUrl : undefined,
    url: isLatestTxtHls || isDirectHls ? undefined : `/api/stream-preview?url=${encodeURIComponent(candidate.streamUrl)}`,
    pageUrl: candidate.pageUrl,
    format: candidate.format,
    source: candidate.source,
  };
}

function readCachedLiveSources(): LiveSource[] {
  try {
    const raw = localStorage.getItem(LIVE_SOURCES_CACHE_KEY);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCachedLiveSources(sources: LiveSource[]): void {
  if (!sources.length) return;

  try {
    localStorage.setItem(LIVE_SOURCES_CACHE_KEY, JSON.stringify(sources));
  } catch {
    // Ignore quota/private-mode failures; live source loading still works without the cache.
  }
}

export async function fetchAcceptedLiveSources(): Promise<LiveSourcesResult> {
  const cachedSources = readCachedLiveSources();
  const response = await fetch('/api/stream-candidates', { cache: 'no-store' });
  if (!response.ok) {
    if (cachedSources.length) {
      return {
        sources: cachedSources,
        configured: false,
        candidateCount: 0,
        fromCache: true,
      };
    }

    throw new Error(`Failed to load stream candidates: ${response.status}`);
  }

  const payload = await response.json() as { candidates?: StreamCandidate[]; configured?: boolean };
  const sources = (payload.candidates ?? [])
    .map(candidateToLiveSource)
    .filter((source): source is LiveSource => Boolean(source));

  if (payload.configured !== false && sources.length) {
    saveCachedLiveSources(sources);
  }

  if (payload.configured === false && cachedSources.length > sources.length) {
    return {
      sources: cachedSources,
      configured: false,
      candidateCount: payload.candidates?.length ?? 0,
      fromCache: true,
    };
  }

  return {
    sources,
    configured: payload.configured !== false,
    candidateCount: payload.candidates?.length ?? 0,
    fromCache: false,
  };
}
