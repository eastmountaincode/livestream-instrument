import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import console from 'node:console';
import ts from 'typescript';

// Minimal React lifecycle host: exercise the actual output hook, including
// queued promises, effect teardown, and re-rendered device selections.
function harness({ delayed = false } = {}) {
  const slots = []; let cursor = 0, dirty = false, value, stopped = false;
  const effects = [], listeners = new Map(), writes = [];
  const same = (a, b) => a?.length === b?.length && a.every((x, i) => Object.is(x, b[i]));
  const react = {
    useRef: initial => { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState: initial => {
      const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; dirty = true; }];
    },
    useCallback: (fn, deps) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect: (fn, deps) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
    useSyncExternalStore: (_subscribe, get) => get(),
  };
  let release, connected = true;
  const device = { deviceId: 'blackhole', label: 'BlackHole 16ch' };
  const storage = new Map([['cicada.audio-output.v1', JSON.stringify(device)], ['cicada.audio-output-channel.v1', 'pair-3']]);
  const mediaDevices = { enumerateDevices: async () => [], addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const context = { console, DOMException, AudioContext: class { setSinkId() {} }, navigator: { mediaDevices }, window: { localStorage: { getItem: key => storage.get(key), setItem: (key, v) => storage.set(key, v) } } };
  function load(path, imports) {
    const module = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    runInNewContext(code, { ...context, exports: module.exports, module, require: name => imports[name] }); return module.exports;
  }
  const output = load('../src/services/audioOutput.ts', {});
  const { useAudioOutput } = load('../src/hooks/useAudioOutput.ts', { react, '../services/audioOutput': output });
  const applyOutput = async (id, pair) => { writes.push(['device', id, pair]); connected = false; if (delayed) await new Promise(resolve => { release = resolve; }); };
  const applyChannel = async pair => { writes.push(['pair', pair]); connected = true; };
  function render() { dirty = false; cursor = 0; value = useAudioOutput(applyOutput, applyChannel); for (const effect of effects.splice(0)) effect(); }
  async function settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (dirty && !stopped) render(); } }
  render();
  return { settle, writes, listeners, get value() { return value; }, get connected() { return connected; }, release: () => release(), unmount: () => { stopped = true; for (const slot of slots) slot?.cleanup?.(); } };
}
const normal = harness(); await normal.settle();
assert.equal(normal.connected, true);
assert.equal(normal.writes[0][2], 'pair-3', 'saved pair travels with the device restoration');
normal.writes.length = 0;
normal.listeners.get('devicechange')(); await normal.settle();
assert.equal(normal.connected, true, 'successful recovery after an incomplete device list reconnects audio');
assert.deepEqual(normal.writes, [['device', 'blackhole', 'pair-3'], ['pair', 'pair-3']]);
assert.equal(normal.value.error, null, 'successful recovery must not report an unavailable device');
normal.unmount();
const closing = harness({ delayed: true }); await closing.settle();
assert.equal(closing.connected, false);
closing.unmount(); closing.release(); await closing.settle();
assert.equal(closing.connected, true, 'teardown during an in-flight selection cannot strand the shared engine muted');
console.log('Output lifecycle checks passed: saved pair, device-list recovery, success status, and teardown during reconnection.');
