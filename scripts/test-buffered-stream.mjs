import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(new URL('../src/services/bufferedStream.ts', import.meta.url),'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function rig(chunks, initialEnd=0, currentTime=0) {
 const instances=[], appended=[], removals=[], revoked=[], errors=[];let fetches=0, reads=0, cancelled=0, released=0, fetchedSignal;
 class Buffer extends EventTarget {
  start=0;end=initialEnd;buffered={length:1,start:()=>this.start,end:()=>this.end};
  appendBuffer(data){appended.push([...data]);this.end+=3;queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}
  remove(start,end){removals.push([start,end]);this.start=end;queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}
 }
 class Media extends EventTarget {
  static isTypeSupported(type){return type==='audio/mpeg';} readyState='open';buffer=new Buffer();ended=false;
  constructor(){super();instances.push(this);}addSourceBuffer(){return this.buffer;}endOfStream(){this.ended=true;}
 }
 const module={exports:{}};
 vm.runInNewContext(code,{module,exports:module.exports,MediaSource:Media,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL:u=>revoked.push(u)},AbortController,Error,setTimeout,clearTimeout,fetch:async(_url,{signal})=>{fetches++;fetchedSignal=signal;return {ok:true,status:200,body:{getReader:()=>({read:async()=>{reads++;const value=chunks.shift();return value?{done:false,value}:{done:true};},cancel:async()=>{cancelled++;},releaseLock:()=>{released++;}})}};}});
 const audio={currentTime,src:''};const stop=module.exports.openBufferedStream(audio,'https://example.com/radio.mp3',()=>{},e=>errors.push(e));
 return {api:module.exports,audio,stop,instances,appended,removals,revoked,errors,get fetches(){return fetches;},get reads(){return reads;},get cancelled(){return cancelled;},get released(){return released;},get signal(){return fetchedSignal;}};
}
const flush=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};
{
 const r=rig([new Uint8Array([1,2]),new Uint8Array([3,4,5])]);
 r.instances[0].dispatchEvent(new Event('sourceopen'));await flush();
 assert.deepEqual(r.appended,[[1,2],[3,4,5]],'encoded audio stays byte-exact and ordered');
 assert.equal(r.instances[0].ended,true);assert.equal(r.cancelled,1);assert.equal(r.released,1);
 r.stop();assert.equal(r.signal.aborted,true);assert.deepEqual(r.revoked,['blob:test']);assert.equal(r.errors.length,0);
 assert.equal(r.api.supportsBufferedStream({url:'https://example.com/radio.mp3'}),true);
 assert.equal(r.api.supportsBufferedStream({url:'https://example.com/radio.ogg'}),false,'unsupported formats retain native playback');
}
{
 const r=rig([]);r.stop();await flush();assert.equal(r.fetches,0,'closing before sourceopen cannot leak a fetch');assert.equal(r.errors.length,0);
}
{
 const r=rig([new Uint8Array([1])],60,45);r.instances[0].dispatchEvent(new Event('sourceopen'));await flush();
 assert.deepEqual(r.removals,[[0,35]],'only already-played audio is evicted');r.stop();
}
{
 const r=rig([new Uint8Array([1])],60,0);r.instances[0].dispatchEvent(new Event('sourceopen'));await flush();
 assert.equal(r.reads,0,'full reserve applies backpressure before reading more audio');r.stop();await flush();assert.equal(r.errors.length,0);assert.equal(r.cancelled,1);
}
console.log('PASS buffered transport: byte continuity, bounded memory, played-data eviction, startup cancellation, and cleanup');
