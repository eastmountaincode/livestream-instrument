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
  // Diatonic extensions used by generated banks. Keep stable type IDs so banks,
  // selected chords, and recorded sequences restore without losing their notes.
  min7b9: { label: 'Minor 7th, flat 9', intervals: [0, 3, 7, 10, 13], short: 'm7(b9)' },
  min7b5b9: { label: 'Half-Dim 7th, flat 9', intervals: [0, 3, 6, 10, 13], short: 'm7b5(b9)' },
  maj11: { label: 'Major 11th', intervals: [0, 4, 7, 11, 14, 17], short: 'maj11' },
  min11b9: { label: 'Minor 11th, flat 9', intervals: [0, 3, 7, 10, 13, 17], short: 'm11(b9)' },
  maj9sharp11: { label: 'Major 9th, sharp 11', intervals: [0, 4, 7, 11, 14, 18], short: 'maj9(#11)' },
  min11b5b9: { label: 'Minor 11th, flat 5 and flat 9', intervals: [0, 3, 6, 10, 13, 17], short: 'm11(b5,b9)' },
  maj13: { label: 'Major 13th', intervals: [0, 4, 7, 11, 14, 21], short: 'maj13' },
  min13: { label: 'Minor 13th', intervals: [0, 3, 7, 10, 14, 21], short: 'm13' },
  min9b13: { label: 'Minor 9th, flat 13', intervals: [0, 3, 7, 10, 14, 20], short: 'm9(b13)' },
  min7b9b13: { label: 'Minor 7th, flat 9 and flat 13', intervals: [0, 3, 7, 10, 13, 20], short: 'm7(b9,b13)' },
  min7b5b9b13: { label: 'Half-Dim 7th, flat 9 and flat 13', intervals: [0, 3, 6, 10, 13, 20], short: 'm7b5(b9,b13)' },
  minAdd9: { label: 'Minor, add 9', intervals: [0, 3, 7, 14], short: 'm(add9)' },
  minAddb9: { label: 'Minor, add flat 9', intervals: [0, 3, 7, 13], short: 'm(addb9)' },
  dimAddb9: { label: 'Diminished, add flat 9', intervals: [0, 3, 6, 13], short: 'dim(addb9)' },
  minAddb6: { label: 'Minor, add flat 6', intervals: [0, 3, 7, 8], short: 'm(addb6)' },
  dimAddb6: { label: 'Diminished, add flat 6', intervals: [0, 3, 6, 8], short: 'dim(addb6)' },
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const ROOT_NOTES = NOTE_NAMES.map((name, semitone) => ({ name, semitone }));
export const DEFAULT_CHORD: ChordSpec = { root: 5, type: 'min11', inversion: 0 };
export const DEFAULT_CHORD_VELOCITY = 100;

export const CHORD_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Triads', types: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'power'] },
  { label: '7ths', types: ['7', 'maj7', 'min7', 'dim7', 'min7b5', 'aug7'] },
  { label: '9ths+', types: ['9', 'maj9', 'min9', 'add9', '11', 'min11', '13'] },
  { label: '6ths', types: ['6', 'min6'] },
];

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
// Each row follows I–vii in major. Natural minor starts on the sixth degree
// of its relative major, so the same voicings rotate by five positions.
const DIATONIC_PALETTES = {
  triad: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
  seventh: ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'min7b5'],
  ninth: ['maj9', 'min9', 'min7b9', 'maj9', '9', 'min9', 'min7b5b9'],
  eleventh: ['maj11', 'min11', 'min11b9', 'maj9sharp11', '11', 'min11', 'min11b5b9'],
  // Match the existing 13th voicing: 1, 3, 5, 7, 9, 13 (no 11th).
  thirteenth: ['maj13', 'min13', 'min7b9b13', 'maj13', '13', 'min9b13', 'min7b5b9b13'],
  sixth: ['6', 'min6', 'minAddb6', '6', '6', 'minAddb6', 'dimAddb6'],
  addNinth: ['add9', 'minAdd9', 'minAddb9', 'add9', 'add9', 'minAdd9', 'dimAddb9'],
};

function getDiatonicPalette(type: string): string[] {
  const intervals = CHORD_TYPES[type].intervals;
  const highest = Math.max(...intervals);
  if (highest >= 20) return DIATONIC_PALETTES.thirteenth;
  if (highest >= 17) return DIATONIC_PALETTES.eleventh;
  if (highest >= 13) return intervals.length === 4 ? DIATONIC_PALETTES.addNinth : DIATONIC_PALETTES.ninth;
  if (highest >= 10 || type === 'dim7') return DIATONIC_PALETTES.seventh;
  if (intervals.length === 4) return DIATONIC_PALETTES.sixth;
  return DIATONIC_PALETTES.triad;
}

export function buildRelatedChordBank(chord: ChordSpec): ChordSpec[] {
  const current = normalizeChordSpec(chord);
  // A chord alone cannot identify a unique key. Treat its root as the tonic;
  // minor-family chords use natural minor, and other qualities use major.
  const intervals = CHORD_TYPES[current.type].intervals;
  const minorContext = intervals[1] === 3 && intervals[2] === 7;
  const scale = minorContext ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  const palette = getDiatonicPalette(current.type);
  const bank = scale.map((offset, degree) => degree === 0
    ? { ...current }
    : { root: (current.root + offset) % 12, type: palette[(degree + (minorContext ? 5 : 0)) % 7], inversion: 0 });

  // Keep the chosen color/voicing on I (or i), and use the eighth hardware pad
  // as a return to that same tonic rather than adding an unrelated chord.
  return [...bank, { ...current }];
}

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

export function scaleChordVelocity(velocity: number, inputVolume: number): number {
  const safeVelocity = Number.isFinite(velocity) ? Math.max(0, velocity) : 0;
  const safeInputVolume = Number.isFinite(inputVolume) ? Math.max(0, inputVolume) : 0;
  return Math.round(safeVelocity * safeInputVolume);
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
