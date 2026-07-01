import type { StreamCandidate } from '../data/streamCandidates';

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
  proxyUrl?: string;
  pageUrl?: string;
  format?: string;
  source?: string;
}

export interface LiveSourcesResult {
  sources: LiveSource[];
  candidateCount: number;
}

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
  const streamProxyUrl = `/api/stream-preview?url=${encodeURIComponent(candidate.streamUrl)}`;

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
    url: isLatestTxtHls || isDirectHls ? undefined : candidate.streamUrl,
    proxyUrl: isLatestTxtHls || isDirectHls ? undefined : streamProxyUrl,
    pageUrl: candidate.pageUrl,
    format: candidate.format,
    source: candidate.source,
  };
}

async function readStreamCandidateError(response: Response): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    if (payload.error) return payload.error;
  } catch {
    // Fall back to the HTTP status below when the API does not return JSON.
  }

  return `Failed to load stream candidates: ${response.status}`;
}

export async function fetchAcceptedLiveSources(): Promise<LiveSourcesResult> {
  const response = await fetch('/api/stream-candidates', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(await readStreamCandidateError(response));
  }

  const payload = await response.json() as { candidates?: StreamCandidate[]; configured?: boolean };
  const sources = (payload.candidates ?? [])
    .map(candidateToLiveSource)
    .filter((source): source is LiveSource => Boolean(source));

  if (payload.configured === false) {
    throw new Error('Stream database is not configured');
  }

  return {
    sources,
    candidateCount: payload.candidates?.length ?? 0,
  };
}
