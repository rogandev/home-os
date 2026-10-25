import test from 'node:test';
import assert from 'node:assert/strict';
import {mapSettledReads,mapReads} from '../../src/readPool.js';
test('large inventory reads remain ordered, bounded and never retry failures',async()=>{
 let active=0,max=0;const calls=[];
 const results=await mapSettledReads(Array.from({length:100},(_,i)=>i),async i=>{
 calls.push(i);max=Math.max(max,++active);await new Promise(r=>setTimeout(r,1));active--;
 if(i===17)throw Error('unavailable');return i*2;
 });
 assert.equal(max,2);assert.equal(calls.length,100);assert.equal(results.length,100);
 assert.equal(results[17].status,'rejected');assert.equal(results[99].value,198);
 assert.deepEqual(await mapReads([3,1],async n=>n),[3,1]);
 await assert.rejects(mapReads([1],async()=>{throw Error('no retry')}),/no retry/);
});
