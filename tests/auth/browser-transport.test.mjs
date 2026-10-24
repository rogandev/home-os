import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFetch,blockSessionRequests} from '../../src/sessionFetch.js';
test('browser transport removes bearer credentials, uses same-origin sessions and never retries', async t=> {
 const calls=[];const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async (url,options)=>{calls.push({url,options});return Response.json({ok:true});};
 await sessionFetch('/api/data/boards',{headers:{Authorization:'Bearer fixture'},credentials:'include'});
 assert.equal(calls.length,1);assert.equal(calls[0].options.headers.get('Authorization'),null);
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(sessionFetch('https://other.invalid/data'),/Invalid/);
 await assert.rejects(sessionFetch('/api/data/boards',{body:'x'.repeat(20 * 1024 * 1024 + 1)}),/No request was sent/);
 assert.equal(calls.length,1);
});

test('expiry blocks further background reads and writes until verified reentry; no replay',async t=>{
 const oldFetch=globalThis.fetch,oldWindow=globalThis.window;let calls=0,events=0;
 t.after(()=>{globalThis.fetch=oldFetch;globalThis.window=oldWindow;blockSessionRequests(false);});
 globalThis.window={dispatchEvent:()=>events++};
 globalThis.fetch=async()=>{calls++;return Response.json({error:'expired'},{status:401});};
 assert.equal((await sessionFetch('/api/data/boards')).status,401);
 assert.equal(events,1);assert.equal(calls,1);
 assert.equal((await sessionFetch('/api/data/boards')).status,401);
 assert.equal((await sessionFetch('/api/data/boards',{method:'POST',body:'{}'})).status,401);
 assert.equal(calls,1);
 blockSessionRequests(false);assert.equal(calls,1);
});

 test('large UTF-8 imports retain exact content and are sent once',async t=>{
 const previous=globalThis.fetch;let calls=0;
 t.after(()=>{globalThis.fetch=previous;blockSessionRequests(false);});
 blockSessionRequests(false);
 const body=JSON.stringify({operationId:'stable-import',data:'x'.repeat(19*1024*1024)});
 globalThis.fetch=async(_url,options)=>{calls++;assert.equal(options.body,body);return Response.json({ok:true});};
 await sessionFetch('/api/data/fixture/import',{method:'POST',body});
 assert.equal(calls,1);
 await assert.rejects(sessionFetch('/api/data/fixture/import',{method:'POST',body:'é'.repeat(11*1024*1024)}),/No request was sent/);
 assert.equal(calls,1);
 });
