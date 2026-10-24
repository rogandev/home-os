import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import nock from 'nock';
import {createGateway} from '../../server/gateway.js';
const issuer='https://issuer.example.test';
const origin='https://example.test';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'fixture',use:'sig',alg:'RS256'};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
const cookies=response=>response.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');

test('actual OIDC code flow validates claims and enforces owner after session creation',async t=>{
 nock(issuer).persist().get('/.well-known/openid-configuration').reply(200,{issuer:issuer+'/',authorization_endpoint:issuer+'/authorize',token_endpoint:issuer+'/token',jwks_uri:issuer+'/jwks',response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post']});
 nock(issuer).persist().get('/.well-known/jwks.json').reply(200,{keys:[jwk]});
 t.after(()=>nock.cleanAll());
 for(const scenario of ['owner','wrong-owner','wrong-audience','expired','wrong-nonce','wrong-signature','wrong-state','missing-transaction-cookie']) await t.test(scenario,async t=>{
  let calls=0;
  const app=createGateway({origin,routes:[['/boards',['GET']]],env:{AUTH_BASE_URL:origin,AUTH_ISSUER_URL:issuer+'/',AUTH_CLIENT_ID:'fixture-client',AUTH_CLIENT_SECRET:'fixture-secret',AUTH_SESSION_SECRET:'s'.repeat(64),AUTH_ALLOWED_SUBJECT:'owner',ROGAN_API_TOKEN:'fixture-token'},fetchImpl:async()=>{calls++;return Response.json([]);}});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  const login=await fetch(base+'/api/auth/login',{redirect:'manual',headers:{'X-Forwarded-Proto':'https'}});
  assert.equal(login.status,302);
  const authorization=new URL(login.headers.get('location'));
  assert.equal(authorization.searchParams.get('prompt'),null);
  assert.equal(authorization.searchParams.get('scope'),'openid');
  assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  assert.ok(authorization.searchParams.get('code_challenge'));
  const now=Math.floor(Date.now()/1000);
  const payload={iss:issuer+'/',sub:scenario==='wrong-owner'?'other':'owner',aud:scenario==='wrong-audience'?'other-client':'fixture-client',iat:now-120,exp:scenario==='expired'?now-120:now+300,nonce:scenario==='wrong-nonce'?'other':authorization.searchParams.get('nonce')};
  const unsigned=encode({alg:'RS256',kid:'fixture'})+'.'+encode(payload);
  const signature=sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
  let tokenCalls=0;
  const tokenMock=nock(issuer).post('/token').reply((_uri,body)=>{
   tokenCalls++;
   const form=new URLSearchParams(typeof body==='string'?body:body);
   assert.equal(form.get('grant_type'),'authorization_code');
   assert.equal(form.get('client_id'),'fixture-client');
   assert.equal(form.get('client_secret'),'fixture-secret');
   assert.equal(form.get('redirect_uri'),origin+'/api/auth/callback');
   assert.ok(form.get('code_verifier'));
   assert.equal(createHash('sha256').update(form.get('code_verifier')).digest('base64url'),authorization.searchParams.get('code_challenge'));
   return [200,{token_type:'Bearer',access_token:'fixture-access',id_token:unsigned+'.'+(scenario==='wrong-signature'?'invalid':signature)}];
  });
  const callback=await fetch(base+'/api/auth/callback?code=fixture-code&state='+encodeURIComponent(scenario==='wrong-state'?'tampered':authorization.searchParams.get('state')),{redirect:'manual',headers:{Cookie:scenario==='missing-transaction-cookie'?'':cookies(login),'X-Forwarded-Proto':'https'}});
  if(['wrong-state','missing-transaction-cookie'].includes(scenario)){
   assert.equal(callback.status,400);assert.equal(tokenCalls,0);assert.equal(calls,0);
   nock.removeInterceptor({hostname:'issuer.example.test',proto:'https',path:'/token',method:'POST'});return;
  }
  assert.ok(tokenMock.isDone());
  if(!['owner','wrong-owner'].includes(scenario)){assert.equal(callback.status,400);assert.equal(calls,0);return;}
  assert.equal(callback.status,302);
  assert.equal(callback.headers.get('location'),'/api/auth/complete');
  assert.ok(callback.headers.getSetCookie().some(s=>s.startsWith('__Host-rogan-session=')&&s.includes('HttpOnly')&&s.includes('Secure')));
  const response=await fetch(base+'/api/data/boards',{headers:{Cookie:cookies(callback),'X-Forwarded-Proto':'https'}});
  assert.equal(response.status,scenario==='owner'?200:403);assert.equal(calls,scenario==='owner'?1:0);
  if(scenario==='owner') {
   const start=Date.now();
   let renewed=cookies(callback);
   // Each authenticated request rolls inactivity, but never the original eight-hour ceiling.
   for(const seconds of [3599,7198,10797,14396,17995,21594,25193,28792]) {
    t.mock.timers.enable({apis:['Date'],now:start+seconds*1000});
    try {
     const live=await fetch(base+'/api/auth/session',{headers:{Cookie:renewed,'X-Forwarded-Proto':'https'}});
     assert.equal(live.status,200,`rolling at ${seconds}`);
     assert.match((await live.json()).draftScope,/^[a-f0-9]{64}$/);
     renewed=cookies(live);
    } finally {t.mock.timers.reset();}
   }
   t.mock.timers.enable({apis:['Date'],now:start+28801*1000});
   try {assert.equal((await fetch(base+'/api/auth/session',{headers:{Cookie:renewed,'X-Forwarded-Proto':'https'}})).status,401);}
   finally {t.mock.timers.reset();}
   const switchLogin=await fetch(base+'/api/auth/switch',{redirect:'manual',headers:{'X-Forwarded-Proto':'https'}});
   assert.equal(new URL(switchLogin.headers.get('location')).searchParams.get('prompt'),'login');
   const completion=await fetch(base+'/api/auth/complete');
   assert.equal(completion.status,200);
   assert.match(completion.headers.get('content-security-policy'),/frame-ancestors 'none'/);
   assert.ok(!(await completion.text()).includes('fixture-token'));
  }
  if(['owner','wrong-owner'].includes(scenario)) {
   const cookie=cookies(callback);
   const deniedLogout=await fetch(base+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:'https://other.example.test','X-Forwarded-Proto':'https'}});
   assert.equal(deniedLogout.status,403);
   const logout=await fetch(base+'/api/auth/logout',{method:'POST',redirect:'manual',headers:{Cookie:cookie,Origin:origin,'X-Forwarded-Proto':'https'}});
   assert.equal(logout.status,302);
   assert.ok(logout.headers.getSetCookie().some(s=>s.startsWith('__Host-rogan-session=;')&&s.includes('Expires=Thu, 01 Jan 1970')));
   assert.equal((await fetch(base+'/api/auth/session')).status,401);
   t.mock.timers.enable({apis:['Date'],now:Date.now()+3_601_000});
   try {
    const expired=await fetch(base+'/api/data/boards',{headers:{Cookie:cookie,'X-Forwarded-Proto':'https'}});
    assert.equal(expired.status,401);assert.equal(calls,scenario==='owner'?1:0);
   } finally { t.mock.timers.reset(); }
  }
 });
});
