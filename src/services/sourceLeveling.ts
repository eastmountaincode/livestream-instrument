// Level the measurement-only chord mix. It contains the actual filters and EQ,
// but never musical envelopes, velocity, performance volumes or automatic gain.
// Leave headroom for the fixed voice boost and the user's Master/Chord gain.
export const DEFAULT_SOURCE_LEVEL_DB = -38;
const SILENCE_DB = -90;
// Narrow chord filters can remove over 60 dB from a healthy environmental
// feed. Gate on the input signal separately instead of mistaking that for loss.
const MAX_BOOST_DB = 72;
// A quiet user mix can need far more attenuation than the old fixed target.
const MAX_CUT_DB = -120;
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
  measurement: { inputPower?: number; perceivedPower?: number; background?: boolean } = {},
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
  const inputPower = measurement.inputPower;
  const hasInputMeasurement = inputPower !== undefined;
  const inputSilent = hasInputMeasurement && (!Number.isFinite(inputPower) || inputPower < 10 ** (SILENCE_DB / 10));
  const filteredSilenceDb = hasInputMeasurement ? -120 : SILENCE_DB;
  if (inputSilent || rms < 10 ** (filteredSilenceDb / 20)) {
    state.signalSeconds = 0;
    return 10 ** (state.gainDb / 20);
  }
  state.signalSeconds += dt;
  const qualified = state.signalSeconds >= (measurement.background ? 0.4 : 1);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample - mean));
  const perceivedPower = measurement.perceivedPower;
  if (perceivedPower !== undefined && (!Number.isFinite(perceivedPower) || perceivedPower <= 0)) {
    return 10 ** (state.gainDb / 20);
  }
  const measuredRms = perceivedPower === undefined ? rms : Math.sqrt(perceivedPower);
  const targetDb = Math.max(MAX_CUT_DB, Math.min(MAX_BOOST_DB,
    targetLevelDb - 20 * Math.log10(measuredRms), 20 * Math.log10(PEAK_CEILING / peak)));
  const change = targetDb - state.gainDb;
  if (state.signalSeconds >= 5 || (Math.abs(change) <= 1 && state.signalSeconds >= 1)) state.calibrated = true;
  // Do not chase small variations, short pauses, or the first isolated sound.
  if (Math.abs(change) > 0.5 || (change < 0 && peak * 10 ** (state.gainDb / 20) > PEAK_CEILING)) {
    if (change < 0 || qualified) {
      // Background corrections are inaudible. Prepare their full correction
      // before selection instead of making quiet sources swell after a key hit.
      const timeConstant = change < 0 ? 0.15 : 0.6;
      const movement = change * (1 - Math.exp(-dt / timeConstant));
      state.gainDb = measurement.background && qualified
        ? targetDb
        : state.gainDb + (state.calibrated && change > 0 ? Math.min(6 * dt, movement) : movement);
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

// A-weighting is a useful perceptual proxy for these environmental sources,
// not a calibrated SPL/LUFS measurement. Apply it only to the level detector:
// bass remains in the audible signal and the unweighted peak guard stays intact.
// IEC 61672 response: https://thesofproject.github.io/latest/developer_guides/firmware/sound_dose.html
function aWeightResponse(frequency: number): number {
  const f2 = frequency * frequency;
  return 12194 ** 2 * f2 * f2 / ((f2 + 20.6 ** 2)
    * Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) * (f2 + 12194 ** 2));
}

export function sourceLoudnessWeights(sampleRate: number, fftSize: number): Float32Array<ArrayBuffer> {
  const reference = aWeightResponse(1000);
  return Float32Array.from({ length: fftSize / 2 }, (_, bin) =>
    (aWeightResponse(bin * sampleRate / fftSize) / reference) ** 2);
}

export function perceivedSourcePower(samples: Float32Array, spectrumDb: Float32Array, weights: Float32Array): number {
  const timePower = sourceLevelPower(samples);
  if (timePower <= 0 || spectrumDb.length !== weights.length) return 0;
  let power = 0, weightedPower = 0;
  for (let bin = 1; bin < spectrumDb.length; bin++) {
    if (!Number.isFinite(spectrumDb[bin])) continue;
    const binPower = 10 ** (spectrumDb[bin] / 10);
    power += binPower;
    weightedPower += binPower * weights[bin];
  }
  // Use the spectrum only for its weighting ratio. This keeps the time-domain
  // calibration independent of FFT window gain and browser FFT normalization.
  return power > 0 ? timePower * weightedPower / power : 0;
}

// Preserve the former fallback level for a midrange note when no normal mix
// exists to supply a listening reference. Existing sessions use their own mix.
export const DEFAULT_SOURCE_LOUDNESS_DB = DEFAULT_SOURCE_LEVEL_DB
  + 20 * Math.log10(aWeightResponse(440) / aWeightResponse(1000));
