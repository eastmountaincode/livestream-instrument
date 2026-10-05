import assert from 'node:assert/strict';
import console from 'node:console';
import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';

const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const levelModule = url(compile('../src/services/sourceLeveling.ts'));
const { createSourceLevelState, updateSourceLevel, sourceLoudnessWeights, perceivedSourcePower } = await import(levelModule);
const samples = amplitude => Float32Array.from({ length: 2048 }, (_, i) => amplitude * Math.sin(2 * Math.PI * i / 64));
const db = gain => 20 * Math.log10(gain);
function settle(amplitude, seconds = 24) {
  const state = createSourceLevelState();
  let gain = 1;
  for (let t = 0; t < seconds; t += .2) gain = updateSourceLevel(state, samples(amplitude), .2);
  return { state, gain, rms: amplitude / Math.SQRT2 * gain };
}
const quiet = settle(.02), loud = settle(.2);
assert.ok(Math.abs(db(quiet.rms / loud.rms)) < 1.2, 'feeds 20 dB apart converge without individual faders');
assert.ok(Math.abs(db(loud.rms) + 38) < 1.1, 'steady source approaches the target baseline');
const quietTarget = createSourceLevelState();
for (let i = 0; i < 120; i++) updateSourceLevel(quietTarget, samples(.2), .2, -80);
assert.ok(Math.abs(db(.2 / Math.SQRT2) + quietTarget.gainDb + 80) < .6,
  'loud sources can attenuate far enough to match a quiet normal-mix reference');
const frozen = quiet.state.gainDb;
for (let i = 0; i < 100; i++) updateSourceLevel(quiet.state, samples(0), .2);
assert.equal(quiet.state.gainDb, frozen, 'dropouts never increase gain');
updateSourceLevel(quiet.state, samples(.0011), .2);
assert.equal(quiet.state.gainDb, frozen, 'an isolated sound after silence cannot trigger boost');
assert.equal(settle(.00001).gain, 1, 'sub-threshold hiss is not boosted');
assert.ok(settle(.00011).gain <= 10 ** (72 / 20), 'quiet feeds have a finite boost ceiling');
const dcState = createSourceLevelState();
updateSourceLevel(dcState, new Float32Array(2048).fill(.4), .2);
assert.equal(dcState.gainDb, 0, 'DC offset is not treated as useful signal');
updateSourceLevel(dcState, new Float32Array([NaN, Infinity]), .2);
assert.equal(dcState.gainDb, 0, 'invalid samples cannot poison gain');
const gust = settle(.02);
for (let i = 0; i < 3; i++) updateSourceLevel(gust.state, samples(.8), .2);
assert.ok(db(.8 / Math.SQRT2) + gust.state.gainDb < -23, 'a loud gust is reduced within 600 ms');
const beforeRecovery = gust.state.gainDb;
updateSourceLevel(gust.state, samples(.02), .2);
assert.ok(gust.state.gainDb - beforeRecovery < 2, 'gain recovers slowly instead of pumping');
// Healthy streams may have extremely little energy inside a narrow chord.
// The input gate must distinguish those from actual silence/disconnection.
const narrow = createSourceLevelState();
for (let i = 0; i < 30; i++) updateSourceLevel(narrow, samples(.00001), .2, -38, { inputPower: .001, background: true });
assert.ok(Math.abs(db(.00001 / Math.SQRT2) + narrow.gainDb + 38) < .6,
  'quiet extracted chords reach the target when the original feed is healthy');
