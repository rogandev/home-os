// No environment reads, token fallback, redirect following, or automatic retries.
export function createBackend({origin,readerToken,writerToken,fetchImpl=fetch}) {
 const url=new URL(origin);
 if(url.protocol!=='https:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!readerToken||readerToken.length<32||writerToken&&(writerToken.length<32||writerToken===readerToken)) throw new Error('Dedicated HTTPS Home backend configuration required');
 return async(name,args,write)=>{
  const token=write?writerToken:readerToken;if(!token) throw Object.assign(new Error('Home write disabled'),{status:403});
  const response=await fetchImpl(new URL('/connector/home/execute',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({name,arguments:args})});
  const chunks=[];let bytes=0;
  for await(const chunk of response.body??[]) {bytes+=chunk.length;if(bytes>2*1024*1024) throw new Error('Home result exceeds limit');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid Home result');}
  if(!response.ok) throw Object.assign(new Error('Home request rejected'),{status:response.status,code:data.code});
  return data;
 };
}
