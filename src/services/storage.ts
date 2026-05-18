const STORAGE_KEY = 'resonator-state';
const DEFAULT_MASTER_VOLUME = 0.8;
const DEFAULT_KEYBOARD_VOLUME = 1;
const DEFAULT_CHORD_PAD_VOLUME = 1;

export interface StreamSettings {
  filterQ: number;
  volume: number;
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
  return {
    activeStreamIds: Array.isArray(state?.activeStreamIds) ? state.activeStreamIds : [],
    streams: state?.streams ?? {},
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

function getCurrent(): SavedState {
  return normalizeSavedState(load());
}

export function getSavedState(): SavedState | null {
  const state = load();
  return state ? normalizeSavedState(state) : null;
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
