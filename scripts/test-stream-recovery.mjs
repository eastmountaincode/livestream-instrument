import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const compiled = ts.transpileModule(fs.readFileSync(new URL('../src/hooks/useStreamPlayback.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function rig(resolveHls = async () => 'https://example.com/live.m3u8') {
  let now = 0, id = 0; const timers = new Map(), audios = [], hlsInstances = [];
  class Target { listeners = new Map(); addEventListener(k, f) { const a = this.listeners.get(k) || []; a.push(f); this.listeners.set(k, a); } removeEventListener(k, f) { this.listeners.set(k, (this.listeners.get(k) || []).filter(x => x !== f)); } emit(k) { for (const f of this.listeners.get(k) || []) f(); } }
  class Audio extends Target { currentTime = 0; paused = true; ended = false; error = null; readyState = 4; networkState = 2; constructor() { super(); audios.push(this); } setAttribute() {} removeAttribute() {} load() {} play() { this.paused = false; return Promise.resolve(); } pause() { this.paused = true; } }
  class Hls { static isSupported() { return true; } static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' }; static ErrorTypes = { NETWORK_ERROR: 'network', MEDIA_ERROR: 'media' }; starts = 0; constructor() { hlsInstances.push(this); } loadSource() {} attachMedia() {} once() {} on() {} startLoad() { this.starts++; } destroy() {} }
  const target = new Target(); Object.assign(target, { location: { protocol: 'https:' }, setTimeout: (fn, ms) => { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; }, clearTimeout: i => timers.delete(i), setInterval: (fn, ms) => { const key = ++id; timers.set(key, { fn, at: now + ms, repeat: ms }); return key; }, clearInterval: i => timers.delete(i) });
  const engine = new Proxy({}, { get: (_, k) => k === 'resume' ? async () => {} : k === 'getGlobalFilters' ? () => ({}) : () => 0 });
  const react = { useCallback: fn => fn, useEffect: fn => fn(), useRef: x => ({ current: x }), useState: initial => { let value = initial; return [value, x => { value = typeof x === 'function' ? x(value) : x; }]; } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, console, Audio, Date: { now: () => now }, window: target, document: target, require: n => ({ react, 'hls.js': { default: Hls }, '../services/AudioEngine': { audioEngine: engine }, '../services/streams': { getOrcasoundStreamUrl: resolveHls }, '../services/storage': { MAX_STREAM_VOLUME: 1, getStreamSettings: () => null } })[n] });
  const hook = module.exports.useStreamPlayback();
  async function advance(ms) { const until = now + ms; for (;;) { const entry = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!entry) break; const [key, t] = entry; now = t.at; if (t.repeat) t.at += t.repeat; else timers.delete(key); t.fn(); await Promise.resolve(); } now = until; }
  return { hook, audios, hlsInstances, target, timers, advance, progress: time => { const a = audios.at(-1); a.currentTime = time; a.emit('timeupdate'); } };
}
const source = { id: 'radio', url: 'http://example.com/radio', proxyUrl: '/api/stream-preview?url=radio' };
{
 const r = rig(); await r.hook.connect(source); r.progress(1);
 r.audios[0].emit('error'); r.progress(2); await r.advance(2000);
 assert.equal(r.audios.length, 1, 'resumed playback cancels scheduled replacement');
 r.hook.disconnect(source.id);
}
{
 const r = rig(); await r.hook.connect(source); r.progress(1);
 // Repeated events with the same playback position cannot mask a real stall.
 for (let i = 0; i < 8; i++) { r.audios[0].emit('timeupdate'); await r.advance(5000); }
 assert.equal(r.audios.length, 2, 'stalled media is rebuilt despite spurious timeupdate events');
 r.hook.disconnect(source.id);
}
{
 const r = rig(); await r.hook.connect(source, { reconnectAttempt: 5, hadSuccessfulPlayback: true });
 r.progress(1); await r.advance(10000); r.progress(11);
 r.audios[0].emit('error'); await r.advance(1600);
 assert.equal(r.audios.length, 2, 'healthy playback resets old exponential backoff');
 r.hook.disconnect(source.id);
}
{
 const r = rig(); await r.hook.connect({ id: 'hls', hlsUrl: 'https://example.com/live.m3u8' });
 r.progress(1); for (let i = 0; i < 30; i++) { r.target.emit('keydown'); r.target.emit('pointerdown'); }
 assert.equal(r.hlsInstances[0].starts, 0, 'playing an instrument never restarts healthy HLS loading');
 r.hook.disconnect('hls');
}
{
 let release; const r = rig(() => new Promise(resolve => { release = resolve; }));
 const opening = r.hook.connect({ id: 'hls', latestTxtUrl: 'https://example.com/latest.txt' });
 r.hook.disconnect('hls'); release('https://example.com/live.m3u8'); await opening;
 assert.equal(r.hlsInstances.length, 0, 'late resolution after disconnect cannot leak an orphan stream');
}
console.log('PASS stream recovery: resumed audio, real stalls, healthy backoff, performance keys, and cancelled HLS resolution');
