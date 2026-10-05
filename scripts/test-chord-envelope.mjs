import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { URL } from 'node:url';
import console from 'node:console';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';

const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const output = url(compile('../src/services/audioOutput.ts'));
const router = url(compile('../src/services/audioOutputRouter.ts').replace('"./audioOutput"', JSON.stringify(output)));
const sourceLevelModule = url(compile('../src/services/sourceLeveling.ts'));
const levelMatchModule = url(compile('../src/services/resonanceLevelMatch.ts'));
const { AudioEngine } = await import(url(compile('../src/services/AudioEngine.ts').replace('"./audioOutputRouter"', JSON.stringify(router)).replace("'./resonanceLevelMatch'", JSON.stringify(levelMatchModule)).replace("'./sourceLeveling'", JSON.stringify(sourceLevelModule))));

// Render the real engine's note scheduling against a constant source, isolating
// the envelope from the unpredictable content of a live environmental stream.
function fixture(tight, toneMode = 'bands') {
  const ctx = new webAudioEngine.RenderingAudioContext({ sampleRate: 48000, blockSize: 128, numberOfChannels: 1 });
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const levelMatchGain = ctx.createGain();
  const streamGain = ctx.createGain();
  gain.connect(levelMatchGain);
  levelMatchGain.connect(streamGain);
  streamGain.connect(ctx.destination);
  const source = ctx.createBufferSource();
  source.buffer = ctx.createBuffer(1, 48000, 48000);
  source.buffer.getChannelData(0).fill(1);
  source.loop = true;
  source.connect(gain);
  source.start();
  const voice = { gain, levelReferenceGain: ctx.createGain(), filter: ctx.createBiquadFilter(), harmonicBands: [], active: false, tight: false, harmonicEvidence: 0 };
  const channel = { highPassFilter: ctx.createBiquadFilter(), lowPassFilter: ctx.createBiquadFilter(), levelMatchGain, streamGain, levelMatch: false, levelMatchReferenceQ: 30, levelMatchPending: false, volume: 1, rawAnalyser: { getFloatFrequencyData: bins => bins.fill(-40) }, analysisBins: new Float32Array(4096), voices: [voice], activeVoices: new Map(), octaveShift: 0, filterQ: 30 };
  const engine = Object.assign(Object.create(AudioEngine.prototype), {
    ctx, channels: new Map([['fixture', channel]]), activeNotes: new Map(),
    chordPadTight: tight, pitchBendSemitones: 0, toneMode,
    harmonicEvidenceAmount: 1, harmonicEvidenceColor: 0, harmonicEvidenceResponse: 0,
    resume: async () => {},
    // Fixed analysis evidence lets this test catch smoothing that overrides attack.
    refreshAnalysisBins: () => true,
    measureHarmonicEvidence: () => ({ score: 1, strengths: new Map() }),
  });
  const advance = duration => ctx.processTo(ctx.currentTime + duration);
  const level = () => {
    const samples = ctx.exportAsAudioData().channelData[0];
    return samples[samples.length - 1];
  };
  return { engine, voice, advance, level };
}

for (const mode of ['bands', 'harmonic-evidence']) {
  const { engine, voice, advance, level } = fixture(true, mode);
  for (let hit = 0; hit < 12; hit++) {
    assert.equal(engine.noteOn(60, 127, 'chord-pad'), true);
    advance(0.006);
    const target = engine.getVoiceOutputGain(voice, 127);
    assert.ok(level() > target * 0.98, `${mode}: hit ${hit} must reach full attack within 6ms`);
    advance(0.025);
    engine.updateHarmonicEvidenceVoicesForChannel(engine.channels.get('fixture'));
    advance(0.006);
    assert.ok(level() > target * 0.98, 'analysis must not soften a held hit');
    engine.allNotesOff('chord-pad');
    advance(0.025);
    assert.ok(Math.abs(level()) < 1e-6, `${mode}: hit ${hit} must be silent after release`);
  }
}

{
  const { engine, advance, level } = fixture(true);
  engine.noteOn(60, 127, 'chord-pad');
  advance(0.02);
  engine.allNotesOff('chord-pad');
  advance(0.005);
  engine.noteOn(60, 127, 'chord-pad');
  advance(0.03);
  assert.ok(level() > 7.9, 'a rapid retrigger must cancel the previous release cutoff');
}

for (const [tight, source] of [[false, 'chord-pad'], [true, 'keyboard']]) {
  const { engine, advance, level } = fixture(tight);
  engine.noteOn(60, 127, source);
  advance(0.006);
  assert.ok(level() < 4, 'soft mode / keyboard retain their slower attack');
  advance(0.2);
  engine.allNotesOff(source);
  advance(0.025);
  assert.ok(level() > 4, 'soft mode / keyboard retain their release tail');
}

