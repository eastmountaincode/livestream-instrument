import type { LiveSource } from '../services/streams';

// Keep the preferred destinations first; transient outages never replace a source.
export const WORLD_TRAVELER_SOURCES = [
  { id: 'locus-jasper-ridge', label: 'California' },
  { id: 'locus-acra-wave-farm', label: 'New York' },
  { id: 'locus-london-greenwich-peninsula', label: 'London' },
  { id: 'locus-ortler-glacier', label: 'Italy' },
  { id: 'locus-zalubice-summer-house', label: 'Poland' },
  { id: 'locus-santiago-maviuc', label: 'Chile' },
  { id: 'locus-yamanakako-cyberforest', label: 'Japan' },
  { id: 'locus-jeju-georo', label: 'Korea' },
] as const;

const PLACE_LABELS: Record<string, string> = {
  'orca-port-townsend': 'Washington',
  'orca-sunset-bay': 'San Juan Islands',
  'wavefarm-pond-station-daytime': 'New York Pond',
  'locus-r-urban-poplar': 'London',
  'locus-blickling-river-bure': 'Norfolk',
  'locus-zwolle-langenholte': 'Netherlands',
  'locus-zwolle-nature-reserve-langenholte': 'Netherlands Reserve',
  'locus-brno-luzanky': 'Czech Republic',
  'locus-flucc-wien': 'Vienna',
  'locus-zurich-community-echo': 'Zurich',
  'locus-usti-nad-labem-duul': 'Czech Republic',
};
const WHITE_KEY_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
const WHITE_KEY_NAMES = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
export const TRAVELER_FIRST_NOTE = 48;
const TRAVELER_SOURCE_LIMIT = 15; // The MPK's white keys, C3 through C5.
export interface TravelerSource { id: string; label: string; note: number; keyLabel: string }

export function getTravelerSources(sources: LiveSource[]): TravelerSource[] {
  const originals = new Map<string, string>(WORLD_TRAVELER_SOURCES.map(source => [source.id, source.label]));
  const byId = new Map(sources.map(source => [source.id, source]));
  const ordered = [
    ...WORLD_TRAVELER_SOURCES.flatMap(slot => byId.has(slot.id) ? [byId.get(slot.id)!] : []),
    ...sources.filter(source => !originals.has(source.id)).sort((a, b) => a.id.localeCompare(b.id)),
  ];
  return ordered.slice(0, TRAVELER_SOURCE_LIMIT).map((source, index) => {
    const keyIndex = index % WHITE_KEY_OFFSETS.length;
    const note = TRAVELER_FIRST_NOTE + Math.floor(index / WHITE_KEY_OFFSETS.length) * 12 + WHITE_KEY_OFFSETS[keyIndex];
    return {
      id: source.id,
      label: originals.get(source.id) ?? PLACE_LABELS[source.id] ?? source.location ?? source.name,
      note,
      keyLabel: `${WHITE_KEY_NAMES[keyIndex]}${Math.floor(note / 12) - 1}`,
    };
  });
}
