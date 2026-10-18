import assert from 'node:assert/strict';
import relay from '../ops/stream-relay/src/index.js';
const original = globalThis.fetch; const requests = [];
try {
 globalThis.fetch = async (url, options) => { requests.push({ url, options }); return new Response(new Uint8Array([1,2,3,4]), { headers: { 'Content-Type': 'audio/mpeg' } }); };
 const response = await relay.fetch(new Request('https://relay.test/?url='+encodeURIComponent('http://locus.creacast.com:9001/acra_wave_farm.mp3')));
 assert.equal(response.status, 200); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1,2,3,4]);
 assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
 for (const url of ['http://127.0.0.1/private', 'http://user:pass@locus.creacast.com:9001/private', 'https://s3-us-west-2.amazonaws.com/private/file']) {
  assert.equal((await relay.fetch(new Request('https://relay.test/?url='+encodeURIComponent(url)))).status, 403);
 }
 assert.equal(requests.length, 1);
 globalThis.fetch = async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
 assert.equal((await relay.fetch(new Request('https://relay.test/?url='+encodeURIComponent('http://locus.creacast.com:9001/acra_wave_farm.mp3')))).status, 403);
 console.log('PASS stream relay: audio bytes, CORS, source allowlist and redirect validation');
} finally { globalThis.fetch = original; }
