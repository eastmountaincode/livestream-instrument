import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
const file=new URL('../src/components/TrackWaveform.tsx', import.meta.url);
let effect, analyser=null, next=0, fills=0;
const frames=new Map();
const ctx={clearRect(){},fillRect(){fills++;},beginPath(){},moveTo(){},lineTo(){},stroke(){}};
const canvas={width:92,height:53,getContext:()=>ctx};
const module={exports:{}};
runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
 module,exports:module.exports,
 require(name){if(name==='react') return {useRef:initial=>({current:initial===null?canvas:initial}),useEffect:fn=>effect=fn};if(name==='react/jsx-runtime') return {jsx:()=>null};return {audioEngine:{getStreamAnalyser:()=>analyser}};},
 getComputedStyle:()=>({getPropertyValue:()=>''}),
 requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
});
module.exports.TrackWaveform({id:'orca',muted:false});const cleanup=effect();
const tick=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
assert.equal(fills,1,'draw baseline while connection pending');
let firstReads=0,secondReads=0;
analyser={fftSize:256,getByteTimeDomainData:data=>{firstReads++;data.fill(160);}};tick();
assert.equal(firstReads,1,'late analyser appears without a component remount');
analyser=null;tick();assert.equal(firstReads,1,'disconnected analyser no longer read');
analyser={fftSize:512,getByteTimeDomainData:data=>{secondReads++;assert.equal(data.length,512);data.fill(150);}};tick();
assert.equal(secondReads,1,'reconnection uses the replacement analyser');
cleanup();assert.equal(frames.size,0,'animation cancelled on unmount');
console.log('PASS: pending connection, late analyser, reconnect, buffer resize, cleanup');