assert.ok(narrow.gainDb > 60 && narrow.gainDb <= 72, 'narrow-band makeup is sufficient but bounded');
const held = narrow.gainDb;
for (let i = 0; i < 50; i++) updateSourceLevel(narrow, samples(.000002), .2, -38, { inputPower: 0, background: true });
assert.equal(narrow.gainDb, held, 'a missing raw input cannot cause background makeup gain');
assert.equal(narrow.signalSeconds, 0, 'dropouts require fresh input qualification');
for (let i = 0; i < 3; i++) updateSourceLevel(narrow, samples(.8), .2, -38, { inputPower: .3 });
assert.ok(db(.8 / Math.SQRT2) + narrow.gainDb < -23, 'a sudden loud return is cut even after large makeup');
// Frequency weighting must reduce bass influence without weakening peak safety.
const weights = sourceLoudnessWeights(48000, 48000);
assert.ok(Math.abs(10 * Math.log10(weights[100]) + 19.1) < .2, '100 Hz has the expected perceptual attenuation');
assert.ok(Math.abs(weights[1000] - 1) < .001, '1 kHz remains the calibration reference');
const brightSpectrum = new Float32Array(24000).fill(-Infinity); brightSpectrum[1000] = -20;
assert.ok(Math.abs(perceivedSourcePower(samples(.1), brightSpectrum, weights) - .005) < .00001);
const bassSpectrum = new Float32Array(24000).fill(-Infinity); bassSpectrum[100] = -20;
assert.ok(perceivedSourcePower(samples(.1), bassSpectrum, weights) < .00007,
  'bass-heavy and midrange sources with equal RMS no longer look equally loud');
const weightedPeak = createSourceLevelState();
for (let i=0;i<100;i++) updateSourceLevel(weightedPeak, samples(.8), .2, -38,
  { inputPower: .1, perceivedPower: 1e-12, background: true });
assert.ok(.8 * 10 ** (weightedPeak.gainDb / 20) <= .12501,
  'perceptual weighting cannot hide large unweighted peaks from the safety limit');
console.log('Source level policy passed: baseline matching, fast attenuation, slow recovery, silence/DC/invalid data, and boost cap.');

const output = url(compile('../src/services/audioOutput.ts'));
const router = url(compile('../src/services/audioOutputRouter.ts').replace('"./audioOutput"', JSON.stringify(output)));
const resonance = url(compile('../src/services/resonanceLevelMatch.ts'));
const { AudioEngine } = await import(url(compile('../src/services/AudioEngine.ts')
  .replace('"./audioOutputRouter"', JSON.stringify(router))
  .replace("'./resonanceLevelMatch'", JSON.stringify(resonance))
  .replace("'./sourceLeveling'", JSON.stringify(levelModule))));
