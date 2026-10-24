import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createGateway,readConfig,resolveRoute} from '../../server/gateway.js';
import {routes} from '../../server/routes.js';

const origin='https://example.test';
const env={AUTH_BASE_URL:origin,AUTH_ISSUER_URL:'https://issuer.example.test/',AUTH_CLIENT_ID:'fixture-client',AUTH_CLIENT_SECRET:'fixture-client-secret',AUTH_SESSION_SECRET:'s'.repeat(64),AUTH_ALLOWED_SUBJECT:'fixture-owner',ROGAN_API_TOKEN:'fixture-server-only'};
const route=routes.find(([,methods])=>methods.includes('GET'))[0].replace(/\{[^}]+\}/g,'fixture-id');
const writeRoute=routes.find(([,methods])=>methods.includes('POST'))[0].replace(/\{[^}]+\}/g,'fixture-id');
async function fixture(t,{identity,fetchImpl,realAuth=false,config=env}={}) {
  const calls=[];
  const app=createGateway({origin,routes,env:config,
    ...(realAuth?{}:{authFactory:()=> (req,_res,next)=>{req.oidc={isAuthenticated:()=>Boolean(identity),user:{sub:identity}};next();}}),
    fetchImpl:fetchImpl || (async (url,options)=>{calls.push({url,options});return Response.json({ok:true});})});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  return {url:`http://127.0.0.1:${server.address().port}`,calls};
}
test('configuration fails closed, including accidental production credentials on a preview',()=>{
  assert.ok(readConfig(env,origin));
  assert.equal(readConfig({...env,VERCEL_ENV:'preview'},origin),null);
  for(const key of Object.keys(env))assert.equal(readConfig({...env,[key]:''},origin),null,key);
  assert.equal(readConfig(env,'https://preview.example.test'),null);
  assert.equal(readConfig({...env,AUTH_ISSUER_URL:'http://issuer.example.test'},origin),null);
});
test('missing configuration cannot forward requests',async t=>{
 const f=await fixture(t,{config:{},identity:'fixture-owner'});assert.equal((await fetch(f.url+'/api/data'+route)).status,503);assert.equal(f.calls.length,0);
});
test('unauthenticated and wrong identity requests never reach upstream',async t=>{
 for(const identity of [undefined,'another-account']) {
  const f=await fixture(t,{identity});const response=await fetch(f.url+'/api/data'+route);
  assert.equal(response.status,identity?403:401);assert.equal(f.calls.length,0);
 }
});
test('real SDK rejects missing and tampered session cookies',async t=>{
 const f=await fixture(t,{realAuth:true});
 for(const cookie of ['', '__Host-rogan-session=forged-session']) {
  const response=await fetch(f.url+'/api/data'+route,{headers:{Cookie:cookie}});assert.equal(response.status,401);
 }
 assert.equal(f.calls.length,0);
});
test('identity-checked reads use a fixed upstream and only server authorization',async t=>{
 const f=await fixture(t,{identity:'fixture-owner'});
 const response=await fetch(f.url+'/api/data'+route,{headers:{Authorization:'Bearer attacker',Cookie:'other=private','X-Forwarded-Host':'evil.example'}});
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store, private');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.headers.Authorization,'Bearer fixture-server-only');
 assert.equal(f.calls[0].options.headers.Cookie,undefined);assert.equal(f.calls[0].options.redirect,'error');
 assert.equal(f.calls[0].url,'https://flowboard-api-production-321b.up.railway.app'+route);
 assert.ok(!(await response.text()).includes('fixture-server-only'));
});
test('writes require exact Origin and custom header, not just same-site cookies',async t=>{
 const f=await fixture(t,{identity:'fixture-owner'});
 for(const headers of [{},{Origin:origin},{Origin:'https://sibling.example.test','X-Rogan-Request':'1'},{Origin:origin,'X-Rogan-Request':'1','Sec-Fetch-Site':'cross-site'}]) {
  assert.equal((await fetch(f.url+'/api/data'+writeRoute,{method:'POST',headers})).status,403);
 }
 assert.equal(f.calls.length,0);
 assert.equal((await fetch(f.url+'/api/data'+writeRoute,{method:'POST',headers:{Origin:origin,'X-Rogan-Request':'1','Content-Type':'application/json'},body:'{"fixture":true}'})).status,200);
 assert.equal(f.calls.length,1);
});
test('route allowlist denies traversal, external URLs, wrong methods and other domains',()=>{
 for(const path of ['/api/data/../health','/api/data/%2e%2e/health','/api/data//boards','/api/data/https://evil.test','/api/data/boards\\evil','/api/data/connector-main-write','/api/data/auth/login','/api/data/form'])
  assert.equal(resolveRoute(path,'GET',routes),null,path);
 assert.equal(resolveRoute('/api/data'+route,'TRACE',routes),null);
 for(const [pattern,methods] of routes)for(const method of methods) assert.ok(resolveRoute('/api/data'+pattern.replace(/\{[^}]+\}/g,'fixture-id'),method,routes));
});
test('write failures are sanitized and not retried',async t=>{
 let calls=0;const f=await fixture(t,{identity:'fixture-owner',fetchImpl:async()=>{calls++;throw Error('fixture-server-only');}});
 const response=await fetch(f.url+'/api/data'+writeRoute,{method:'POST',headers:{Origin:origin,'X-Rogan-Request':'1'}});
 assert.equal(response.status,502);assert.equal(calls,1);assert.ok(!(await response.text()).includes('fixture-server-only'));
});
test('business conflicts preserve their status and data',async t=>{
 const f=await fixture(t,{identity:'fixture-owner',fetchImpl:async()=>Response.json({error:'Revision conflict',revision:2},{status:409})});
 const response=await fetch(f.url+'/api/data'+route);assert.equal(response.status,409);assert.equal((await response.json()).revision,2);
});
