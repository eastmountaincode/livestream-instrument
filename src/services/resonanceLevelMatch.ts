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

export function resonanceListeningTrim(referenceQ: number, currentQ: number): number {
  return 10 ** ((lowResonanceTrimDb(currentQ) - lowResonanceTrimDb(referenceQ)) / 20);
}

interface PreparedBand {
  cosine: number;
  referenceAlpha: number;
  currentAlpha: number;
  gain: number;
}

// Divide the biquad numerator and denominator by exp(-iw). This is the
// same complex bandpass response, with the frequency trig shared across
// every band and both Q values instead of recalculated in the inner loop.
function responsePowers(cosine: number, sine: number, bands: PreparedBand[]): [number, number] {
  let refReal = 0, refImaginary = 0, curReal = 0, curImaginary = 0;
  for (const band of bands) {
    const delta = cosine - band.cosine;
    const reference = band.referenceAlpha * sine;
    const current = band.currentAlpha * sine;
    const refDenominator = delta * delta + reference * reference;
    const curDenominator = delta * delta + current * current;
    if (refDenominator >= 2.5e-25) {
      const scale = band.gain * reference / refDenominator;
      refReal += scale * reference;
      refImaginary += scale * delta;
    }
    if (curDenominator >= 2.5e-25) {
      const scale = band.gain * current / curDenominator;
      curReal += scale * current;
      curImaginary += scale * delta;
    }
  }
  return [refReal * refReal + refImaginary * refImaginary,
    curReal * curReal + curImaginary * curImaginary];
}

export function estimateResonanceLevelMatch(
  spectrumDb: Float32Array,
  sampleRate: number,
  bands: ResonanceBand[],
  referenceQ: number,
  currentQ: number,
  listeningTrim = true,
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
  const prepared = validBands.map(band => {
    const center = 2 * Math.PI * band.frequency / sampleRate;
    const sine = Math.sin(center);
    return { cosine: Math.cos(center), referenceAlpha: sine / (2 * referenceQ),
      currentAlpha: sine / (2 * currentQ), gain: band.gain };
  });
  let reference = 0, current = 0, previousRef = 0, previousCurrent = 0, previousFrequency = 0;
  for (const frequency of points) {
    const bin = frequency / binHz;
    const lower = Math.min(powers.length - 2, Math.floor(bin));
    const power = powers[lower] + (powers[lower + 1] - powers[lower]) * (bin - lower);
    const w = 2 * Math.PI * frequency / sampleRate;
    const [refPower, curPower] = responsePowers(Math.cos(w), Math.sin(w), prepared);
    const ref = power * refPower;
    const cur = power * curPower;
    const width = frequency - previousFrequency;
    reference += (previousRef + ref) * width / 2;
    current += (previousCurrent + cur) * width / 2;
    previousRef = ref;
    previousCurrent = cur;
    previousFrequency = frequency;
  }
  if (!Number.isFinite(reference) || !Number.isFinite(current) || reference < 1e-12 || current < 1e-12) return null;
  const listeningCorrection = listeningTrim
    ? resonanceListeningTrim(referenceQ, currentQ) : 1;
  // Limit makeup gain when the selected notes contain little input energy.
  return Math.min(8, Math.max(1 / 64, Math.sqrt(reference / current) * listeningCorrection));
}

export interface SourceResponseModel {
  power: Float64Array;
  perceivedPower: Float64Array;
}

// Compile the chord/EQ response once per setting change. Environmental changes
// then need only a dot product with the continuously monitored input spectrum.
// Extra integration points resolve passbands narrower than a single FFT bin.
export function sourceResponseModel(
  sampleRate: number, binCount: number, bands: ResonanceBand[], q: number,
  highPass: number, lowPass: number, perceptualWeights: Float32Array,
): SourceResponseModel {
  const result = { power: new Float64Array(binCount), perceivedPower: new Float64Array(binCount) };
  const binHz = sampleRate / (2 * binCount);
  const valid = bands.filter(b => b.frequency > 0 && b.frequency < sampleRate / 2 && b.gain > 0);
  const points = Array.from({ length: binCount }, (_, i) => i * binHz);
  const prepared = valid.map(b => {
    const center = 2 * Math.PI * b.frequency / sampleRate;
    const alpha = Math.sin(center) / (2 * q);
    for (const step of [-4, -2, -1, -.5, -.25, 0, .25, .5, 1, 2, 4]) {
      const f = b.frequency + b.frequency / q * step;
      if (f > 0 && f < (binCount - 1) * binHz) points.push(f);
    }
    return { cosine: Math.cos(center), referenceAlpha: alpha, currentAlpha: alpha, gain: b.gain };
  });
  points.sort((a, b) => a - b);
  // These match the engine's Q=.707 high/low-pass biquads.
  const eq = [highPass, lowPass].map(f => {
    const w = 2 * Math.PI * f / sampleRate;
    return { cosine: Math.cos(w), alpha: Math.sin(w) / (2 * .707) };
  });
  for (let i = 0; i < points.length; i++) {
    const frequency = points[i], bin = frequency / binHz;
    const lower = Math.min(binCount - 2, Math.floor(bin)), fraction = bin - lower;
    const w = 2 * Math.PI * frequency / sampleRate, cosine = Math.cos(w), sine = Math.sin(w);
    let response = responsePowers(cosine, sine, prepared)[0];
    for (let j = 0; j < eq.length; j++) {
      const filter = eq[j];
      const numerator = j === 0 ? (1 + filter.cosine) * (cosine - 1) / 2
        : (1 - filter.cosine) * (cosine + 1) / 2;
      response *= numerator ** 2 / Math.max(1e-30, (cosine - filter.cosine) ** 2 + (filter.alpha * sine) ** 2);
    }
    const width = ((points[i + 1] ?? frequency) - (points[i - 1] ?? frequency)) / (2 * binHz);
    const weight = perceptualWeights[lower] * (1 - fraction) + perceptualWeights[lower + 1] * fraction;
    result.power[lower] += response * width * (1 - fraction);
    result.power[lower + 1] += response * width * fraction;
    result.perceivedPower[lower] += response * width * (1 - fraction) * weight;
    result.perceivedPower[lower + 1] += response * width * fraction * weight;
  }
  return result;
}

export function predictSourceLevel(model: SourceResponseModel, powers: Float64Array, inputPower: number) {
  let total = 0, power = 0, perceivedPower = 0;
  for (let i = 1; i < powers.length; i++) {
    total += powers[i];
    power += powers[i] * model.power[i];
    perceivedPower += powers[i] * model.perceivedPower[i];
  }
  const scale = total > 0 ? inputPower / total : 0;
  return { power: power * scale, perceivedPower: perceivedPower * scale };
}