class TestContext extends webAudioEngine.RenderingAudioContext {
  constructor() { super({ sampleRate: 48000, numberOfChannels: 2 }); }
  createAnalyser() {
    const analyser = super.createAnalyser();
    const read = analyser.getFloatFrequencyData.bind(analyser);
    analyser.getFloatFrequencyData = bins => {
      read(bins);
      // web-audio-engine reports exact FFT zeros as 0 dB, unlike browsers'
      // -Infinity. All fixture inputs are sub-unity; these are silence bins.
      for (let i=0;i<bins.length;i++) if (bins[i] === 0) bins[i] = -Infinity;
    };
    return analyser;
  }
  createMediaElementSource(element) {
    element.paused ??= false;
    element.readyState ??= 4;
    const source = this.createBufferSource();
    source.buffer = this.createBuffer(1, 48000, 48000);
    const data = source.buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = element.amplitude * Math.sin(2 * Math.PI * (element.frequency ?? 440) * i / 48000 + (element.phase ?? 0))
      + (element.rumble ?? 0) * Math.sin(2 * Math.PI * 20 * i / 48000);
    source.loop = true; source.start(); return source;
  }
}
globalThis.AudioContext = TestContext;
const intervals = new Map(); let timerId = 0;
globalThis.window = { setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), setTimeout: () => 1 };
// Retain coverage for the experimental leveler, explicitly opted in here.
// Production defaults keep it off; Traveler integration tests verify bypass.
function levelingEngine() {
  const engine = new AudioEngine();
  engine.sourceLevelingEnabled = true;
  return engine;
}
const engine = levelingEngine();
engine.setToneMode('bands'); engine.setMasterVolume(.1); engine.compressor.ratio.value = 1;
engine.addStream('quiet', { amplitude: .02 }); engine.addStream('loud', { amplitude: .2 });
engine.setStreamVolume('quiet', .3); engine.setStreamVolume('loud', 3);
for (const id of ['quiet', 'loud']) {
  const channel = engine.channels.get(id);
  // This pull-based renderer needs a silent destination connection to process
  // an analyser branch. Chromium processes unconnected analysers natively.
  const silent = engine.ctx.createGain(); silent.gain.value = 0;
  channel.rawAnalyser.connect(silent); channel.sourceLevelAnalyser.connect(silent); silent.connect(engine.ctx.destination);
  channel.limiter.ratio.value = 1;
  engine.setStreamLevelMatch(id, false);
}
const timersBeforeTraveler = intervals.size;
engine.setChordPadTight(true); engine.setTravelerSource('quiet');
const levelTimerCount = intervals.size;
engine.ctx.processTo(.4); engine.updateSourceLevels();
assert.equal(engine.channels.get('quiet').sourceLevelState.gainDb, db(.3 / .8), 'no held notes preserves the normal fader level without calibration or boost');
engine.noteOn(69, 100, 'chord-pad');
await Promise.resolve();
for (let i = 0; i < 120; i++) {
  engine.ctx.processTo(engine.ctx.currentTime + .2);
  engine.updateSourceLevels();
}
assert.ok(engine.channels.get('loud').sourceLevelGain.gain.value < 3 / .8, 'unselected destination is calibrated with the held chord');
function rms() {
  engine.ctx.processTo(engine.ctx.currentTime + .3);
  const data = engine.ctx.exportAsAudioData().channelData[0].slice(-4096);
  assert.ok(data.every(Number.isFinite));
  return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
}
const quietLevel = rms(); engine.setTravelerSource('loud'); const loudLevel = rms();
assert.equal(intervals.size, levelTimerCount, 'switching destinations does not add timers');
assert.ok(quietLevel > 1e-5 && Math.abs(db(quietLevel / loudLevel)) < 1.3, `rendered outputs match: ${db(quietLevel/loudLevel)} dB, ${JSON.stringify([...engine.channels.values()].map(ch=>({gain:ch.sourceLevelState.gainDb,offset:ch.sourcePredictionOffsetDb,p:engine.predictTravelerLevel(ch)})))}`);
const beforeGain = engine.channels.get('loud').sourceLevelState.gainDb;
engine.setMasterVolume(.05); const halfMaster = rms();
assert.ok(Math.abs(db(halfMaster / loudLevel) + 6.02) < .3, 'Master still gives an independent 6 dB cut');
engine.updateNoteSourceVelocity(69, 50, 'chord-pad'); const halfChord = rms();
assert.ok(Math.abs(db(halfChord / halfMaster) + 6.02) < .3, 'Chord velocity remains independent');
engine.allNotesOff('chord-pad');
engine.noteOn(69, 100, 'keyboard'); const fullKeys = rms();
engine.updateNoteSourceVelocity(69, 50, 'keyboard'); const halfKeys = rms();
assert.ok(Math.abs(db(halfKeys / fullKeys) + 6.02) < .3, 'Keys volume remains independent');
assert.equal(engine.channels.get('loud').sourceLevelState.gainDb, beforeGain, 'musical gain changes never feed back into chord leveling');
engine.allNotesOff();
const beforeRelease = engine.channels.get('loud').sourceLevelState.gainDb;
engine.ctx.processTo(engine.ctx.currentTime + 2); engine.updateSourceLevels();
assert.equal(engine.channels.get('loud').sourceLevelState.gainDb, beforeRelease, 'release tails never cause makeup gain');
engine.setTravelerSource(null); engine.ctx.processTo(engine.ctx.currentTime + 1);
assert.equal(intervals.size, timersBeforeTraveler, 'all leveling and transition timers stop on exit');
for (const channel of engine.channels.values()) assert.ok(Math.abs(channel.sourceLevelGain.gain.value - 1) < 1e-6, 'normal mode bypasses automatic gain');
assert.equal(engine.getStreamVolume('quiet'), .3); assert.equal(engine.getStreamVolume('loud'), 3);
console.log(`Rendered source levels passed: quiet ${db(quietLevel).toFixed(2)} dB, loud ${db(loudLevel).toFixed(2)} dB; source switching, Master/Chord control, timer cleanup, and saved volumes preserved.`);

