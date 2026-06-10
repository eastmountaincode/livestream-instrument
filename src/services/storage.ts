const STORAGE_KEY = 'resonator-state';
const DEFAULT_MASTER_VOLUME = 1;
const DEFAULT_KEYBOARD_VOLUME = 3.2;
const DEFAULT_CHORD_PAD_VOLUME = 1.55;
const DEFAULT_HIGH_PASS_FREQ = 20;
const DEFAULT_LOW_PASS_FREQ = 20000;

export interface StreamSettings {
  filterQ: number;
  volume: number;
  highPassFreq: number;
  lowPassFreq: number;
  pan: number;
  octaveShift: number;
  muted: boolean;
}

interface SavedState {
  activeStreamIds: string[];
  streams: Record<string, StreamSettings>;
  soloId: string | null;
  masterVolume: number;
  keyboardVolume: number;
  chordPadVolume: number;
}

function load(): SavedState | null {
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

function normalizeSavedState(state: Partial<SavedState> | null): SavedState {
  const savedMasterVolume = state?.masterVolume;
  const savedKeyboardVolume = state?.keyboardVolume;
  const savedChordPadVolume = state?.chordPadVolume;
  const streams = Object.fromEntries(
    Object.entries(state?.streams ?? {}).map(([id, settings]) => [id, normalizeStreamSettings(settings)])
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

export function removeStreamSettings(id: string): void {
  const state = getCurrent();
  delete state.streams[id];
  save(state);
}
