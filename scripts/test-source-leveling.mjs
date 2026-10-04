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
const { createSourceLevelState, updateSourceLevel } = await import(levelModule);
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
assert.ok(Math.abs(db(loud.rms) + 26) < 1.1, 'steady source approaches the target baseline');
const frozen = quiet.state.gainDb;
for (let i = 0; i < 100; i++) updateSourceLevel(quiet.state, samples(0), .2);
assert.equal(quiet.state.gainDb, frozen, 'dropouts never increase gain');
updateSourceLevel(quiet.state, samples(.0011), .2);
assert.equal(quiet.state.gainDb, frozen, 'an isolated sound after silence cannot trigger boost');
assert.equal(settle(.0001).gain, 1, 'sub-threshold hiss is not boosted');
assert.ok(settle(.0015).gain <= 10 ** (18 / 20), 'quiet feeds have a finite boost ceiling');
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
  createMediaElementSource(element) {
    const source = this.createBufferSource();
    source.buffer = this.createBuffer(1, 48000, 48000);
    const data = source.buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = element.amplitude * Math.sin(2 * Math.PI * 440 * i / 48000);
    source.loop = true; source.start(); return source;
  }
}
globalThis.AudioContext = TestContext;
const intervals = new Map(); let timerId = 0;
globalThis.window = { setInterval: fn => { const id = ++timerId; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id), setTimeout: () => 1 };
const engine = new AudioEngine();
engine.setToneMode('bands'); engine.setMasterVolume(.1); engine.compressor.ratio.value = 1;
engine.addStream('quiet', { amplitude: .02 }); engine.addStream('loud', { amplitude: .2 });
engine.setStreamVolume('quiet', .3); engine.setStreamVolume('loud', 3);
for (const [id, amplitude] of [['quiet', .02], ['loud', .2]]) {
  const channel = engine.channels.get(id);
  // The JS audio renderer lacks analyser waveform support; native-browser QA
  // separately verifies the real analyser. The graph and gain are rendered here.
  channel.rawAnalyser.getFloatTimeDomainData = bins => bins.set(samples(amplitude));
  channel.limiter.ratio.value = 1;
  engine.setStreamLevelMatch(id, false);
}
engine.setChordPadTight(true); engine.setTravelerSource('quiet');
const levelTimerCount = intervals.size;
for (let i = 0; i < 120; i++) {
  engine.ctx.processTo(engine.ctx.currentTime + .2);
  engine.updateSourceLevels();
}
assert.ok(engine.channels.get('loud').sourceLevelGain.gain.value < .5, 'silent destination is calibrated before selection');
engine.noteOn(69, 100, 'chord-pad');
await Promise.resolve();
function rms() {
  engine.ctx.processTo(engine.ctx.currentTime + .3);
  const data = engine.ctx.exportAsAudioData().channelData[0].slice(-4096);
  assert.ok(data.every(Number.isFinite));
  return Math.sqrt(data.reduce((sum, value) => sum + value * value, 0) / data.length);
}
const quietLevel = rms(); engine.setTravelerSource('loud'); const loudLevel = rms();
assert.equal(intervals.size, levelTimerCount, 'switching destinations does not add timers');
assert.ok(quietLevel > 1e-5 && Math.abs(db(quietLevel / loudLevel)) < 1.3, 'rendered outputs match despite source amplitudes and saved faders differing');
const beforeGain = engine.channels.get('loud').sourceLevelState.gainDb;
engine.setMasterVolume(.05); const halfMaster = rms();
assert.ok(Math.abs(db(halfMaster / loudLevel) + 6.02) < .3, 'Master still gives an independent 6 dB cut');
engine.updateNoteSourceVelocity(69, 50, 'chord-pad'); const halfChord = rms();
assert.ok(Math.abs(db(halfChord / halfMaster) + 6.02) < .3, 'Chord velocity remains independent');
engine.allNotesOff('chord-pad');
engine.noteOn(69, 100, 'keyboard'); const fullKeys = rms();
engine.updateNoteSourceVelocity(69, 50, 'keyboard'); const halfKeys = rms();
assert.ok(Math.abs(db(halfKeys / fullKeys) + 6.02) < .3, 'Keys volume remains independent');
assert.equal(engine.channels.get('loud').sourceLevelState.gainDb, beforeGain, 'musical gain changes never feed back into input leveling');
engine.setTravelerSource(null); engine.ctx.processTo(engine.ctx.currentTime + 1);
assert.equal(intervals.size, levelTimerCount - 1, 'leveling timer stops on exit');
for (const channel of engine.channels.values()) assert.ok(Math.abs(channel.sourceLevelGain.gain.value - 1) < 1e-6, 'normal mode bypasses automatic gain');
assert.equal(engine.getStreamVolume('quiet'), .3); assert.equal(engine.getStreamVolume('loud'), 3);
console.log(`Rendered source levels passed: quiet ${db(quietLevel).toFixed(2)} dB, loud ${db(loudLevel).toFixed(2)} dB; source switching, Master/Chord control, timer cleanup, and saved volumes preserved.`);
