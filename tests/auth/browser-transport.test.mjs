import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionFetch} from '../../src/sessionFetch.js';
test('browser transport removes bearer credentials, uses same-origin sessions and never retries', async t=> {
 const calls=[];const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async (url,options)=>{calls.push({url,options});return Response.json({ok:true});};
 await sessionFetch('/api/data/boards',{headers:{Authorization:'Bearer fixture'},credentials:'include'});
 assert.equal(calls.length,1);assert.equal(calls[0].options.headers.get('Authorization'),null);
 assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');
 await assert.rejects(sessionFetch('https://other.invalid/data'),/Invalid/);
 await assert.rejects(sessionFetch('/api/data/boards',{body:'x'.repeat(4_000_001)}),/No request was sent/);
 assert.equal(calls.length,1);
});
