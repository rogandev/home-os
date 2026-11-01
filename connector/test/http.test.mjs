import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttpServer} from '../src/http.js';

test('HTTP authenticates discovery/calls, challenges write scope, bounds input and rejects origins',async t=>{
 let calls=0;
 const server=createHttpServer({resourceUrl:'https://home-mcp.invalid/mcp',issuerUrl:'https://issuer.invalid/',allowedSubject:'fixture',writeEnabled:true,
  verifyToken:async token=>{if(token==='bad')throw new Error('bad');return {subject:'fixture',scopes:token==='writer'?['home:read','home:write']:['home:read']};},
  request:async()=>{calls++;return {data:[],revision:'a'.repeat(64)};}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const post=(body,token='reader',headers={})=>fetch(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:JSON.stringify(body)});
 const list={jsonrpc:'2.0',id:1,method:'tools/list',params:{}};
 assert.equal((await post(list,null)).status,401);assert.equal((await post(list,'bad')).status,401);
 assert.equal((await post(list,'reader',{Origin:'https://evil.invalid'})).status,403);
 assert.equal((await post({x:'x'.repeat(70000)})).status,413);
 const discovered=await (await post(list)).json();assert.ok(discovered.result.tools.length>30);
 const denied=await (await post({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'receive_order',arguments:{}}})).json();assert.equal(denied.result.isError,true);assert.equal(calls,0);
 await post({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'list_items',arguments:{}}},'writer');assert.equal(calls,1);
 const metadata=await (await fetch(origin+'/.well-known/oauth-protected-resource/mcp')).json();assert.deepEqual(metadata.scopes_supported,['home:read','home:write']);
});
