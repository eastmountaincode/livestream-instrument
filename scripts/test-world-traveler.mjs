import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modules = new Map();
const effects = [];
const state = [];
let saved = JSON.stringify({ activeStreamIds: ['original', 'locus-jasper-ridge'], soloId: 'original', streams: {} });
const react = {
  useState: initial => {
    const index = state.length;
    state.push(typeof initial === 'function' ? initial() : initial);
    return [state[index], next => { state[index] = next; }];
  },
  useRef: current => ({ current }), useMemo: fn => fn(), useCallback: callback => callback,
  useEffect: callback => { effects.push(callback); },
};
class TestAudioContext extends webAudioEngine.RenderingAudioContext {
  constructor() { super({ sampleRate: 48000, numberOfChannels: 2 }); }
  createMediaElementSource(element) {
    element.paused ??= false;
    element.readyState ??= 4;
    const source = this.createBufferSource();
    source.buffer = this.createBuffer(1, 128, this.sampleRate);
    source.buffer.getChannelData(0).fill(.01);
    source.loop = true; source.start(); return source;
  }
}
function load(path) {
  const filename = resolve(root, path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, console, AudioContext: TestAudioContext,
    localStorage: { getItem: () => saved, setItem: (_key, value) => { saved = value; } },
    window: { setInterval: () => 1, clearInterval: () => {}, setTimeout: () => 1 },
    setTimeout: () => 1, queueMicrotask: callback => Promise.resolve().then(callback),
    require: specifier => specifier === 'react' ? react : specifier.startsWith('.')
      ? load(resolve(dirname(filename), `${specifier}.ts`)) : require(specifier),
  }, { filename });
  return module.exports;
}
const { audioEngine: engine } = load('src/services/AudioEngine.ts');
const dynamicsModes = [];
const setDynamicsEnabled = engine.travelerDynamics.setEnabled;
engine.travelerDynamics.setEnabled = enabled => { dynamicsModes.push(enabled); setDynamicsEnabled(enabled); };
const peakCeilings = [];
const setPeakCeiling = engine.outputRouter.setPeakCeiling;
engine.outputRouter.setPeakCeiling = ceiling => { peakCeilings.push(ceiling); setPeakCeiling(ceiling); };
const { midiService } = load('src/services/MidiService.ts');
const storage = load('src/services/storage.ts');
const { getTravelerSources, travelerSourceForNote } = load('src/music/worldTraveler.ts');
const { STREAM_CANDIDATE_SEEDS } = load('src/data/streamCandidates.ts');
const { candidateToLiveSource } = load('src/services/streams.ts');
const candidates = STREAM_CANDIDATE_SEEDS.map(candidateToLiveSource).filter(Boolean);
const slots = getTravelerSources(candidates);
for (const note of [69, 71, 93, 95]) {
  assert.equal(travelerSourceForNote(slots, note)?.id, 'orca-sunset-bay', 'A and B at the end of each bank select San Juan Islands');
}
for (const note of [24, 48, 72, 96, 120]) {
  assert.equal(travelerSourceForNote(slots, note)?.id, 'locus-jasper-ridge', 'California restarts at C5 and every two octaves');
}
for (const slot of slots) {
  for (const shift of [-48, -24, 0, 24, 48]) {
    assert.equal(travelerSourceForNote(slots, slot.note + shift)?.id, slot.id, 'every destination repeats above and below the original bank');
  }
}
for (let note = 0; note <= 127; note++) {
  assert.equal(Boolean(travelerSourceForNote(slots, note)), ![1, 3, 6, 8, 10].includes(note % 12), 'all MIDI white keys select a destination; black keys are ignored');
}
for (const note of [-1, 128, 48.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert.equal(travelerSourceForNote(slots, note), undefined, 'invalid MIDI notes are ignored');
}
assert.equal(travelerSourceForNote([], 72), undefined, 'an empty catalog has no destination');
assert.equal(slots.length, 13);
assert.equal(new Set(slots.map(slot => slot.note)).size, 13);
assert.equal(slots[0].keyLabel, 'C3');
assert.equal(candidates.length, 14, 'active catalog excludes unavailable destinations and includes Hokkaido');
assert.ok(!slots.some(slot => slot.id === 'locus-hokkaido-maeyama'), 'adding Hokkaido to Live Sources preserves the current Traveler bank');
assert.deepEqual(Array.from(slots, slot => slot.id), Array.from(getTravelerSources(candidates.filter(source => source.id !== 'locus-hokkaido-maeyama')), slot => slot.id), 'all existing key assignments stay unchanged');
assert.ok(!slots.some(slot => slot.id === 'locus-india-stream-083'), 'removed India stream is not assigned a key');
assert.ok(!slots.some(slot => slot.id === 'locus-santiago-maviuc'), 'removed Santiago stream is not assigned a key');
assert.ok(!slots.some(slot => slot.id === 'orca-port-townsend'), 'unavailable Washington stays out of the bank');
assert.equal(slots.at(-1).id, 'orca-sunset-bay');
assert.equal(slots.at(-1).keyLabel, 'A4');
assert.deepEqual(Array.from(slots, slot => slot.note), [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69]);
const fullBank = getTravelerSources(JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/traveler-sources.json'), 'utf8')));
assert.equal(fullBank.length, 14, 'future destinations fit before the repeated bank starts');
assert.equal(fullBank.at(-1).keyLabel, 'B4');
assert.equal(travelerSourceForNote(fullBank, 72).id, fullBank[0].id, 'a full bank still restarts at C5');
assert.deepEqual(Array.from(getTravelerSources([...candidates].reverse()), s => s.id), Array.from(slots, s => s.id), 'catalog order cannot reshuffle key assignments');
const { useWorldTraveler } = load('src/hooks/useWorldTraveler.ts');
const wanted = new Set(['original', slots[0].id]);
for (const id of wanted) engine.addStream(id, {});
engine.setStreamVolume('original', .6);
engine.setStreamPan(slots[0].id, -.3);
engine.setStreamVolume(slots[0].id, .8);
engine.setStreamSolo('original');
engine.setChordPadTight(true);
engine.noteOn(60, 100, 'chord-pad');
const originalNotes = Array.from(engine.activeNotes.keys());
let connections = [];
let disconnected = [];
const control = useWorldTraveler({
  sources: candidates, wantedIds: wanted, activeIds: wanted,
  connect: async source => { connections.push(source.id); if (!engine.channels.has(source.id)) engine.addStream(source.id, {}); },
  disconnect: id => { disconnected.push(id); engine.channels.delete(id); },
});
const cleanups = effects.map(effect => effect()).filter(Boolean);
const advance = () => engine.ctx.processTo(engine.ctx.currentTime + .003);
const gains = () => Array.from(engine.channels, ([id, ch]) => [id, ch.streamGain.gain.value]);
const send = (note, velocity = 100, status = 0x90) => midiService.handleMidiMessageEvent({ data: Uint8Array.from([status, note, velocity]), timeStamp: 0 });
control.toggle();
assert.equal(state[0], true);
assert.deepEqual(dynamicsModes, [true], 'Traveler enables bus compression and limiting');
assert.ok(Math.abs(peakCeilings[0] - Math.pow(10, -1 / 20)) < 1e-9, 'Traveler enables the final -1 dBFS ceiling');
assert.equal(engine.sourceLevelTimer, null, 'Traveler does not start automatic source leveling');
assert.equal(engine.sourceTransitionTimer, null, 'Traveler does not start predictive gain correction');
for (const ch of engine.channels.values()) assert.equal(ch.sourceLevelGain.gain.value, 1, 'source correction stays bypassed');

assert.equal(connections.length, slots.length, 'connect all fixed destinations');
advance();
for (const [id, value] of gains()) assert.equal(value, id === slots[0].id ? engine.getStreamVolume(id) : 0, 'background sources are silent');
for (let i = 0; i < slots.length; i++) {
  send(slots[i].note, i + 1); advance();
  assert.equal(state[1], slots[i].id, 'quiet key presses select the corresponding destination');
  for (const [id, value] of gains()) assert.equal(value, id === slots[i].id ? engine.getStreamVolume(id) : 0, 'Tight switches without a fade');
  send(slots[i].note, 0); assert.equal(state[1], slots[i].id, 'release keeps destination selected');
}
for (const shift of [-24, 24, 48]) {
  for (const slot of slots) {
    send(slot.note + shift); advance();
    assert.equal(state[1], slot.id, 'MIDI input selects the same destination in each repeated bank');
    send(slot.note + shift, 0);
  }
}
for (const note of [71, 95]) {
  send(note); send(note, 0);
  assert.equal(state[1], slots.at(-1).id, 'the spare B key selects San Juan Islands');
}
send(72); send(72, 0);
assert.equal(state[1], slots[0].id, 'C5 restarts California through the actual MIDI listener');
send(slots.at(-1).note); send(slots.at(-1).note, 0);
assert.equal(connections.length, slots.length, 'repeated keys reuse connected streams');
// MIDI keys Off must also gate World Traveler's source selection.
const selectedBeforeDisable = state[1];
send(slots[0].note);
midiService.setKeyboardInputEnabled(false);
assert.equal(midiService.activeNotes.size, 0, 'disabling keys releases held Traveler keys');
for (const slot of slots) {
  for (const shift of [0, 24]) { send(slot.note + shift); send(slot.note + shift, 0); }
}
assert.equal(state[1], slots[0].id, 'disabled keys never change the selected source');
control.select(slots[1].id);
assert.equal(state[1], slots[1].id, 'on-screen source selection still works with MIDI keys Off');
midiService.setKeyboardInputEnabled(true);
send(slots.at(-1).note); send(slots.at(-1).note, 0);
assert.equal(state[1], selectedBeforeDisable, 'enabling keys restores source selection');
assert.deepEqual(dynamicsModes, [true], 'source switching does not reconfigure or reset bus dynamics');
assert.equal(peakCeilings.length, 1, 'source switching keeps the peak ceiling connected');
assert.deepEqual(Array.from(engine.activeNotes.keys()), originalNotes, 'source keys do not add ordinary notes or change held chord');
for (const note of [49, 51, 54, 56, 58, 61, 63, 66, 68, 70, 73, 75, 78]) {
  send(note); send(note, 0);
  assert.equal(state[1], slots.at(-1).id, 'black keys never select a destination');
}
for (const note of [36, 48, 72, 96]) {
  send(note, 100, 0x99); send(note, 0, 0x99);
  assert.equal(state[1], slots.at(-1).id, 'chord pads do not select sources, even at repeated source note numbers');
}
send(90); assert.equal(state[1], slots.at(-1).id, 'black keys in higher banks are ignored');
engine.channels.delete(slots.at(-1).id);
engine.setTravelerSource(slots.at(-1).id); advance();
assert.ok(gains().every(([, value]) => value === 0), 'missing selected stream never unmutes other streams');
engine.addStream(slots.at(-1).id, {}); advance();
assert.ok(engine.channels.get(slots.at(-1).id).streamGain.gain.value > 0, 'reconnecting the same destination resumes it');
engine.setChordPadTight(false);
control.select(slots[0].id); advance();
assert.ok(engine.channels.get(slots[0].id).streamGain.gain.value > 0 && engine.channels.get(slots[0].id).streamGain.gain.value < .8, 'soft mode retains gain smoothing');
engine.setStreamPan(slots[0].id, .75);
engine.setStreamVolume(slots[0].id, .2);
storage.saveStreamSettings(slots[0].id, { ...storage.getStreamSettings(slots[0].id), pan: .75, volume: .2 });
storage.saveMasterVolume(.4);
engine.setGlobalFilters({ highPassFreq: 120, lowPassFreq: 6000 });
assert.equal(JSON.parse(saved).streams[slots[0].id], undefined, 'Traveler edits never overwrite the normal mix');
assert.equal(storage.getStreamSettings(slots[0].id).pan, .75, 'reconnection sees temporary settings');
assert.equal(JSON.parse(saved).travelerVolumes[slots[0].id], .2, 'manual Traveler volume is saved separately');
assert.equal(storage.getSavedState().travelerVolumes[slots[0].id], .2, 'saved volume survives loading state');
control.toggle();
assert.equal(state[0], false);
assert.deepEqual(dynamicsModes, [true, false], 'normal mode bypasses additional dynamics');
assert.equal(peakCeilings.at(-1), null, 'normal mode restores the uncapped output route');
assert.equal(engine.getStreamSolo(), 'original');
assert.equal(engine.getStreamPan(slots[0].id), -.3);
assert.equal(engine.getStreamVolume(slots[0].id), .8);
assert.equal(engine.getStreamHighPass(slots[0].id), 120, 'mode exit does not restore old per-track high-pass');
assert.equal(engine.getStreamLowPass(slots[0].id), 6000, 'mode exit does not restore old per-track low-pass');
assert.equal(disconnected.length, slots.length - 1, 'only mode-added destinations are disconnected');
assert.equal(storage.getStreamSettings(slots[0].id), null, 'temporary settings discarded');
assert.equal(JSON.parse(saved).masterVolume, .4, 'other intentional preference changes survive');
assert.deepEqual(JSON.parse(saved).activeStreamIds, ['original', slots[0].id]);
send(49); assert.equal(state[0], false, 'key subscription is inert outside the mode');
connections = []; disconnected = [];
engine.setChordPadTight(true);
control.toggle();
assert.equal(engine.getStreamVolume(slots[0].id), .2, 'remembered Traveler gain applies to an already-connected source');
assert.equal(storage.getStreamSettings(slots[0].id).volume, .2, 'reconnecting sources use the remembered gain');
assert.equal(storage.getStreamSettings(slots[0].id).pan, -.3, 'temporary pan edit was discarded');
advance();
assert.ok(Math.abs(engine.channels.get(slots[0].id).streamGain.gain.value - .2) < .0001, 'selected source routes at its manual volume');
assert.equal(storage.MAX_STREAM_VOLUME, 8);
engine.setStreamVolume(slots[1].id, 8);
storage.saveStreamSettings(slots[1].id, { ...storage.getStreamSettings(slots[1].id), volume: 8 });
control.select(slots[1].id); advance();
assert.equal(storage.getSavedState().travelerVolumes[slots[1].id], 8, '8x Traveler gain survives storage normalization');
assert.equal(engine.channels.get(slots[1].id).streamGain.gain.value, 8, 'selected source routes at 8x manual gain');
engine.setStreamVolume(slots[1].id, 0);
storage.saveStreamSettings(slots[1].id, { ...storage.getStreamSettings(slots[1].id), volume: 0 });
control.select(slots[1].id); advance();
assert.ok(gains().every(([, value]) => value === 0), 'zero gain remains silent when selected');
control.toggle();
assert.equal(engine.getStreamVolume(slots[0].id), .8, 'normal gain is restored after returning again');
control.toggle();
assert.equal(storage.getStreamSettings(slots[1].id).volume, 0, 'zero volume survives mode reentry');
control.toggle();
assert.equal(connections.length, slots.length * 2); assert.equal(disconnected.length, (slots.length - 1) * 2, 'repeated mode transitions are safe');
// A shared octave retunes held chords, new notes, and reconnecting sources,
// without modifying the normal mix or the destination key assignments.
engine.setToneMode('bands');
engine.setStreamOctave(slots[0].id, -1);
control.toggle();
control.select(slots[0].id);
const frequency = (id, note) => engine.channels.get(id).activeVoices.get(note).targetFrequency;
const middleC = 440 * 2 ** ((60 - 69) / 12);
control.changeOctave(1);
assert.equal(frequency(slots[0].id, 60), middleC * 2, 'held chord moves to the shared octave');
assert.equal(engine.getStreamOctave(slots[0].id), -1, 'normal per-track octave remains unchanged');
assert.equal(storage.getTravelerOctave(), 1, 'shared octave is saved');
control.select(slots[1].id);
assert.equal(frequency(slots[1].id, 60), middleC * 2, 'changing destination keeps the octave');
engine.channels.delete(slots[1].id);
engine.addStream(slots[1].id, {});
assert.equal(frequency(slots[1].id, 60), middleC * 2, 'reconnecting destination inherits the octave');
engine.noteOn(67, 100, 'chord-pad');
assert.equal(frequency(slots[1].id, 67), 440 * 2 ** ((79 - 69) / 12), 'new notes use the shared octave');
engine.noteOff(67, 'chord-pad');
control.changeOctave(-2);
assert.equal(frequency(slots[1].id, 60), middleC / 4, 'downward shifts retune existing voices');
control.toggle();
assert.equal(frequency(slots[0].id, 60), middleC / 2, 'leaving Traveler restores the normal octave');
control.toggle();
assert.equal(engine.getTravelerOctave(), -2, 'mode reentry retains the selected octave');
control.changeOctave(50);
assert.equal(engine.getTravelerOctave(), 3, 'octave range is bounded');
control.changeOctave(Number.NaN);
assert.equal(engine.getTravelerOctave(), 0, 'invalid values cannot poison audio frequencies');
control.toggle();

// Spectrum work scales with the audible destination, not the connected count.
engine.disconnectAllStreams();
engine.setTravelerSource(slots[0].id);
engine.setToneMode('harmonic-evidence');
const spectrumReads = new Map();
for (const slot of slots) {
  engine.addStream(slot.id, {});
  const channel = engine.channels.get(slot.id);
  channel.rawAnalyser.getFloatFrequencyData = bins => {
    spectrumReads.set(slot.id, (spectrumReads.get(slot.id) ?? 0) + 1);
    bins.fill(-55);
  };
}
engine.noteOn(64, 100, 'chord-pad');
await Promise.resolve();
spectrumReads.clear();
engine.setFilterQ(80);
assert.deepEqual([...spectrumReads.keys()], [slots[0].id], 'resonance analyzes only the selected source');
for (const slot of slots) assert.equal(engine.getStreamFilterQ(slot.id), 80, 'silent voices keep current resonance');
spectrumReads.clear();
engine.setTravelerSource(slots[1].id);
assert.deepEqual([...spectrumReads.keys()], [slots[1].id], 'destination is analyzed before its gate opens');
assert.equal(engine.channels.get(slots[1].id).levelMatchPending, false);
spectrumReads.clear();
engine.updateAnalyzedToneVoices();
assert.ok([...spectrumReads.keys()].every(id => id === slots[1].id), 'periodic analysis skips silent destinations');
spectrumReads.clear();
engine.setTravelerSource(null);
// Already-current corrections are preserved on exit; the next analysis tick
// still visits all normal-mode tracks.
engine.ctx.processTo(engine.ctx.currentTime + .1);
engine.updateAnalyzedToneVoices();
assert.equal(spectrumReads.size, slots.length, 'leaving Traveler restores analysis for every normal track');
// Muting a stream is insufficient: its resonators and level-reference branch
// must stop rendering, while media connections and held notes remain intact.
engine.setTravelerSource(slots[0].id);
const warmed = new Set();
// Repeated former calibration ticks must not restart automatic adjustment.
for (let tick = 0; tick < 80; tick++) {
  engine.ctx.processTo(engine.ctx.currentTime + .2);
  engine.updateSourceLevels();
  const rendering = [...engine.channels].filter(([, ch]) => ch.rendering);
  assert.ok(rendering.length <= 2, 'only selected and any releasing source render chords');
  assert.ok(engine.channels.get(slots[0].id).rendering, 'selected source always renders');
  for (const [id] of rendering) warmed.add(id);
}
assert.equal(warmed.size, 1, 'automatic calibration never wakes parked sources');
for (const ch of engine.channels.values()) assert.equal(ch.sourceLevelGain.gain.value, 1, 'no volume swell over time');
for (const slot of slots) {
  engine.setTravelerSource(slot.id);
  assert.ok(engine.channels.get(slot.id).rendering, 'source switching immediately restores processing');
  assert.ok(engine.channels.get(slot.id).activeVoices.size > 0, 'parking retains held chord voices');
}
engine.setTravelerSource(null);
assert.ok([...engine.channels.values()].every(ch => ch.rendering), 'normal mode restores all source processing');
for (const cleanup of cleanups) cleanup();
console.log('World Traveler checks passed: repeating two-octave mappings, unique source connections, tight/soft switching, silent outages, reconnect, held chords, persistent manual gains, temporary tone edits, normal-mix restoration, repeated transitions.');