// Regression: equalizing broadband input energy actively misbalances sources
// whose rumble-to-musical-signal ratio differs. Render the actual meter branch.
const colored = levelingEngine();
colored.setToneMode('bands'); colored.setMasterVolume(.1); colored.compressor.ratio.value = 1;
colored.setChordPadTight(true); colored.setTravelerSource('rumble');
colored.addStream('rumble', { amplitude: .0005, rumble: .15 });
colored.addStream('clear', { amplitude: .005 });
for (const id of ['rumble', 'clear']) {
  const ch = colored.channels.get(id);
  const silent = colored.ctx.createGain(); silent.gain.value = 0;
  ch.rawAnalyser.connect(silent); ch.sourceLevelAnalyser.connect(silent); silent.connect(colored.ctx.destination);
  ch.limiter.ratio.value = 1; colored.setStreamLevelMatch(id, false);
}
colored.noteOn(69, 100, 'chord-pad'); await Promise.resolve();
for (let i = 0; i < 40; i++) { colored.ctx.processTo(colored.ctx.currentTime + .2); colored.updateSourceLevels(); }
function renderedLevel() {
  colored.ctx.processTo(colored.ctx.currentTime + .3);
  const data = colored.ctx.exportAsAudioData().channelData[0].slice(-4096);
  return Math.sqrt(data.reduce((s, x) => s + x * x, 0) / data.length);
}
const rumbleLevel = renderedLevel(); colored.setTravelerSource('clear'); const clearLevel = renderedLevel();
assert.ok(Math.abs(db(rumbleLevel / clearLevel)) < 1.3, 'different spectra match after the actual resonators, not before them');
assert.ok(colored.channels.get('rumble').sourceLevelState.gainDb > 25, 'quiet chord energy can receive more than the old 18 dB ceiling');
const gainBeforePause = colored.channels.get('clear').sourceLevelState.gainDb;
colored.channels.get('clear').audioElement.paused = true;
colored.ctx.processTo(colored.ctx.currentTime + .4); colored.updateSourceLevels();
assert.equal(colored.channels.get('clear').sourceLevelState.gainDb, gainBeforePause, 'paused media never increases gain');
assert.equal(colored.channels.get('clear').sourceLevelState.signalSeconds, 0, 'resume must qualify the signal again');
console.log(`Different-spectrum regression passed: rumble-heavy versus clear source difference ${db(rumbleLevel / clearLevel).toFixed(2)} dB.`);

// Regression: entering Traveler must inherit a quiet normal mix, not climb
// toward the old fixed -38 dB reference. Exercise low and high saved faders.
for (const [secondVolume, resonanceQ] of [[0, 30], [.0258, 30], [2.58, 30], [0, 1]]) {
  const transition = levelingEngine();
  transition.setToneMode('bands'); transition.setMasterVolume(1);
  transition.compressor.ratio.value = 1;
  transition.addStream('california', { amplitude: .0007 });
  transition.addStream('other', { amplitude: .0004, phase: Math.PI / 2 });
  transition.setStreamVolume('california', .99);
  transition.setStreamVolume('other', secondVolume);
  for (const ch of transition.channels.values()) {
    const sink = transition.ctx.createGain(); sink.gain.value = 0;
    ch.rawAnalyser.connect(sink); ch.sourceLevelAnalyser.connect(sink); sink.connect(transition.ctx.destination);
    ch.limiter.ratio.value = 1;
  }
  transition.setFilterQ(resonanceQ);
  transition.noteOn(69, 254, 'chord-pad'); await Promise.resolve();
  function level(seconds = .2) {
    transition.ctx.processTo(transition.ctx.currentTime + seconds);
    const data = transition.ctx.exportAsAudioData().channelData[0].slice(-2048);
    return Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length);
  }
  level(1);
  for (const ch of transition.channels.values()) if (ch.levelMatchPending) transition.updateLevelMatch(ch);
  const normalLevel = level(1);
  transition.setTravelerSource('california');
  let maximum = 0, final = 0;
  for (let i = 0; i < 100; i++) {
    final = level(); maximum = Math.max(maximum, final);
    transition.updateSourceLevels();
  }
  assert.ok(db(maximum / normalLevel) < 1, 'entering Traveler never balloons above the normal mix');
  assert.ok(Math.abs(db(final / normalLevel)) < 1, 'Traveler converges to the chosen normal listening level');
  transition.setTravelerSource(null);
  const returned = level();
  assert.ok(Math.abs(db(returned / normalLevel)) < .2, `leaving Traveler restores normal: Q=${resonanceQ}, fader=${secondVolume}, delta=${db(returned/normalLevel)}`);
  assert.equal(transition.getStreamVolume('california'), .99);
  assert.equal(transition.getStreamVolume('other'), secondVolume);
  console.log(`Mode transition passed: second fader ${secondVolume}, peak change ${db(maximum / normalLevel).toFixed(2)} dB, final change ${db(final / normalLevel).toFixed(2)} dB.`);
}

