import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import console from 'node:console';
import ts from 'typescript';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modules = new Map();
const hooks = []; let cursor = 0; let pending = [];
const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const react = {
  useState: initial => { const i = cursor++; hooks[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [hooks[i].value, value => { hooks[i].value = typeof value === 'function' ? value(hooks[i].value) : value; }]; },
  useRef: current => { const i = cursor++; hooks[i] ??= { current }; return hooks[i]; },
  useCallback: fn => { cursor++; return fn; },
  useMemo: fn => { cursor++; return fn(); },
  useEffect: (fn, deps) => { const i = cursor++; if (!equal(hooks[i]?.deps, deps)) pending.push(() => { hooks[i]?.cleanup?.(); hooks[i] = { deps, cleanup: fn() }; }); },
};
const sounding = new Map(); let rawAttacks = 0;
const audioEngine = {
  isStreamConnected: () => true, setChordPadTight: () => {}, updateNoteSourceVelocity: () => {}, setPitchBendSemitones: () => {},
  noteOn: (note, velocity, source) => { if (source === 'midi') rawAttacks++; sounding.set(`${source}:${note}`, velocity); return true; },
  noteOff: (note, source) => sounding.delete(`${source}:${note}`),
  allNotesOff: source => { for (const key of sounding.keys()) if (key.startsWith(`${source}:`)) sounding.delete(key); },
};
let saved = null;
function load(path) {
  const filename = resolve(root, path);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} }; modules.set(filename, module);
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(code, {
    module, exports: module.exports, console, performance: { now: () => 100 },
    localStorage: { getItem: () => saved, setItem: (_k, v) => { saved = v; } },
    window: { addEventListener: () => {}, removeEventListener: () => {}, setTimeout: () => 1, clearTimeout: () => {} },
    require: name => name === 'react' ? react : name.endsWith('/AudioEngine') ? { audioEngine } : name.endsWith('/WebRTCService') ? { webrtcService: { sendNoteOn: () => {}, sendNoteOff: () => {} } } : name.startsWith('.') ? load(resolve(dirname(filename), `${name}.ts`)) : require(name),
  }, { filename });
  return module.exports;
}
const { midiService } = load('src/services/MidiService.ts');
const storage = load('src/services/storage.ts');
const { buildChordNotes, buildRelatedChordBank } = load('src/music/chords.ts');
const { ChordPad } = load('src/components/ChordPad.tsx');
storage.saveChordBank(buildRelatedChordBank({ root: 4, type: 'min11', inversion: 0 }));
function render() { cursor = 0; pending = []; const tree = ChordPad({ streamConnected: true, inputVolume: 1, midiPadsEnabled: true }); pending.forEach(fn => fn()); return tree; }
const send = (note, velocity = 100, status = 0x99) => { midiService.handleMidiMessageEvent({ data: Uint8Array.from([status, note, velocity]), timeStamp: 0 }); return render(); };
const notes = () => [...sounding.keys()].filter(k => k.startsWith('chord-pad:')).map(k => +k.split(':')[1]);
function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.props.children === label) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const result = findButton(child, label); if (result) return result; }
  return null;
}
midiService.setKeyboardInputEnabled(false);
midiService.setKeyboardSelectionMode(true);
render();
const keys = [36, 37, 38, 39, 40, 41, 42, 43];
for (let i = 0; i < keys.length; i++) {
  send(keys[i], 1);
  assert.deepEqual(notes(), Array.from(buildChordNotes(storage.getChordBank()[i], 3)), `pad ${i + 1} chooses bank slot`);
  assert.ok([...sounding.values()].every(v => v === 100), 'soft pads use fixed chord velocity');
  send(keys[i], 0); assert.ok(notes().length, 'latched chord survives note off');
}
const before = notes();
for (let note = 48; note <= 79; note++) { send(note, 100, 0x90); send(note, 0, 0x90); }
assert.deepEqual(notes(), before, 'source keys and unused black keys preserve the current chord');
assert.equal(rawAttacks, 0, 'source keys never add ordinary keyboard voices');
send(43); assert.equal(notes().length, 0, 'latched repeat toggles chord off'); send(43, 0);
findButton(render(), 'Latch On').props.onClick(); render();
send(36); send(37); send(36, 0); assert.ok(notes().length, 'release of older pad does not cut new chord');
send(37, 0); assert.equal(notes().length, 0, 'momentary pad releases');
send(38); midiService.setKeyboardSelectionMode(false); render();
assert.ok(notes().length, 'leaving Traveler preserves the independent held pad chord'); send(38, 0);
send(48, 100, 0x90); assert.equal(rawAttacks, 0, 'normal keyboard Off preference restored');
midiService.setKeyboardInputEnabled(true); send(48, 100, 0x90); assert.equal(rawAttacks, 1, 'normal keyboard On plays individual notes');
midiService.setKeyboardSelectionMode(true); render();
assert.ok(![...sounding.keys()].some(k => k.startsWith('midi:')), 'mode entry releases held ordinary notes');
console.log('Traveler pad/key checks passed: eight pad chords, sixteen independent source keys, fixed velocity, latch, momentary releases, and normal-mode restoration.');
