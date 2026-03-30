export interface LiveSource {
  id: string;
  name: string;
  location: string;
  type: 'hydrophone' | 'weather-radio' | 'vlf';
  description: string;
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
    id: 'orca-lab',
    name: 'Orcasound Lab',
    location: 'Haro Strait, WA',
    type: 'hydrophone',
    description: 'Underwater mic in orca habitat, Haro Strait',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_orcasound_lab',
  },
  {
    id: 'orca-port-townsend',
    name: 'Port Townsend',
    location: 'Port Townsend, WA',
    type: 'hydrophone',
    description: 'Hydrophone in Admiralty Inlet',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_port_townsend',
  },
  {
    id: 'orca-sunset-bay',
    name: 'Sunset Bay',
    location: 'San Juan Island, WA',
    type: 'hydrophone',
    description: 'Hydrophone near Sunset Bay',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_sunset_bay',
  },
  {
    id: 'orca-north-sjc',
    name: 'North San Juan Channel',
    location: 'San Juan Islands, WA',
    type: 'hydrophone',
    description: 'North San Juan Channel hydrophone',
    hlsBucket: 'audio-orcasound-net',
    hlsNode: 'rpi_north_sjc',
  },
  // --- Lime Kiln Hydrophone (Icecast MP3) ---
  {
    id: 'lime-kiln',
    name: 'Lime Kiln Lighthouse',
    location: 'San Juan Island, WA',
    type: 'hydrophone',
    description: 'Hydrophone at 7m depth near lighthouse, orca habitat',
    url: 'https://proxy.tpa-01.stream101.com/proxy/smrucons?mp=/;stream',
  },
  // --- NOAA Weather Radio (wxradio.org, CORS: *, truly live SDR receivers) ---
  {
    id: 'wx-monterey-marine',
    name: 'Monterey Marine',
    location: 'Monterey, CA',
    type: 'weather-radio',
    description: 'NOAA marine weather, 162.450 MHz',
    url: 'https://wxradio.org/CA-MontereyMarine-WWF64',
  },
  {
    id: 'wx-puget-sound',
    name: 'Puget Sound Marine',
    location: 'Puget Sound, WA',
    type: 'weather-radio',
    description: 'NOAA marine weather for Puget Sound',
    url: 'https://wxradio.org/WA-PugetSoundMarine-WWG24',
  },
  {
    id: 'wx-galveston',
    name: 'Galveston Coast',
    location: 'Galveston, TX',
    type: 'weather-radio',
    description: 'NOAA coastal weather',
    url: 'https://wxradio.org/TX-Galveston-KHB40',
  },
  {
    id: 'wx-atlanta',
    name: 'Atlanta Weather',
    location: 'Atlanta, GA',
    type: 'weather-radio',
    description: 'NOAA Weather Radio KEC80',
    url: 'https://wxradio.org/GA-Atlanta-KEC80',
  },
  {
    id: 'wx-pittsburgh',
    name: 'Pittsburgh Weather',
    location: 'Pittsburgh, PA',
    type: 'weather-radio',
    description: 'NOAA Weather Radio KIH35',
    url: 'https://wxradio.org/PA-Pittsburgh-KIH35',
  },
  {
    id: 'wx-dallas',
    name: 'Dallas Weather',
    location: 'Dallas, TX',
    type: 'weather-radio',
    description: 'NOAA Weather Radio KEC56',
    url: 'https://wxradio.org/TX-Dallas-KEC56',
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
