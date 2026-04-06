const STORAGE_KEY = 'resonator-state';

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

function getCurrent(): SavedState {
  return load() ?? { activeStreamIds: [], streams: {}, soloId: null };
}

export function getSavedState(): SavedState | null {
  return load();
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

export function removeStreamSettings(id: string): void {
  const state = getCurrent();
  delete state.streams[id];
  save(state);
}
