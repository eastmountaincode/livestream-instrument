// Level the measurement-only chord mix. It contains the actual filters and EQ,
// but never musical envelopes, velocity, performance volumes or automatic gain.
// Leave headroom for the fixed voice boost and the user's Master/Chord gain.
export const DEFAULT_SOURCE_LEVEL_DB = -38;
const SILENCE_DB = -90;
const MAX_BOOST_DB = 42;
const MAX_CUT_DB = -36;
const PEAK_CEILING = 0.125;

export interface SourceLevelState {
  gainDb: number;
  signalSeconds: number;
  calibrated: boolean;
}

export function createSourceLevelState(): SourceLevelState {
  return { gainDb: 0, signalSeconds: 0, calibrated: false };
}

export function updateSourceLevel(
  state: SourceLevelState,
  samples: Float32Array,
  elapsedSeconds: number,
  targetLevelDb = DEFAULT_SOURCE_LEVEL_DB,
): number {
  const dt = Math.min(1, Math.max(0, elapsedSeconds));
  if (!samples.length || !Number.isFinite(dt) || dt === 0) return 10 ** (state.gainDb / 20);
  let sum = 0;
  let power = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return 10 ** (state.gainDb / 20);
    sum += sample;
    power += sample * sample;
  }
  const mean = sum / samples.length;
  const rms = Math.sqrt(Math.max(0, power / samples.length - mean * mean));
  if (rms < 10 ** (SILENCE_DB / 20)) {
    state.signalSeconds = 0;
    return 10 ** (state.gainDb / 20);
  }
  state.signalSeconds += dt;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample - mean));
  const targetDb = Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB,
    targetLevelDb - 20 * Math.log10(rms), 20 * Math.log10(PEAK_CEILING / peak)));
  const change = targetDb - state.gainDb;
  if (state.signalSeconds >= 5 || (Math.abs(change) <= 1 && state.signalSeconds >= 1)) state.calibrated = true;
  // Do not chase small variations, short pauses, or the first isolated sound.
  if (Math.abs(change) > 0.5 || (change < 0 && peak * 10 ** (state.gainDb / 20) > PEAK_CEILING)) {
    if (change < 0 || state.signalSeconds >= 1) {
      const timeConstant = change < 0 ? 0.15 : state.calibrated ? 4 : 0.6;
      state.gainDb += change * (1 - Math.exp(-dt / timeConstant));
    }
  }
  return 10 ** (state.gainDb / 20);
}

// DC-free energy for the normal-mix reference, using the same chord meter as
// automatic leveling. Master, Keys and Chord gains are deliberately excluded.
export function sourceLevelPower(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0, power = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) return 0;
    sum += sample;
    power += sample * sample;
  }
  return Math.max(0, power / samples.length - (sum / samples.length) ** 2);
}
