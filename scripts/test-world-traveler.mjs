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
  useRef: current => ({ current }), useCallback: callback => callback,
  useEffect: callback => { effects.push(callback); },
};
class TestAudioContext extends webAudioEngine.RenderingAudioContext {
  constructor() { super({ sampleRate: 48000, numberOfChannels: 2 }); }
  createMediaElementSource() {
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
const { WORLD_TRAVELER_SOURCES: slots } = load('src/music/worldTraveler.ts');
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
  sources: slots.map(slot => ({ ...slot, name: slot.label })), wantedIds: wanted, activeIds: wanted,
  connect: async source => { connections.push(source.id); if (!engine.channels.has(source.id)) engine.addStream(source.id, {}); },
  disconnect: id => { disconnected.push(id); engine.channels.delete(id); },
});
const cleanups = effects.map(effect => effect()).filter(Boolean);
const advance = () => engine.ctx.processTo(engine.ctx.currentTime + .003);
const gains = () => Array.from(engine.channels, ([id, ch]) => [id, ch.streamGain.gain.value]);
const send = (note, velocity = 100, status = 0x99) => midiService.handleMidiMessageEvent({ data: Uint8Array.from([status, note, velocity]), timeStamp: 0 });
control.toggle();
assert.equal(state[0], true);
assert.equal(connections.length, 8, 'connect all fixed destinations');
advance();
for (const [id, value] of gains()) assert.equal(value, id === slots[0].id ? .8 : 0, 'background sources are silent');
for (let i = 0; i < 8; i++) {
  send(36 + i, i + 1); advance();
  assert.equal(state[1], slots[i].id, 'quiet pad hits select the corresponding destination');
  for (const [id, value] of gains()) assert.equal(value, id === slots[i].id ? engine.getStreamVolume(id) : 0, 'Tight switches without a fade');
  send(36 + i, 0); assert.equal(state[1], slots[i].id, 'release keeps destination selected');
}
assert.deepEqual(Array.from(engine.activeNotes.keys()), originalNotes, 'source switching preserves the held chord');
send(90); assert.equal(state[1], slots[7].id, 'unassigned pad notes are ignored');
engine.channels.delete(slots[7].id);
engine.setTravelerSource(slots[7].id); advance();
assert.ok(gains().every(([, value]) => value === 0), 'missing selected stream never unmutes other streams');
engine.addStream(slots[7].id, {}); advance();
assert.ok(engine.channels.get(slots[7].id).streamGain.gain.value > 0, 'reconnecting the same destination resumes it');
engine.setChordPadTight(false);
control.select(slots[0].id); advance();
assert.ok(engine.channels.get(slots[0].id).streamGain.gain.value > 0 && engine.channels.get(slots[0].id).streamGain.gain.value < .8, 'soft mode retains gain smoothing');
engine.setStreamPan(slots[0].id, .75);
engine.setStreamVolume(slots[0].id, .2);
storage.saveStreamSettings(slots[0].id, { ...storage.getStreamSettings(slots[0].id), pan: .75, volume: .2 });
storage.saveMasterVolume(.4);
assert.equal(JSON.parse(saved).streams[slots[0].id], undefined, 'temporary edits never enter saved session');
assert.equal(storage.getStreamSettings(slots[0].id).pan, .75, 'reconnection sees temporary settings');
control.toggle();
assert.equal(state[0], false);
assert.equal(engine.getStreamSolo(), 'original');
assert.equal(engine.getStreamPan(slots[0].id), -.3);
assert.equal(engine.getStreamVolume(slots[0].id), .8);
assert.equal(disconnected.length, 7, 'only mode-added destinations are disconnected');
assert.equal(storage.getStreamSettings(slots[0].id), null, 'temporary settings discarded');
assert.equal(JSON.parse(saved).masterVolume, .4, 'other intentional preference changes survive');
assert.deepEqual(JSON.parse(saved).activeStreamIds, ['original', slots[0].id]);
send(37); assert.equal(state[0], false, 'pad subscription is inert outside the mode');
connections = []; disconnected = [];
control.toggle(); control.toggle();
assert.equal(connections.length, 8); assert.equal(disconnected.length, 7, 'repeated mode transitions are safe');
for (const cleanup of cleanups) cleanup();
console.log('World Traveler checks passed: fixed mappings, all eight connections, tight/soft switching, silent outages, reconnect, held chords, session-only edits, restoration, repeated transitions.');
