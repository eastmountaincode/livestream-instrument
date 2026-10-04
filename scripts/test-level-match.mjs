import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import process from 'node:process';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';

const code = ts.transpileModule(readFileSync(new URL('../src/services/resonanceLevelMatch.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { estimateResonanceLevelMatch: estimate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const sampleRate = 48000;
const spectrum = new Float32Array(4096).fill(-40);
const bands = [130.81, 155.56, 196, 233.08, 293.66, 349.23].map(frequency => ({ frequency, gain: 1 }));
let noise = new Float32Array(sampleRate * 3);
let seed = 17;
for (let i = 0; i < noise.length; i++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  noise[i] = seed / 2147483648 * 0.05;
}

if (process.argv[2]) {
  const bytes = readFileSync(process.argv[2]);
  noise = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const ctx = new webAudioEngine.RenderingAudioContext({ sampleRate, numberOfChannels: 1 });
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, noise.length, sampleRate);
  source.buffer.copyToChannel(noise, 0);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0;
  source.connect(analyser); analyser.connect(ctx.destination); source.start();
  const power = new Float64Array(spectrum.length), frame = new Float32Array(spectrum.length);
  let count = 0;
  for (let t = 1; t < noise.length / sampleRate - 0.1; t += 0.1) {
    ctx.processTo(t); analyser.getFloatFrequencyData(frame);
    for (let i = 0; i < frame.length; i++) power[i] += 10 ** (frame[i] / 10);
    count++;
  }
  for (let i = 0; i < spectrum.length; i++) spectrum[i] = 10 * Math.log10(power[i] / count);
}

async function render(q, gain, lowPass = false, renderedBands = bands) {
  const ctx = new webAudioEngine.OfflineAudioContext(1, noise.length, sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, noise.length, sampleRate);
  source.buffer.copyToChannel(noise, 0);
  let input = source;
  if (lowPass) {
    input = ctx.createBiquadFilter(); input.type = 'lowpass'; input.frequency.value = 400; input.Q.value = 0;
    source.connect(input);
  }
  const level = ctx.createGain(); level.gain.value = gain; level.connect(ctx.destination);
  for (const band of renderedBands) {
    const filter = ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = band.frequency; filter.Q.value = q;
    input.connect(filter);
    const bandGain = ctx.createGain(); bandGain.gain.value = band.gain;
    filter.connect(bandGain); bandGain.connect(level);
  }
  source.start();
  const data = (await ctx.startRendering()).getChannelData(0).subarray(sampleRate);
  return Math.sqrt(data.reduce((sum, x) => sum + x * x, 0) / data.length);
}
for (const dark of [false, true]) {
  const currentSpectrum = spectrum.slice();
  if (dark) {
    const ctx = new webAudioEngine.OfflineAudioContext(1, 128, sampleRate);
    const lowPass = ctx.createBiquadFilter(); lowPass.type = 'lowpass'; lowPass.frequency.value = 400; lowPass.Q.value = 0;
    const frequencies = Float32Array.from(currentSpectrum, (_, i) => i * sampleRate / 8192);
    const magnitude = new Float32Array(4096), phase = new Float32Array(4096);
    lowPass.getFrequencyResponse(frequencies, magnitude, phase);
    for (let i = 0; i < currentSpectrum.length; i++) currentSpectrum[i] += 20 * Math.log10(Math.max(1e-12, magnitude[i]));
  }
  const baseline = await render(30, 1, dark);
  // Low-Q targets deliberately sit below the equal-energy reference after
  // listening feedback; the mid/high range keeps its original matching.
  for (const [q, targetDb] of [[1, -3], [5, -0.903], [10, 0], [60, 0], [100, 0]]) {
    const gain = estimate(currentSpectrum, sampleRate, bands, 30, q);
    assert.ok(gain !== null && Number.isFinite(gain));
    const measured = await render(q, gain, dark);
    const differenceDb = 20 * Math.log10(measured / baseline);
    console.log(`${dark ? 'dark' : 'broadband'} Q=${q}: correction ${gain.toFixed(3)}, difference ${differenceDb.toFixed(2)} dB`);
    assert.ok(Math.abs(differenceDb - targetDb) < 1.5, 'resonance sweep should stay within 1.5 dB of its listening target');
    const quieter = currentSpectrum.map(db => db - 30);
    assert.ok(Math.abs(estimate(quieter, sampleRate, bands, 30, q) - gain) < 1e-5, 'quieter input must not cause more makeup gain');
  }
}
assert.equal(estimate(spectrum, sampleRate, bands, 30, 30), 1, 'enabling and returning to reference must be unity');
assert.equal(estimate(spectrum, sampleRate, bands, 1, 1), 1, 'a minimum-resonance reference must also stay at unity');
assert.ok(Math.abs(estimate(spectrum, sampleRate, bands, 5, 1)
  * estimate(spectrum, sampleRate, bands, 1, 5) - 1) < 1e-6, 'low-end adjustment works in both sweep directions');
assert.equal(estimate(new Float32Array(4096).fill(-Infinity), sampleRate, bands, 30, 100), null, 'silence freezes correction');
assert.equal(estimate(spectrum, sampleRate, [], 30, 100), null, 'no notes freezes correction');
assert.ok(estimate(spectrum, sampleRate, bands, 1, 100) <= 8, 'makeup gain is capped');
console.log('Level Match checks passed: rendered sweeps, source dynamics, reference, silence, and boost cap.');

// A sustained chord in Harmonic Evidence uses up to 48 coherent bands.
// Compare the optimized complex response against actual rendered filters.
const harmonicBands = bands.flatMap(band => Array.from({ length: 8 }, (_, i) => ({
  frequency: band.frequency * (i + 1), gain: 1 / (i + 1),
})));
const harmonicBaseline = await render(30, 1, false, harmonicBands);
for (const [q, targetDb] of [[1, -3], [10, 0], [100, 0]]) {
  const correction = estimate(spectrum, sampleRate, harmonicBands, 30, q);
  const rms = await render(q, correction, false, harmonicBands);
  const db = 20 * Math.log10(rms / harmonicBaseline);
  assert.ok(Math.abs(db - targetDb) < 1.5, `48-band chord at Q=${q}: ${db} dB`);
}
console.log('48-band held chord checks passed against rendered audio.');
