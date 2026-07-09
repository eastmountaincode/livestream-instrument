export interface ChordDefinition {
  label: string;
  intervals: number[];
  short: string;
}

export interface ChordSpec {
  root: number;
  type: string;
  inversion: number;
}

export interface ChordPerformanceEvent {
  id: number;
  type: 'start' | 'end';
  chord: ChordSpec;
  occurredAt: number;
  momentary: boolean;
}

export const CHORD_TYPES: Record<string, ChordDefinition> = {
  maj: { label: 'Major', intervals: [0, 4, 7], short: '' },
  min: { label: 'Minor', intervals: [0, 3, 7], short: 'm' },
  dim: { label: 'Diminished', intervals: [0, 3, 6], short: 'dim' },
  aug: { label: 'Augmented', intervals: [0, 4, 8], short: 'aug' },
  sus2: { label: 'Suspended 2nd', intervals: [0, 2, 7], short: 'sus2' },
  sus4: { label: 'Suspended 4th', intervals: [0, 5, 7], short: 'sus4' },
  '7': { label: 'Dominant 7th', intervals: [0, 4, 7, 10], short: '7' },
  maj7: { label: 'Major 7th', intervals: [0, 4, 7, 11], short: 'maj7' },
  min7: { label: 'Minor 7th', intervals: [0, 3, 7, 10], short: 'm7' },
  dim7: { label: 'Diminished 7th', intervals: [0, 3, 6, 9], short: 'dim7' },
  min7b5: { label: 'Half-Dim 7th', intervals: [0, 3, 6, 10], short: 'm7b5' },
  aug7: { label: 'Aug 7th', intervals: [0, 4, 8, 10], short: 'aug7' },
  '9': { label: 'Dominant 9th', intervals: [0, 4, 7, 10, 14], short: '9' },
  maj9: { label: 'Major 9th', intervals: [0, 4, 7, 11, 14], short: 'maj9' },
  min9: { label: 'Minor 9th', intervals: [0, 3, 7, 10, 14], short: 'm9' },
  add9: { label: 'Add 9', intervals: [0, 4, 7, 14], short: 'add9' },
  '11': { label: '11th', intervals: [0, 4, 7, 10, 14, 17], short: '11' },
  min11: { label: 'Minor 11th', intervals: [0, 3, 7, 10, 14, 17], short: 'm11' },
  '13': { label: '13th', intervals: [0, 4, 7, 10, 14, 21], short: '13' },
  '6': { label: 'Major 6th', intervals: [0, 4, 7, 9], short: '6' },
  min6: { label: 'Minor 6th', intervals: [0, 3, 7, 9], short: 'm6' },
  power: { label: 'Power (5th)', intervals: [0, 7], short: '5' },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const ROOT_NOTES = NOTE_NAMES.map((name, semitone) => ({ name, semitone }));
export const DEFAULT_CHORD: ChordSpec = { root: 5, type: 'min11', inversion: 0 };

export const CHORD_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Triads', types: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'power'] },
  { label: '7ths', types: ['7', 'maj7', 'min7', 'dim7', 'min7b5', 'aug7'] },
  { label: '9ths+', types: ['9', 'maj9', 'min9', 'add9', '11', 'min11', '13'] },
  { label: '6ths', types: ['6', 'min6'] },
];

export function clampInversion(type: string, inversion: number): number {
  const maxInversion = (CHORD_TYPES[type]?.intervals.length || 3) - 1;
  return Math.min(maxInversion, Math.max(0, Math.round(inversion)));
}

export function normalizeChordSpec(chord: Partial<ChordSpec> | null | undefined): ChordSpec {
  const type = chord?.type && CHORD_TYPES[chord.type] ? chord.type : DEFAULT_CHORD.type;
  const root = typeof chord?.root === 'number' && Number.isFinite(chord.root)
    ? Math.min(11, Math.max(0, Math.round(chord.root)))
    : DEFAULT_CHORD.root;
  const inversion = typeof chord?.inversion === 'number' && Number.isFinite(chord.inversion)
    ? clampInversion(type, chord.inversion)
    : DEFAULT_CHORD.inversion;

  return { root, type, inversion };
}

export function chordKey(root: number, type: string): string {
  return `${root}:${type}`;
}

export function getChordLabel(chord: ChordSpec): string {
  const normalized = normalizeChordSpec(chord);
  return `${NOTE_NAMES[normalized.root]}${CHORD_TYPES[normalized.type]?.short || ''}`;
}

export function buildChordNotes(chord: ChordSpec, octave = 3): number[] {
  const normalized = normalizeChordSpec(chord);
  const chordDef = CHORD_TYPES[normalized.type];
  const baseNote = (octave + 1) * 12 + normalized.root;
  const notes = chordDef.intervals.map(interval => baseNote + interval);

  for (let index = 0; index < normalized.inversion; index++) {
    notes[index] += 12;
  }

  return notes.sort((a, b) => a - b);
}
