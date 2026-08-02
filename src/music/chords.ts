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
export const DEFAULT_CHORD_VELOCITY = 100;

export const CHORD_GROUPS: { label: string; types: string[] }[] = [
  { label: 'Triads', types: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4', 'power'] },
  { label: '7ths', types: ['7', 'maj7', 'min7', 'dim7', 'min7b5', 'aug7'] },
  { label: '9ths+', types: ['9', 'maj9', 'min9', 'add9', '11', 'min11', '13'] },
  { label: '6ths', types: ['6', 'min6'] },
];

const MINOR_TONIC_TYPES = new Set(['min', 'min6', 'min7', 'min9', 'min11']);

interface ChordBankPalette {
  major: string;
  minor: string;
}

interface ChordBankRule {
  rootOffset: number;
  type: string;
  inversion?: number;
}

function wrapRoot(root: number): number {
  return ((root % 12) + 12) % 12;
}

function getChordBankPalette(type: string): ChordBankPalette {
  switch (type) {
    case 'min11':
      return { major: 'maj9', minor: 'min11' };
    case 'min9':
      return { major: 'maj9', minor: 'min9' };
    case 'min7':
      return { major: 'maj7', minor: 'min7' };
    case 'min6':
      return { major: '6', minor: 'min6' };
    case 'min':
      return { major: 'maj', minor: 'min' };
    case 'maj9':
    case 'add9':
      return { major: 'maj9', minor: 'min11' };
    case 'maj7':
      return { major: 'maj7', minor: 'min7' };
    case '6':
      return { major: '6', minor: 'min6' };
    case '13':
      return { major: 'maj9', minor: 'min9' };
    case '11':
      return { major: 'maj9', minor: 'min11' };
    case '9':
      return { major: 'maj9', minor: 'min9' };
    case '7':
      return { major: 'maj7', minor: 'min7' };
    default:
      return { major: 'maj', minor: 'min' };
  }
}

export function buildRelatedChordBank(chord: ChordSpec): ChordSpec[] {
  const current = normalizeChordSpec(chord);
  const palette = getChordBankPalette(current.type);
  const minorContext = MINOR_TONIC_TYPES.has(current.type);
  const colorRules: ChordBankRule[] = [
    { rootOffset: 1, type: 'maj9' },
    { rootOffset: 2, type: 'min11' },
    { rootOffset: 3, type: 'min11' },
    { rootOffset: 10, type: 'min11' },
    { rootOffset: 10, type: 'maj9' },
  ];
  const contextualRules: ChordBankRule[] = minorContext
    ? [
        { rootOffset: 5, type: palette.minor },
        { rootOffset: 7, type: palette.minor },
      ]
    : [
        { rootOffset: 4, type: palette.minor },
        { rootOffset: 11, type: palette.minor },
      ];
  const templates = [
    { rootOffset: 0, type: current.type },
    ...colorRules,
    ...contextualRules,
  ];

  return templates.map(({ rootOffset, type, inversion }, index) => normalizeChordSpec({
    root: wrapRoot(current.root + rootOffset),
    type,
    inversion: index === 0 ? current.inversion : inversion ?? 0,
  }));
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
