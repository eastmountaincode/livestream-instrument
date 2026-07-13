import { DEFAULT_CHORD_VELOCITY, normalizeChordSpec, type ChordSpec } from '../music/chords';

const STORAGE_KEY = 'resonator-state';
const DEFAULT_MASTER_VOLUME = 1;
const DEFAULT_KEYBOARD_VOLUME = 3.2;
const DEFAULT_CHORD_PAD_VOLUME = 1.55;
const DEFAULT_HIGH_PASS_FREQ = 20;
const DEFAULT_LOW_PASS_FREQ = 20000;

export type ToneMode = 'bands' | 'spectral-snap' | 'harmonic-evidence';

export interface StreamSettings {
  filterQ: number;
  volume: number;
  highPassFreq: number;
  lowPassFreq: number;
  pan: number;
  octaveShift: number;
  muted: boolean;
}

export interface ChordPadState {
  selectedRoot: number;
  selectedType: string;
  inversion: number;
  active: boolean;
}

export type SequencerClockSource = 'internal' | 'midi';

export interface ChordSequenceEvent {
  chord: ChordSpec;
  gate: number;
  tieSteps: number;
  velocity: number;
}

export interface ChordSequencerState {
  bpm: number;
  length: number;
  clockSource: SequencerClockSource;
  steps: Array<ChordSequenceEvent | null>;
}

interface SavedState {
  activeStreamIds: string[];
  streams: Record<string, StreamSettings>;
  soloId: string | null;
  masterVolume: number;
  keyboardVolume: number;
  chordPadVolume: number;
  chordPad: ChordPadState | null;
  chordSequencer: ChordSequencerState;
  toneMode: ToneMode;
}

type StoredStateInput = Partial<Omit<SavedState, 'toneMode'>> & {
  toneMode?: unknown;
  pitchSourceMode?: unknown;
};

function load(): StoredStateInput | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(state: SavedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* quota exceeded, etc */ }
}

function normalizeToneMode(value: unknown): ToneMode {
  // Migrate the original experimental mode name on the next saved-state write.
  if (value === 'harmonic-evidence') return 'harmonic-evidence';
  return value === 'spectral-snap' || value === 'partials' ? 'spectral-snap' : 'bands';
}

function normalizeSavedState(state: StoredStateInput | null): SavedState {
  const savedMasterVolume = state?.masterVolume;
  const savedKeyboardVolume = state?.keyboardVolume;
  const savedChordPadVolume = state?.chordPadVolume;
  const savedChordPadState = state?.chordPad;
  const streams = Object.fromEntries(
    Object.entries(state?.streams ?? {}).map(([id, settings]) => [
      id,
      normalizeStreamSettings(settings && typeof settings === 'object' ? settings : {}),
    ])
  );

  return {
    activeStreamIds: Array.isArray(state?.activeStreamIds) ? state.activeStreamIds : [],
    streams,
    soloId: state?.soloId ?? null,
    masterVolume: typeof savedMasterVolume === 'number' && Number.isFinite(savedMasterVolume)
      ? savedMasterVolume
      : DEFAULT_MASTER_VOLUME,
    keyboardVolume: typeof savedKeyboardVolume === 'number' && Number.isFinite(savedKeyboardVolume)
      ? savedKeyboardVolume
      : DEFAULT_KEYBOARD_VOLUME,
    chordPadVolume: typeof savedChordPadVolume === 'number' && Number.isFinite(savedChordPadVolume)
      ? savedChordPadVolume
      : DEFAULT_CHORD_PAD_VOLUME,
    chordPad: savedChordPadState && typeof savedChordPadState === 'object'
      ? normalizeChordPadState(savedChordPadState)
      : null,
    chordSequencer: normalizeChordSequencerState(state?.chordSequencer),
    toneMode: normalizeToneMode(state?.toneMode ?? state?.pitchSourceMode),
  };
}

function normalizeStreamSettings(settings: Partial<StreamSettings>): StreamSettings {
  return {
    filterQ: typeof settings.filterQ === 'number' && Number.isFinite(settings.filterQ) ? settings.filterQ : 30,
    volume: typeof settings.volume === 'number' && Number.isFinite(settings.volume) ? settings.volume : 0.8,
    highPassFreq: typeof settings.highPassFreq === 'number' && Number.isFinite(settings.highPassFreq) ? settings.highPassFreq : DEFAULT_HIGH_PASS_FREQ,
    lowPassFreq: typeof settings.lowPassFreq === 'number' && Number.isFinite(settings.lowPassFreq) ? settings.lowPassFreq : DEFAULT_LOW_PASS_FREQ,
    pan: typeof settings.pan === 'number' && Number.isFinite(settings.pan) ? settings.pan : 0,
    octaveShift: typeof settings.octaveShift === 'number' && Number.isFinite(settings.octaveShift) ? settings.octaveShift : 0,
    muted: typeof settings.muted === 'boolean' ? settings.muted : false,
  };
}

