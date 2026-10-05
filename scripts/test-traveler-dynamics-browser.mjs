// Run this server, then open its URL in a real browser. web-audio-engine's
// DynamicsCompressor is a pass-through, so it cannot verify this processing.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const modules = ['travelerDynamics', 'audioOutputRouter', 'audioOutput'];
const compiled = new Map(modules.map(name => [ `/${name}.js`, ts.transpileModule(
  readFileSync(new URL(`../src/services/${name}.ts`, import.meta.url), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
).outputText.replaceAll('"./audioOutput"', '"./audioOutput.js"') ]));
const html = String.raw`<!doctype html><meta charset="utf-8"><title>Traveler dynamics verification</title>
<style>body{font:16px system-ui;margin:32px}pre{white-space:pre-wrap}</style>
<h1>Traveler dynamics verification</h1><button id="run">Run audio checks</button><pre id="results">Ready. Tests render offline; no sound is played.</pre>
<script type="module">
import {createTravelerDynamics, TRAVELER_PEAK_CEILING} from './travelerDynamics.js';
import {createAudioOutputRouter} from './audioOutputRouter.js';
const results=document.querySelector('#results');
const rms=(data,start,end)=>Math.sqrt(data.slice(start,end).reduce((sum,x)=>sum+x*x,0)/(end-start));
const peak=data=>data.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
const check=(condition,message)=>{if(!condition)throw Error(message)};
async function render({enabled=true,channel='stereo',sampleRate=48000,signal,time=1,channels=2}){
 const ctx=new OfflineAudioContext(channels,Math.round(sampleRate*time),sampleRate);
 const dynamics=createTravelerDynamics(ctx),router=createAudioOutputRouter(ctx);
 dynamics.setEnabled(enabled);router.setPeakCeiling(enabled?TRAVELER_PEAK_CEILING:null);router.setChannel(channel);
 const source=ctx.createBufferSource(),buffer=ctx.createBuffer(2,ctx.length,sampleRate);
 for(let c=0;c<2;c++)for(let i=0;i<ctx.length;i++)buffer.getChannelData(c)[i]=signal(i/sampleRate,c,i);
 source.buffer=buffer;source.connect(dynamics.input);dynamics.output.connect(router.input);source.start();
 return {buffer:await ctx.startRendering(),sampleRate};
}
document.querySelector('#run').onclick=async()=>{
 results.textContent='Running offline audio checks…';const lines=[];
 try{
  for(const sampleRate of [44100,48000]){
   const quiet=t=>.001*Math.sin(2*Math.PI*440*t);
   const normal=await render({enabled:false,sampleRate,signal:quiet});
   const active=await render({sampleRate,signal:quiet});
   const start=Math.floor(sampleRate*.5),end=Math.floor(sampleRate*.9);
   const normalRms=rms(normal.buffer.getChannelData(0),start,end),quietRms=rms(active.buffer.getChannelData(0),start,end);
   const quietRatio=quietRms/normalRms;
   check(quietRatio>.97&&quietRatio<1.02,'quiet gain changed: '+quietRatio);
   const loud=await render({sampleRate,signal:t=>.5*Math.sin(2*Math.PI*440*t)});
   const loudRatio=rms(loud.buffer.getChannelData(0),start,end)/(.5/Math.sqrt(2));
   check(loudRatio<.6,'loud sustained sound was not compressed: '+loudRatio);
   const step=await render({sampleRate,signal:t=>(t<.3?.5:.001)*Math.sin(2*Math.PI*440*t)});
   const recovered=rms(step.buffer.getChannelData(0),Math.floor(sampleRate*.5),Math.floor(sampleRate*.7))/normalRms;
   check(recovered>.95&&recovered<1.02,'quiet recovery did not settle in 200 ms: '+recovered);
   check(peak(step.buffer.getChannelData(0))<=TRAVELER_PEAK_CEILING+1e-6,'step exceeded ceiling');
   lines.push('PASS '+sampleRate+' Hz: quiet gain '+quietRatio.toFixed(3)+', loud gain '+loudRatio.toFixed(3)+', 200 ms recovery '+recovered.toFixed(3));
  }
  for(const channel of ['stereo','left','right','pair-15']){
   const data=await render({channel,channels:16,signal:(t,c,i)=>i%500===0?32:8*Math.sin(2*Math.PI*220*t),time:.3});
   let max=0;for(let c=0;c<16;c++)max=Math.max(max,peak(data.buffer.getChannelData(c)));
   check(max>0,'route is silent: '+channel);check(max<=TRAVELER_PEAK_CEILING+1e-6,'overload exceeded ceiling on '+channel+': '+max);
   const expected=channel==='pair-15'?[14,15]:channel==='left'?[0]:channel==='right'?[1]:[0,1];
   for(let c=0;c<16;c++)if(!expected.includes(c))check(peak(data.buffer.getChannelData(c))===0,'leaked onto channel '+c);
   lines.push('PASS '+channel+': overload peak '+(20*Math.log10(max)).toFixed(2)+' dBFS; unassigned channels silent');
  }
  const bypass=await render({enabled:false,signal:t=>2*Math.sin(2*Math.PI*440*t)});
  check(peak(bypass.buffer.getChannelData(0))>1.99,'normal mode was limited');
  lines.push('PASS normal mode: extra dynamics and ceiling bypassed');
  results.textContent=lines.join('\n')+'\nALL CHECKS PASSED';
 }catch(error){results.textContent=lines.join('\n')+'\nFAIL: '+error.stack;}
};
</script>`;
createServer((req,res)=>{
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}
 else if(compiled.has(req.url)){res.setHeader('Content-Type','text/javascript');res.end(compiled.get(req.url));}
 else{res.statusCode=404;res.end();}
}).listen(8766,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8766 and run the offline audio checks.'));
