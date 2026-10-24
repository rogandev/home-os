import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createGateway} from '../../server/gateway.js';
import {sessionFetch,blockSessionRequests} from '../../src/sessionFetch.js';
const origin='https://kanban.timothyorogan.com';
const env={AUTH_BASE_URL:origin,AUTH_ISSUER_URL:'https://issuer.example.test/',AUTH_CLIENT_ID:'fixture-client',AUTH_CLIENT_SECRET:'fixture-secret',AUTH_SESSION_SECRET:'s'.repeat(64),AUTH_ALLOWED_SUBJECT:'fixture-owner',ROGAN_API_TOKEN:'fixture-token'};
const digest=s=>createHash('sha256').update(s).digest('hex');
async function fixture(t,fetchImpl){
 const app=createGateway({origin,env,routes:[['/boards/fixture/trello-import/apply',['POST']],['/boards/fixture/export',['GET']]],authFactory:()=> (req,res,next)=>{req.oidc={isAuthenticated:()=>true,user:{sub:'fixture-owner'}};next();},fetchImpl});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));return `http://127.0.0.1:${server.address().port}/api/data/boards/fixture`;
}
test('standalone gateway preserves a 19 MiB import in one upstream operation',async t=>{
 const body=JSON.stringify({operationId:'fixture-import',expectedFingerprint:'fixture',bundle:{padding:'x'.repeat(19*1024*1024)}});let calls=0;
 const base=await fixture(t,async(_url,options)=>{calls++;assert.equal(digest(options.body),digest(body));return Response.json({operationId:'fixture-import',counts:{cards:1}});});
 const realFetch=globalThis.fetch;
 t.after(()=>{globalThis.fetch=realFetch;blockSessionRequests(false);});
 blockSessionRequests(false);
 globalThis.fetch=(_url,options)=>realFetch(base+'/trello-import/apply',{...options,headers:{...Object.fromEntries(options.headers),Origin:origin,'Content-Type':'application/json'}});
 const response=await sessionFetch('/api/data/boards/fixture/trello-import/apply',{method:'POST',body});
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal((await response.json()).operationId,'fixture-import');
});
test('standalone gateway returns complete large export without truncation',async t=>{
 const responseBody=JSON.stringify({snapshot:{cards:[{id:'fixture',description:'y'.repeat(24*1024*1024)}]},fingerprint:'fixture'});
 const base=await fixture(t,async()=>new Response(responseBody,{headers:{'Content-Type':'application/json'}}));
 const response=await fetch(base+'/export');assert.equal(response.status,200);assert.equal(digest(await response.text()),digest(responseBody));
});

test('oversized request is rejected before upstream, with no write replay',async t=>{
 let calls=0;const base=await fixture(t,async()=>{calls++;return Response.json({ok:true});});
 const response=await fetch(base+'/trello-import/apply',{method:'POST',headers:{Origin:origin,'X-Rogan-Request':'1','Content-Type':'application/json'},body:JSON.stringify({data:'x'.repeat(20*1024*1024)})});
 assert.equal(response.status,413);assert.equal(calls,0);
});
test('oversized chunked response is cancelled rather than truncated or retried',async t=>{
 let calls=0,cancelled=false;
 const base=await fixture(t,async()=>{calls++;return new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}});});
 const response=await fetch(base+'/export');
 assert.equal(response.status,502);assert.equal(calls,1);assert.equal(cancelled,true);
 assert.deepEqual(await response.json(),{error:'The data service is unavailable. Refresh and review before retrying a write.'});
});