{
  const { engine, advance, level } = fixture(true);
  engine.noteOn(60, 127, 'keyboard');
  engine.noteOn(60, 127, 'chord-pad');
  advance(0.025);
  engine.allNotesOff('chord-pad');
  advance(0.05);
  assert.ok(level() > 7.9, 'releasing a pad must not cut a shared keyboard note');
  engine.allNotesOff('keyboard');
  advance(0.025);
  assert.ok(level() > 4, 'remaining keyboard ownership must restore soft release');
}
{
  const { engine, advance, level } = fixture(false);
  engine.noteOn(60, 127, 'chord-pad');
  advance(0.2);
  engine.setChordPadTight(true);
  engine.allNotesOff('chord-pad');
  advance(0.025);
  assert.ok(Math.abs(level()) < 1e-6, 'toggling Tight while held must affect release');
  engine.noteOn(60, 127, 'chord-pad');
  advance(0.006);
  engine.setChordPadTight(false);
  engine.allNotesOff('chord-pad');
  advance(0.025);
  assert.ok(level() > 4, 'turning Tight off restores soft release');
}
console.log('Chord envelope checks passed: rendered attack/release, repeated hits, harmonic smoothing, keyboard isolation, and live toggle.');

const chords = url(compile('../src/music/chords.ts'));
const storage = await import(url(compile('../src/services/storage.ts').replace("'../music/chords'", JSON.stringify(chords))));
let saved = JSON.stringify({ masterVolume: 0.42, chordBank: [{ root: 4, type: 'min11', inversion: 1 }] });
const originalStorage = globalThis.localStorage;
globalThis.localStorage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
try {
  assert.equal(storage.getChordPadTight(), false, 'old sessions default to soft');
  storage.saveChordPadTight(true);
  assert.equal(storage.getChordPadTight(), true);
  storage.saveMasterVolume(0.5);
  assert.equal(storage.getChordPadTight(), true, 'other preference writes preserve Tight');
  assert.deepEqual(storage.getChordBank(), [{ root: 4, type: 'min11', inversion: 1 }]);
  storage.saveStreamSettings('fixture', { filterQ: 45, volume: 0.7 });
  assert.equal(storage.getStreamSettings('fixture').levelMatch, true, 'legacy tracks default on');
  assert.equal(storage.getStreamSettings('fixture').levelMatchReferenceQ, 45, 'legacy reference uses saved resonance');
  storage.saveStreamSettings('fixture', { ...storage.getStreamSettings('fixture'), levelMatch: false });
  assert.equal(storage.getStreamSettings('fixture').levelMatch, false, 'saved off preference is respected');
  storage.saveStreamSettings('fixture', { ...storage.getStreamSettings('fixture'), levelMatch: true, levelMatchReferenceQ: 65 });
  storage.saveMasterVolume(0.4);
  assert.equal(storage.getStreamSettings('fixture').levelMatch, true);
  assert.equal(storage.getStreamSettings('fixture').levelMatchReferenceQ, 65);
  assert.equal(storage.getStreamSettings('fixture').volume, 0.7);
  storage.saveStreamSettings('fixture', { ...storage.getStreamSettings('fixture'), volume: 16 });
  assert.equal(storage.getStreamSettings('fixture').volume, 4, 'old high gains fit the new slider range');
  storage.saveStreamSettings('fixture', { ...storage.getStreamSettings('fixture'), volume: 0 });
  assert.equal(storage.getStreamSettings('fixture').volume, 0, 'track gain can still reach silence');
  const partialBank = [null, { root: 9, type: 'min9', inversion: 2 }, null, { root: 4, type: 'min11', inversion: 0 }];
  storage.saveChordBank(partialBank);
  storage.saveMasterVolume(0.4);
  assert.deepEqual(storage.getChordBank(), partialBank, 'empty pads retain their slots across storage writes');
  storage.saveChordPadTight(false);
  assert.equal(storage.getChordPadTight(), false);
} finally {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
}
console.log('Tight preference checks passed: legacy default, persistence, and other saved controls preserved.');

{
  const { engine, advance, level } = fixture(true);
  engine.noteOn(60, 127, 'chord-pad');
  engine.setStreamLevelMatch('fixture', true, 30);
  engine.setStreamFilterQ('fixture', 100);
  advance(0.1);
  const matched = level();
  engine.setStreamVolume('fixture', 0.25);
  advance(0.1);
  assert.ok(Math.abs(level() / matched - 0.25) < 0.001, 'volume stays independent of Level Match');
  engine.allNotesOff('chord-pad');
  engine.updateLevelMatch(engine.channels.get('fixture'));
  advance(0.025);
  assert.ok(Math.abs(level()) < 1e-6, 'Level Match must preserve Tight release silence');
  assert.equal(engine.getStreamLevelMatch('fixture').referenceQ, 30, 'reference survives resonance edits');
  engine.setStreamLevelMatch('fixture', false);
  advance(0.2);
  assert.ok(Math.abs(engine.channels.get('fixture').levelMatchGain.gain.value - 1) < 0.001);
}
console.log('Level Match engine checks passed: independent volume, reference stability, bypass, and Tight releases.');