function normalizeChordPadState(state: Partial<ChordPadState>): ChordPadState {
  const selectedRoot = typeof state.selectedRoot === 'number' && Number.isFinite(state.selectedRoot)
    ? Math.min(11, Math.max(0, Math.round(state.selectedRoot)))
    : 5;
  const selectedType = typeof state.selectedType === 'string' && state.selectedType.trim()
    ? state.selectedType
    : 'min11';
  const inversion = typeof state.inversion === 'number' && Number.isFinite(state.inversion)
    ? Math.max(0, Math.round(state.inversion))
    : 0;

  return {
    selectedRoot,
    selectedType,
    inversion,
    active: state.active === true,
  };
}

function normalizeChordSequenceEvent(value: unknown): ChordSequenceEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<ChordSequenceEvent>;
  if (!event.chord || typeof event.chord !== 'object') return null;

  return {
    chord: normalizeChordSpec(event.chord),
    gate: typeof event.gate === 'number' && Number.isFinite(event.gate)
      ? Math.min(0.99, Math.max(0.05, event.gate))
      : 0.5,
    tieSteps: typeof event.tieSteps === 'number' && Number.isFinite(event.tieSteps)
      ? Math.min(63, Math.max(0, Math.round(event.tieSteps)))
      : 0,
    velocity: typeof event.velocity === 'number' && Number.isFinite(event.velocity)
      ? Math.min(127, Math.max(1, Math.round(event.velocity)))
      : DEFAULT_CHORD_VELOCITY,
  };
}

function normalizeChordSequencerState(state: Partial<ChordSequencerState> | null | undefined): ChordSequencerState {
  const sourceSteps = Array.isArray(state?.steps) ? state.steps : [];
  const steps = Array.from({ length: 64 }, (_, index) => normalizeChordSequenceEvent(sourceSteps[index]));

  return {
    bpm: typeof state?.bpm === 'number' && Number.isFinite(state.bpm)
      ? Math.min(300, Math.max(30, state.bpm))
      : 120,
    length: typeof state?.length === 'number' && Number.isFinite(state.length)
      ? Math.min(64, Math.max(1, Math.round(state.length)))
      : 16,
    clockSource: state?.clockSource === 'midi' ? 'midi' : 'internal',
    steps,
  };
}

function getCurrent(): SavedState {
  return normalizeSavedState(load());
}

export function getSavedState(): SavedState | null {
  const state = load();
  return state ? normalizeSavedState(state) : null;
}

export function clearSavedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable */ }
}

export function saveActiveStreams(ids: string[]): void {
  const state = getCurrent();
  state.activeStreamIds = ids;
  save(state);
}

export function saveStreamSettings(id: string, settings: StreamSettings): void {
  const state = getCurrent();
  state.streams[id] = settings;
  save(state);
}

export function getStreamSettings(id: string): StreamSettings | null {
  return getCurrent().streams[id] ?? null;
}

export function saveSoloId(soloId: string | null): void {
  const state = getCurrent();
  state.soloId = soloId;
  save(state);
}

export function saveMasterVolume(masterVolume: number): void {
  const state = getCurrent();
  state.masterVolume = masterVolume;
  save(state);
}

export function getMasterVolume(): number {
  return getCurrent().masterVolume;
}

export function saveKeyboardVolume(keyboardVolume: number): void {
  const state = getCurrent();
  state.keyboardVolume = keyboardVolume;
  save(state);
}

export function getKeyboardVolume(): number {
  return getCurrent().keyboardVolume;
}

export function saveChordPadVolume(chordPadVolume: number): void {
  const state = getCurrent();
  state.chordPadVolume = chordPadVolume;
  save(state);
}

export function getChordPadVolume(): number {
  return getCurrent().chordPadVolume;
}

export function saveChordPadState(chordPad: ChordPadState): void {
  const state = getCurrent();
  state.chordPad = normalizeChordPadState(chordPad);
  save(state);
}

export function getChordPadState(): ChordPadState | null {
  return getCurrent().chordPad;
}

export function saveChordSequencerState(chordSequencer: ChordSequencerState): void {
  const state = getCurrent();
  state.chordSequencer = normalizeChordSequencerState(chordSequencer);
  save(state);
}

export function getChordSequencerState(): ChordSequencerState {
  return getCurrent().chordSequencer;
}

export function saveToneMode(toneMode: ToneMode): void {
  const state = getCurrent();
  state.toneMode = toneMode === 'spectral-snap' || toneMode === 'harmonic-evidence'
    ? toneMode
    : 'bands';
  save(state);
}

export function getToneMode(): ToneMode {
  return getCurrent().toneMode;
}

export function removeStreamSettings(id: string): void {
  const state = getCurrent();
  delete state.streams[id];
  save(state);
}