const deferred = levelingEngine();
deferred.setToneMode('bands');
deferred.addStream('ready', { amplitude: .001 });
deferred.addStream('lost', { amplitude: .001 });
for (const ch of deferred.channels.values()) {
  const sink = deferred.ctx.createGain(); sink.gain.value = 0;
  ch.rawAnalyser.connect(sink); ch.sourceLevelAnalyser.connect(sink); sink.connect(deferred.ctx.destination);
}
deferred.setTravelerSource('ready');
assert.equal(deferred.travelerLevelTargetDb, null, 'entering without a chord waits for useful reference audio');
deferred.channels.get('lost').audioElement.paused = true;
deferred.noteOn(69, 127, 'chord-pad'); await Promise.resolve();
deferred.ctx.processTo(1); deferred.updateSourceLevels();
assert.ok(Number.isFinite(deferred.travelerLevelTargetDb), 'a lost reference stream does not block calibration from the audible normal mix');
console.log('Deferred entry passed: no chord waits; unavailable reference cannot block leveling.');

// Fifteen simultaneous feeds, with weak pitch energy despite healthy input.
// Verify the real graph's correction and that parked wall time is excluded.
const many = levelingEngine();
many.setToneMode('bands'); many.setMasterVolume(.05); many.compressor.ratio.value = 1;
many.setChordPadTight(true); many.setTravelerSource('0');
for (let i = 0; i < 15; i++) {
  many.addStream(String(i), { amplitude: .004 * 10 ** (-i / 20), frequency: 300 });
  const ch = many.channels.get(String(i));
  const sink = many.ctx.createGain(); sink.gain.value = 0;
  ch.rawAnalyser.connect(sink); ch.sourceLevelAnalyser.connect(sink); sink.connect(many.ctx.destination);
  ch.limiter.ratio.value = 1; many.setStreamLevelMatch(String(i), false);
}
many.setFilterQ(95); many.noteOn(69, 127, 'chord-pad'); await Promise.resolve();
let maxRendering = 0;
for (let i = 0; i < 180; i++) {
  many.ctx.processTo(many.ctx.currentTime + .2); many.updateSourceLevels();
  maxRendering = Math.max(maxRendering, [...many.channels.values()].filter(ch => ch.rendering).length);
}
assert.ok(maxRendering <= 2, 'level matching never revives all fifteen DSP branches');
assert.ok([...many.channels.values()].every(ch => many.ctx.currentTime - ch.sourceInputMeasuredAt < .21),
  'all fifteen input meters stay current even while their resonators are parked');
assert.ok(many.channels.get('14').sourceLevelState.signalSeconds < 10, 'inactive time is not counted as measured audio');
const levels = [];
for (let i = 0; i < 15; i++) {
  many.setTravelerSource(String(i)); many.ctx.processTo(many.ctx.currentTime + .3);
  const data = many.ctx.exportAsAudioData().channelData[0].slice(-4096);
  assert.ok(data.every(Number.isFinite));
  levels.push(db(Math.sqrt(data.reduce((sum, x) => sum + x*x, 0) / data.length)));
}
assert.ok(Math.min(...levels) > -70, 'all fifteen quiet extracted signals receive useful makeup');
assert.ok(Math.max(...levels) - Math.min(...levels) < 1.5, `fifteen sources match before audible settling: ${JSON.stringify(levels)}; gains: ${JSON.stringify([...many.channels.values()].map(ch=>ch.sourceLevelState.gainDb))}`);
console.log(`15-source narrow-band regression passed: ${ (Math.max(...levels)-Math.min(...levels)).toFixed(2) } dB spread; ${maxRendering} DSP branches.`);

