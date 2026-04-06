export interface LiveSource {
  id: string;
  name: string;
  location: string;
  type: 'hydrophone' | 'weather-radio' | 'vlf' | 'soundscape';
  description: string;
  imageUrl?: string;
  // For HLS streams (Orcasound)
  hlsBucket?: string;
  hlsNode?: string;
  // For Icecast streams
  url?: string;
}

// All sources are TRULY LIVE — real microphones/antennas pointed at the world right now
export const LIVE_SOURCES: LiveSource[] = [
  // --- Orcasound Hydrophones (HLS via S3, CORS: *) ---
{
    id: 'orca-port-townsend',
    name: 'Port Townsend',
    location: 'Port Townsend, WA',
    type: 'hydrophone',
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
    description: 'Open mic near Lake Yamanaka, Mt Fuji — University of Tokyo Forests',
    imageUrl: '/images/yamanakako.jpg',
    url: '/proxy/cyberforest/Fuji_CyberForest.mp3',
  },
  {
    id: 'ls-zalubice',
    name: 'Summer House',
    location: 'Zalubice Nowe, Poland',
    type: 'soundscape',
    description: 'Open mic at a summer house in rural Poland',
    imageUrl: '/images/zalubice.jpg',
    url: 'https://locus.creacast.com:9443/zalubice_nowe_summer_house.mp3',
  },
  {
    id: 'ls-wave-farm',
    name: 'Pond Station',
    location: 'Wave Farm, NY',
    type: 'soundscape',
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
  if (!source.hlsBucket || !source.hlsNode) {
    throw new Error('Not an Orcasound source');
  }
  const latestUrl = `https://s3-us-west-2.amazonaws.com/${source.hlsBucket}/${source.hlsNode}/latest.txt`;
  const resp = await fetch(latestUrl);
  if (!resp.ok) throw new Error(`Failed to fetch latest.txt: ${resp.status}`);
  const timestamp = (await resp.text()).trim();
  return `https://s3-us-west-2.amazonaws.com/${source.hlsBucket}/${source.hlsNode}/hls/${timestamp}/live.m3u8`;
}
