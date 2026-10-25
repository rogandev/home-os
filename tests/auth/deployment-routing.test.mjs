import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const rules=JSON.parse(readFileSync(new URL('../../vercel.json',import.meta.url))).rewrites;
test('production auth/data bypass function payload cap while previews fail closed',()=>{
 const external=rules.filter(r=>r.destination.startsWith('https:'));
 assert.equal(external.length,2);
 for(const kind of ['auth','data']){
  const r=external.find(r=>r.source===`/api/${kind}/:path*`);
  assert.deepEqual(r.has,[{type:'host',value:'home.timothyorogan.com'}]);
  assert.equal(r.destination,`https://rogan-session-gateway-production.up.railway.app/home/api/${kind}/:path*`);
  assert.ok(rules.indexOf(r)<rules.findIndex(x=>x.source==='/api/:path*'));
 }
 assert.equal(rules.find(r=>r.source==='/api/:path*').destination,'/api/gateway');
 assert.ok(!external.some(r=>r.source.includes('form')||r.source==='/(.*)'));
});