// Reference timbre changes must follow the audible gain without waiting for
// the next leveling tick (or overwriting velocity/envelope controls).
many.setToneMode('harmonic-evidence');
many.setHarmonicEvidenceSettings({ amount: 2, color: 1, response: 1 });
many.ctx.processTo(many.ctx.currentTime + .3); many.updateAnalyzedToneVoices();
many.ctx.processTo(many.ctx.currentTime + .3);
const voice = many.channels.get('14').activeVoices.get(69);
assert.ok(Math.abs(voice.levelReferenceGain.gain.value * 8 - voice.gain.gain.value) < .01,
  'harmonic evidence changes reach both audible and reference paths together');
many.setToneMode('bands'); many.ctx.processTo(many.ctx.currentTime + .3);
assert.ok(Math.abs(voice.levelReferenceGain.gain.value - 1) < .001, 'changing tone mode also updates the reference');
console.log('Timbre reference regression passed.');

// Measure the actual audible window while Q and its compensation change.
// A post-hoc multiplication by the newest gain fails this timing contract.
const sweep = levelingEngine();
sweep.setToneMode('bands'); sweep.setMasterVolume(.1); sweep.compressor.ratio.value = 1;
sweep.setChordPadTight(true); sweep.setTravelerSource('meter');
sweep.addStream('meter', { amplitude: .03, frequency: 300 });
const meter = sweep.channels.get('meter'); meter.limiter.ratio.value = 1;
const sink = sweep.ctx.createGain(); sink.gain.value = 0;
meter.rawAnalyser.connect(sink); meter.sourceLevelAnalyser.connect(sink); sink.connect(sweep.ctx.destination);
sweep.noteOn(69, 127, 'chord-pad'); await Promise.resolve();
sweep.ctx.processTo(2); sweep.updateLevelMatch(meter); sweep.ctx.processTo(3);
function meterOutputRatio() {
  meter.sourceLevelAnalyser.getFloatTimeDomainData(meter.sourceLevelSamples);
  const data = sweep.ctx.exportAsAudioData().channelData[0].slice(-8192);
  const power = a => a.reduce((s, x) => s+x*x, 0)/a.length;
  return Math.sqrt(power(data)/power(meter.sourceLevelSamples));
}
const referenceRatio = meterOutputRatio(); let maxMeterError = 0;
for (const q of [1, 2, 10, 30, 100, 2, 95]) {
  sweep.setFilterQ(q); sweep.ctx.processTo(sweep.ctx.currentTime + .08);
  maxMeterError = Math.max(maxMeterError, Math.abs(db(meterOutputRatio()/referenceRatio)));
}
assert.ok(maxMeterError < .5, 'leveler measures the audible compensated window throughout a resonance sweep');
console.log(`Resonance meter regression passed: ${maxMeterError.toFixed(2)} dB maximum tracking error.`);

const perceived = levelingEngine();
perceived.setToneMode('bands'); perceived.setMasterVolume(.05); perceived.compressor.ratio.value = 1;
perceived.setChordPadTight(true); perceived.setTravelerSource('bass');
for (const [id, frequency] of [['bass', 165], ['mid', 660]]) {
  perceived.addStream(id, { amplitude: .01, frequency });
  const ch = perceived.channels.get(id), sink = perceived.ctx.createGain(); sink.gain.value = 0;
  ch.rawAnalyser.connect(sink); ch.sourceLevelAnalyser.connect(sink); sink.connect(perceived.ctx.destination);
  ch.limiter.ratio.value = 1; perceived.setStreamLevelMatch(id, false);
}
for(const note of [52,76]) perceived.noteOn(note,127,'chord-pad'); await Promise.resolve();
for(let i=0;i<100;i++){perceived.ctx.processTo(perceived.ctx.currentTime+.2);perceived.updateSourceLevels();}
function outputRms(){perceived.ctx.processTo(perceived.ctx.currentTime+.3);const a=perceived.ctx.exportAsAudioData().channelData[0].slice(-8192);return Math.sqrt(a.reduce((s,x)=>s+x*x,0)/a.length);}
const bassRms=outputRms();perceived.setTravelerSource('mid');const midRms=outputRms();
// IEC A response at 165 Hz is about -12.9 dB; 660 Hz about -1.7 dB.
// The algorithm must raise the bass source instead of matching raw RMS again.
const compensationDb=db(bassRms/midRms);
assert.ok(compensationDb>9 && compensationDb<13,
  `different source spectra receive perceptual correction, measured ${compensationDb} dB`);
