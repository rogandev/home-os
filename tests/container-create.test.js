import test from 'node:test';
import assert from 'node:assert/strict';
import { containerDraft, saveContainer } from '../src/container-create.js';
const locations = [{id:'bathroom',name:'Bathroom',isActive:true}];
const draft = {id:'container-fixture',locationId:'bathroom',name:'Bathroom drawer'};
function fixture(mode) {
  const rows=[], calls=[];
  let fail=true;
  return {rows,calls,request:async(path,options={})=>{
    calls.push({path,...options}); assert.equal(path,'/containers');
    if(options.method==='POST') {
      if(mode==='reject') throw Object.assign(Error('Invalid location'),{status:400});
      if(mode==='offline'&&fail){fail=false;throw Error('offline');}
      rows.push({...JSON.parse(options.body),isActive:true,isCompatibility:false});
      if(mode==='lost'&&fail){fail=false;throw Error('lost response');}
      return rows.at(-1);
    }
    return structuredClone(rows);
  }};
}
test('container validation requires a bounded name and active explicit room',()=>{
  for(const name of ['', ' ', 'x'.repeat(101)]) assert.throws(()=>containerDraft(name,'bathroom',locations,draft.id));
  assert.throws(()=>containerDraft('Drawer','missing',locations,draft.id));
  assert.throws(()=>containerDraft('Drawer','bathroom',[{...locations[0],isActive:false}],draft.id));
  assert.deepEqual(containerDraft(' Bathroom drawer ','bathroom',locations,draft.id),draft);
});
test('creation is read back and replay performs no second POST',async()=>{
  const f=fixture();assert.equal((await saveContainer(f.request,draft)).record.id,draft.id);
  assert.equal((await saveContainer(f.request,draft)).existing,true);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
  assert.equal(f.calls.at(-1).method,undefined);
});
test('same-room duplicate name reuses verified record, inactive duplicate refuses',async()=>{
  const f=fixture();f.rows.push({...draft,id:'other-id',name:'BATHROOM DRAWER',isActive:true});
  assert.equal((await saveContainer(f.request,draft)).record.id,'other-id');
  assert.equal(f.calls.some(c=>c.method==='POST'),false);
  f.rows[0].isActive=false;await assert.rejects(saveContainer(f.request,draft),/inactive/);
});
for(const mode of ['lost','offline']) test(`${mode} is reconciled before retry`,async()=>{
  const f=fixture(mode);
  if(mode==='offline') await assert.rejects(saveContainer(f.request,draft));
  assert.equal((await saveContainer(f.request,draft)).record.id,draft.id);
  assert.equal(f.rows.length,1);
  assert.ok(f.calls.every(c=>c.path==='/containers'));
});
test('definite server validation error is reported without retry',async()=>{
  const f=fixture('reject');await assert.rejects(saveContainer(f.request,draft),/Invalid location/);
  assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.rows.length,0);
});
test('successful POST with unavailable readback is not claimed verified',async()=>{
  let reads=0;await assert.rejects(saveContainer(async(_path,o={})=>{
    if(o.method==='POST')return {...draft,isActive:true};
    if(++reads===2)throw Error('read offline');return [];
  },draft),/read offline/);
});
