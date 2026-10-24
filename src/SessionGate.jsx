import {useEffect,useState} from 'react';

export default function SessionGate({children}) {
  const [status,setStatus]=useState('checking');
  useEffect(()=> {
    let live=true;
    const expired=()=>setStatus('signed-out');
    window.addEventListener('rogan-session-ended',expired);
    fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error'})
      .then(async response=> {
        const data=response.ok ? await response.json() : null;
        if(live)setStatus(response.ok && data?.authenticated === true ? 'ready' : response.status===401 ? 'signed-out' : response.status===403 ? 'denied' : 'unavailable');
      }).catch(()=>{if(live)setStatus('unavailable');});
    return ()=>{live=false;window.removeEventListener('rogan-session-ended',expired);};
  },[]);
  if(status==='ready')return <><div style={{textAlign:'right',padding:'8px'}}><form method="post" action="/api/auth/logout"><button type="submit">Sign out</button></form></div>{children}</>;
  return <main style={{maxWidth:480,margin:'15vh auto',padding:24,fontFamily:'system-ui'}}>
    <h1>{status==='checking'?'Checking sign-in…':'Sign in to continue'}</h1>
    {status==='signed-out' && <><p>Your data is available after you sign in.</p><a href="/api/auth/login">Sign in</a></>}
    {status==='denied' && <><p>This account does not have access.</p><a href="/api/auth/login">Try another account</a></>}
    {status==='unavailable' && <><p>Sign-in is temporarily unavailable. Your data has not been changed.</p><button onClick={()=>window.location.reload()}>Retry</button></>}
  </main>;
}
