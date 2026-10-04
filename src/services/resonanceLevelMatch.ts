/** A spectral estimate of the level change caused by Q alone.
 * Both responses see the same input spectrum: source loudness, note envelopes,
 * velocity and the user's volume are never targets for normalization.
 */
export interface ResonanceBand {
  frequency: number;
  gain: number;
}

// Listening adjustment: the broadest settings still feel louder after energy
// matching. Taper an extra 3 dB of attenuation from Q=1 to zero at Q=10.
// Compare both settings so enabling Level Match never changes its reference.
function lowResonanceTrimDb(q: number): number {
  return -3 * Math.max(0, Math.min(1, 1 - Math.log10(q)));
}

function responsePower(frequency: number, bands: ResonanceBand[], q: number, sampleRate: number): number {
  const w = 2 * Math.PI * frequency / sampleRate;
  const cos = Math.cos(w), sin = Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  let real = 0, imaginary = 0;
  for (const band of bands) {
    const center = 2 * Math.PI * band.frequency / sampleRate;
    const alpha = Math.sin(center) / (2 * q);
    const a1 = -2 * Math.cos(center);
    const dr = 1 + alpha + a1 * cos + (1 - alpha) * cos2;
    const di = -a1 * sin - (1 - alpha) * sin2;
    const nr = alpha * (1 - cos2), ni = alpha * sin2;
    const denominator = dr * dr + di * di;
    if (denominator < 1e-24) continue;
    real += band.gain * (nr * dr + ni * di) / denominator;
    imaginary += band.gain * (ni * dr - nr * di) / denominator;
  }
  return real * real + imaginary * imaginary;
}

export function estimateResonanceLevelMatch(
  spectrumDb: Float32Array,
  sampleRate: number,
  bands: ResonanceBand[],
  referenceQ: number,
  currentQ: number,
): number | null {
  if (referenceQ === currentQ) return 1;
  const validBands = bands.filter(b => Number.isFinite(b.frequency) && b.frequency > 0
    && b.frequency < sampleRate / 2 && Number.isFinite(b.gain) && b.gain > 0);
  if (!validBands.length || spectrumDb.length < 2) return null;
  if (![referenceQ, currentQ, sampleRate].every(n => Number.isFinite(n) && n > 0)) return null;
  const binHz = sampleRate / (2 * spectrumDb.length);
  const powers = Array.from(spectrumDb, db => Number.isFinite(db) ? 10 ** (db / 10) : 0);
  if (Math.max(...powers) < 1e-10) return null; // Silence: retain the last correction.

  // Add samples around narrow resonances; an FFT bin can be wider than a
  // high-Q passband. Interpolate spectral power, not decibels, between bins.
  const points = Array.from({ length: powers.length }, (_, i) => i * binHz);
  for (const band of validBands) {
    for (const q of [referenceQ, currentQ]) {
      const width = band.frequency / q;
      for (const step of [-4, -2, -1, -0.5, -0.25, 0, 0.25, 0.5, 1, 2, 4]) {
        const f = band.frequency + width * step;
        if (f > 0 && f < points[powers.length - 1]) points.push(f);
      }
    }
  }
  points.sort((a, b) => a - b);
  let reference = 0, current = 0, previousRef = 0, previousCurrent = 0, previousFrequency = 0;
  for (const frequency of points) {
    const bin = frequency / binHz;
    const lower = Math.min(powers.length - 2, Math.floor(bin));
    const power = powers[lower] + (powers[lower + 1] - powers[lower]) * (bin - lower);
    const ref = power * responsePower(frequency, validBands, referenceQ, sampleRate);
    const cur = power * responsePower(frequency, validBands, currentQ, sampleRate);
    const width = frequency - previousFrequency;
    reference += (previousRef + ref) * width / 2;
    current += (previousCurrent + cur) * width / 2;
    previousRef = ref;
    previousCurrent = cur;
    previousFrequency = frequency;
  }
  if (!Number.isFinite(reference) || !Number.isFinite(current) || reference < 1e-12 || current < 1e-12) return null;
  const listeningCorrection = 10 ** ((lowResonanceTrimDb(currentQ) - lowResonanceTrimDb(referenceQ)) / 20);
  // Limit makeup gain when the selected notes contain little input energy.
  return Math.min(8, Math.max(1 / 64, Math.sqrt(reference / current) * listeningCorrection));
}
