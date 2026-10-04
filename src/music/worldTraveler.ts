import type { LiveSource } from '../services/streams';

// Keep the original eight first; new destinations never replace an offline one.
export const WORLD_TRAVELER_SOURCES = [
  { id: 'locus-jasper-ridge', label: 'California' },
  { id: 'locus-acra-wave-farm', label: 'New York' },
  { id: 'locus-london-greenwich-peninsula', label: 'London' },
  { id: 'locus-ortler-glacier', label: 'Italy' },
  { id: 'locus-zalubice-summer-house', label: 'Poland' },
  { id: 'locus-india-stream-083', label: 'India' },
  { id: 'locus-yamanakako-cyberforest', label: 'Japan' },
  { id: 'locus-jeju-georo', label: 'Korea' },
] as const;

const PLACE_LABELS: Record<string, string> = {
  'orca-port-townsend': 'Port Townsend',
  'orca-sunset-bay': 'San Juan Islands',
  'wavefarm-pond-station-daytime': 'New York Pond',
  'locus-r-urban-poplar': 'London Poplar',
  'locus-blickling-river-bure': 'Norfolk',
  'locus-zwolle-langenholte': 'Netherlands',
  'locus-zwolle-nature-reserve-langenholte': 'Netherlands Reserve',
  'locus-brno-luzanky': 'Brno',
  'locus-flucc-wien': 'Vienna',
  'locus-zurich-community-echo': 'Zurich',
  'locus-usti-nad-labem-duul': 'Ústí nad Labem',
};
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
export const TRAVELER_FIRST_NOTE = 48;
export interface TravelerSource { id: string; label: string; note: number; keyLabel: string }

export function getTravelerSources(sources: LiveSource[]): TravelerSource[] {
  const originals = new Map<string, string>(WORLD_TRAVELER_SOURCES.map(source => [source.id, source.label]));
  const byId = new Map(sources.map(source => [source.id, source]));
  const ordered = [
    ...WORLD_TRAVELER_SOURCES.flatMap(slot => byId.has(slot.id) ? [byId.get(slot.id)!] : []),
    ...sources.filter(source => !originals.has(source.id)).sort((a, b) => a.id.localeCompare(b.id)),
  ];
  return ordered.map((source, index) => {
    const note = TRAVELER_FIRST_NOTE + index;
    return {
      id: source.id,
      label: originals.get(source.id) ?? PLACE_LABELS[source.id] ?? source.location ?? source.name,
      note,
      keyLabel: `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`,
    };
  });
}
