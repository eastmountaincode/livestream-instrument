import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import webAudioEngine from 'web-audio-engine';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const modules = new Map(), effects = [];
let saved = JSON.stringify({ activeStreamIds: ['one'], streams: { one: { highPassFreq: 900, lowPassFreq: 1000, volume: .5 } } });
let displayed;
class TestContext extends webAudioEngine.RenderingAudioContext {
  constructor() { super({ sampleRate: 48000, numberOfChannels: 2 }); }
  createMediaElementSource() { const source = this.createOscillator(); source.start(); return source; }
}
const react = {
  useState: initial => { displayed = initial(); return [displayed, value => { displayed = value; }]; },
  useEffect: callback => effects.push(callback), useCallback: callback => callback,
};
function load(path) {
  const file = resolve(root,path);
  if (modules.has(file)) return modules.get(file).exports;
  const module = {exports:{}}; modules.set(file,module);
  const code = ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code, {module,exports:module.exports,console,AudioContext:TestContext,
    window:{setInterval:()=>1,clearInterval:()=>{},setTimeout:()=>1},setTimeout:()=>1,queueMicrotask:cb=>cb(),
    localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},
    require:name=>name==='react'?react:name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):require(name)}, {filename:file});
  return module.exports;
}
const {audioEngine:engine}=load('src/services/AudioEngine.ts');
const storage=load('src/services/storage.ts');
const {useGlobalFilters}=load('src/hooks/useGlobalFilters.ts');
assert.equal(storage.getGlobalFilters().highPassFreq,20,'old per-track filters are not inherited as hidden global cutoffs');
assert.equal(storage.getGlobalFilters().lowPassFreq,20000);
const control=useGlobalFilters();effects.forEach(fn=>fn());
engine.addStream('one',{});engine.addStream('two',{});
engine.noteOn(60,100,'chord-pad');
control.updateFilters({highPassFreq:300,lowPassFreq:2000});
engine.ctx.processTo(.1);
for (const ch of engine.channels.values()) {
  assert.equal(ch.highPassFreq,300);assert.equal(ch.lowPassFreq,2000);
  assert.ok(Math.abs(ch.highPassFilter.frequency.value-300)<1);
  const frequencies=new Float32Array([100,1000,8000]),high=new Float32Array(3),low=new Float32Array(3),phase=new Float32Array(3);
  ch.highPassFilter.getFrequencyResponse(frequencies,high,phase);
  ch.lowPassFilter.getFrequencyResponse(frequencies,low,phase);
  assert.ok(high[0]*low[0]<.13,'high pass attenuates low frequencies');
  assert.ok(high[1]*low[1]>.85,'midrange passes through');
  assert.ok(high[2]*low[2]<.07,'low pass attenuates high frequencies');
}
engine.addStream('new',{});
assert.equal(engine.channels.get('new').sourceLevelLowPass.frequency.value,2000,'analysis follows the same cutoffs');
assert.equal(engine.channels.get('new').highPassFilter.frequency.value,300,'new streams inherit global settings immediately');
engine.addStream('one',{});
assert.equal(engine.channels.get('one').lowPassFilter.frequency.value,2000,'reconnected streams inherit global settings');
assert.equal(storage.getGlobalFilters().highPassFreq,300,'global filters persist across storage reads');
assert.equal(storage.getStreamSettings('one').highPassFreq,900,'legacy settings retained for compatibility');
engine.setTravelerSource('two');control.updateFilters({highPassFreq:500,lowPassFreq:4000});engine.setTravelerSource(null);
assert.equal(engine.getGlobalFilters().highPassFreq,500,'global changes survive mode exit');
assert.equal(engine.getStreamLowPass('one'),4000);
control.updateFilters({highPassFreq:9000,lowPassFreq:1000});
assert.equal(displayed.highPassFreq,990,'crossed cutoffs remain ordered');
control.updateFilters({highPassFreq:NaN,lowPassFreq:Infinity});
assert.equal(engine.getGlobalFilters().highPassFreq,20);assert.equal(engine.getGlobalFilters().lowPassFreq,20000);
engine.setGlobalFilters({highPassFreq:1,lowPassFreq:100000});
assert.equal(engine.getGlobalFilters().highPassFreq,20);assert.equal(engine.getGlobalFilters().lowPassFreq,20000);
console.log('Global filter checks passed: audible filter response, all sources, new/reconnected sources, mode changes, persistence, legacy isolation, and cutoff bounds.');
