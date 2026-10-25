// Limit fan-out before sending requests; never retry a rejected operation.
export async function mapSettledReads(items, read, limit=2) {
  const results=new Array(items.length);let cursor=0;
  async function worker(){
    while(cursor<items.length){const index=cursor++;
      try{results[index]={status:'fulfilled',value:await read(items[index],index)};}
      catch(reason){results[index]={status:'rejected',reason};}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return results;
}
export async function mapReads(items,read){
  const results=await mapSettledReads(items,read);
  const failed=results.find(r=>r.status==='rejected');if(failed)throw failed.reason;
  return results.map(r=>r.value);
}