console.log(`Perceptual source regression passed: bass versus midrange correction ${compensationDb.toFixed(2)} dB.`);

// A performance gesture must be compensated before the next 200 ms AGC tick.
// Use off-note input so a Q jump changes the extracted level dramatically.
const instant = levelingEngine();
instant.setToneMode('bands'); instant.setMasterVolume(.05); instant.setChordPadTight(true);
instant.compressor.ratio.value = 1; instant.setTravelerSource('a');
for (const [id, amplitude] of [['a', .03], ['b', .003]]) {
  instant.addStream(id, { amplitude, frequency: 300 });
  const ch = instant.channels.get(id), sink = instant.ctx.createGain(); sink.gain.value = 0;
  ch.rawAnalyser.connect(sink); ch.sourceLevelAnalyser.connect(sink); sink.connect(instant.ctx.destination);
  ch.limiter.ratio.value = 1;
}
instant.setFilterQ(1); instant.noteOn(69, 127, 'chord-pad'); await Promise.resolve();
for(let i=0;i<50;i++){instant.ctx.processTo(instant.ctx.currentTime+.2);instant.updateSourceLevels();}
const outputLevel = seconds => {
  const end = instant.ctx.currentTime + seconds;
  while (instant.ctx.currentTime < end) {
    instant.ctx.processTo(Math.min(end, instant.ctx.currentTime+.025));
    instant.updateTravelerTransition();
  }
  const a=instant.ctx.exportAsAudioData().channelData[0].slice(-2048);
  return Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length);
};
const beforeGesture=outputLevel(.1);
instant.setFilterQ(100);
const afterGesture=outputLevel(.15);
assert.ok(Math.abs(db(afterGesture/beforeGesture))<2,
  `Q=1 to 100 responds within 150 ms: ${db(afterGesture/beforeGesture)} dB`);
for(let i=0;i<15;i++){instant.ctx.processTo(instant.ctx.currentTime+.2);instant.updateSourceLevels();}
const settledGesture=outputLevel(.1);
assert.ok(Math.abs(db(settledGesture/afterGesture))<2,
  `Q gesture must not swell afterwards: ${db(settledGesture/afterGesture)} dB`);
// The other source has not rendered at this Q yet. Selection must predict it.
instant.setFilterQ(1); outputLevel(.15); instant.setFilterQ(100);
instant.setTravelerSource('b');
const switched=outputLevel(.15);
assert.ok(Math.abs(db(switched/beforeGesture))<2,
  `unrendered destination at new Q is ready on selection: ${db(switched/beforeGesture)} dB`);
instant.setFilterQ(1); const returnedQ=outputLevel(.15);
assert.ok(Math.abs(db(returnedQ/switched))<2, `reverse sweep stays level: ${db(returnedQ/switched)} dB`);
assert.ok([...instant.channels.values()].every(ch=>instant.ctx.currentTime-ch.sourceInputMeasuredAt<1),
  'inactive inputs continue to be monitored');
const frozenPrediction=instant.channels.get('a').sourceLevelState.gainDb;
instant.channels.get('a').audioElement.paused=true;
instant.setTravelerSource('a');
assert.equal(instant.channels.get('a').sourceLevelState.gainDb,frozenPrediction,
  'unavailable input cannot request predictive makeup');
console.log(`Performance response passed: Q jump ${db(afterGesture/beforeGesture).toFixed(2)} dB; later swell ${db(settledGesture/afterGesture).toFixed(2)} dB; source switch ${db(switched/beforeGesture).toFixed(2)} dB.`);
