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
const { midiService } = load('src/services/MidiService.ts');
const storage = load('src/services/storage.ts');
const { getTravelerSources } = load('src/music/worldTraveler.ts');
const candidates = JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/traveler-sources.json'), 'utf8'));
const slots = getTravelerSources(candidates);
assert.equal(slots.length, 15);
assert.equal(new Set(slots.map(slot => slot.note)).size, 15);
assert.equal(slots[0].keyLabel, 'C3');
assert.equal(candidates.length, 16, 'active catalog excludes Santiago and includes Hokkaido');
assert.ok(!slots.some(slot => slot.id === 'locus-hokkaido-maeyama'), 'adding Hokkaido to Live Sources preserves the current Traveler bank');
assert.deepEqual(Array.from(slots, slot => slot.id), Array.from(getTravelerSources(candidates.filter(source => source.id !== 'locus-hokkaido-maeyama')), slot => slot.id), 'all existing key assignments stay unchanged');
assert.ok(!slots.some(slot => slot.id === 'locus-india-stream-083'), 'removed India stream is not assigned a key');
assert.ok(!slots.some(slot => slot.id === 'locus-santiago-maviuc'), 'removed Santiago stream is not assigned a key');
assert.ok(slots.some(slot => slot.id === 'orca-sunset-bay'), 'remaining destinations fill the fifteen-key bank');
assert.equal(slots[14].keyLabel, 'C5');
assert.deepEqual(Array.from(slots, slot => slot.note), [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72]);
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
assert.equal(engine.sourceLevelTimer, null, 'Traveler does not start automatic source leveling');
assert.equal(engine.sourceTransitionTimer, null, 'Traveler does not start predictive gain correction');
for (const ch of engine.channels.values()) assert.equal(ch.sourceLevelGain.gain.value, 1, 'source correction stays bypassed');

assert.equal(connections.length, 15, 'connect all fixed destinations');
advance();
for (const [id, value] of gains()) assert.equal(value, id === slots[0].id ? engine.getStreamVolume(id) : 0, 'background sources are silent');
for (let i = 0; i < 15; i++) {
  send(slots[i].note, i + 1); advance();
  assert.equal(state[1], slots[i].id, 'quiet key presses select the corresponding destination');
  for (const [id, value] of gains()) assert.equal(value, id === slots[i].id ? engine.getStreamVolume(id) : 0, 'Tight switches without a fade');
  send(slots[i].note, 0); assert.equal(state[1], slots[i].id, 'release keeps destination selected');
}
assert.deepEqual(Array.from(engine.activeNotes.keys()), originalNotes, 'source keys do not add ordinary notes or change held chord');
for (const note of [49, 51, 54, 56, 58, 61, 63, 66, 68, 70, 73, 75, 78]) {
  send(note); send(note, 0);
  assert.equal(state[1], slots[14].id, 'black keys never select a destination');
}
send(36, 100, 0x99); assert.equal(state[1], slots[14].id, 'chord pads do not select sources');
send(90); assert.equal(state[1], slots[14].id, 'unassigned key notes are ignored');
engine.channels.delete(slots[14].id);
engine.setTravelerSource(slots[14].id); advance();
assert.ok(gains().every(([, value]) => value === 0), 'missing selected stream never unmutes other streams');
engine.addStream(slots[14].id, {}); advance();
assert.ok(engine.channels.get(slots[14].id).streamGain.gain.value > 0, 'reconnecting the same destination resumes it');
engine.setChordPadTight(false);
control.select(slots[0].id); advance();
assert.ok(engine.channels.get(slots[0].id).streamGain.gain.value > 0 && engine.channels.get(slots[0].id).streamGain.gain.value < .8, 'soft mode retains gain smoothing');
engine.setStreamPan(slots[0].id, .75);
engine.setStreamVolume(slots[0].id, .2);
storage.saveStreamSettings(slots[0].id, { ...storage.getStreamSettings(slots[0].id), pan: .75, volume: .2 });
storage.saveMasterVolume(.4);
assert.equal(JSON.parse(saved).streams[slots[0].id], undefined, 'Traveler edits never overwrite the normal mix');
assert.equal(storage.getStreamSettings(slots[0].id).pan, .75, 'reconnection sees temporary settings');
assert.equal(JSON.parse(saved).travelerVolumes[slots[0].id], .2, 'manual Traveler volume is saved separately');
assert.equal(storage.getSavedState().travelerVolumes[slots[0].id], .2, 'saved volume survives loading state');
control.toggle();
assert.equal(state[0], false);
assert.equal(engine.getStreamSolo(), 'original');
assert.equal(engine.getStreamPan(slots[0].id), -.3);
assert.equal(engine.getStreamVolume(slots[0].id), .8);
assert.equal(disconnected.length, 14, 'only mode-added destinations are disconnected');
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
assert.equal(connections.length, 30); assert.equal(disconnected.length, 28, 'repeated mode transitions are safe');
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
assert.equal(spectrumReads.size, 15, 'leaving Traveler restores analysis for every normal track');
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
console.log('World Traveler checks passed: fixed mappings, all fifteen connections, tight/soft switching, silent outages, reconnect, held chords, persistent manual gains, temporary tone edits, normal-mix restoration, repeated transitions.');
