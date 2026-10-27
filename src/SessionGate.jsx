import {createContext,useContext,useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import './signin.css';
import {blockSessionRequests} from './sessionFetch.js';


const AccountContext=createContext(null);
export function AccountControls(){
  const clearForExit=useContext(AccountContext);
  if(!clearForExit)return null;
  const item={display:'block',padding:'10px 12px',color:'inherit',textDecoration:'none',font:'inherit',background:'none',border:0,textAlign:'left',width:'100%',cursor:'pointer'};
  return <details style={{position:'relative',flexShrink:0,font:'12px system-ui',color:'var(--fb-text, #e2e8f0)'}}>
    <summary style={{cursor:'pointer',listStyle:'none',border:'1px solid rgba(129,140,248,.35)',background:'rgba(129,140,248,.12)',borderRadius:7,padding:'8px 10px'}}>Account</summary>
    <div style={{position:'absolute',right:0,top:'calc(100% + 6px)',minWidth:160,zIndex:50,border:'1px solid rgba(129,140,248,.35)',borderRadius:9,background:'var(--fb-panel, #171722)',boxShadow:'0 8px 24px #0004'}}>
      <a style={item} href="/api/auth/switch" target="_blank" rel="noopener noreferrer" onClick={clearForExit}>Switch account</a>
      <form method="post" action="/api/auth/logout" onSubmit={clearForExit} style={{margin:0}}><button style={item} type="submit">Sign out</button></form>
    </div>
  </details>;
}

const RETENTION_MS = 60 * 60 * 1000;
export default function SessionGate({children}) {
  const [status,setStatus]=useState('checking');
  const [mounted,setMounted]=useState(false);
  const [generation,setGeneration]=useState(0);
  const [discarded,setDiscarded]=useState(false);
  const scope=useRef(null), deadline=useRef(0), request=useRef(0), alive=useRef(true);
  const statusRef=useRef(status), dialogs=useRef([]);
  statusRef.current=status;
  const discard=useCallback(()=>{
    scope.current=null;deadline.current=0;dialogs.current=[];
    setMounted(false);setGeneration(n=>n+1);setDiscarded(true);
  },[]);
  const check=useCallback(async()=>{
    const id=++request.current;
    try {
      const response=await fetch('/api/auth/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});
      const data=response.ok?await response.json():null;
      if(!alive.current||id!==request.current)return;
      if(response.ok&&data?.authenticated===true&&/^[a-f0-9]{64}$/.test(data.draftScope)) {
        if(scope.current&&scope.current!==data.draftScope) discard();
        if(deadline.current&&Date.now()>=deadline.current) discard();
        scope.current=data.draftScope;deadline.current=0;
        blockSessionRequests(false);setMounted(true);setStatus('ready');
      } else {
        blockSessionRequests(true);
        setStatus(response.status===403?'denied':response.status===401?'signed-out':'unavailable');
      }
    } catch {if(alive.current&&id===request.current){blockSessionRequests(true);setStatus('unavailable');}}
  },[discard]);
  useEffect(()=>{
    alive.current=true;blockSessionRequests(true);check();
    const expired=()=>{blockSessionRequests(true);++request.current;setStatus('signed-out');};
    // No timer/heartbeat requests. Focus and completed login only check a locked tab.
    const recheck=()=>{if(statusRef.current!=='ready')check();};
    const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('rogan-sign-in'):null;
    if(channel)channel.onmessage=e=>{if(e.data==='complete')recheck();};
    window.addEventListener('rogan-session-ended',expired);
    window.addEventListener('focus',recheck);
    const visible=()=>{if(document.visibilityState==='visible')recheck();};
    document.addEventListener('visibilitychange',visible);
    return ()=>{alive.current=false;++request.current;channel?.close();window.removeEventListener('rogan-session-ended',expired);window.removeEventListener('focus',recheck);document.removeEventListener('visibilitychange',visible);};
  },[check]);
  useLayoutEffect(()=>{
    if(status!=='ready') {
      for(const dialog of document.querySelectorAll('dialog[open]')) {
        if(typeof dialog.close==='function'){dialogs.current.push(dialog);dialog.close();}
      }
    } else {
      for(const dialog of dialogs.current)if(dialog.isConnected&&!dialog.open)dialog.showModal();
      dialogs.current=[];
    }
  },[status]);
  useEffect(()=>{
    if(status==='ready'||!mounted)return;
    if(!deadline.current)deadline.current=Date.now()+RETENTION_MS;
    const timer=setTimeout(discard,Math.max(0,deadline.current-Date.now()));
    return ()=>clearTimeout(timer);
  },[status,mounted,discard]);
  useEffect(()=>{
    if(!mounted||status==='ready')return;
    const warn=e=>{e.preventDefault();e.returnValue='';};
    window.addEventListener('beforeunload',warn);
    return ()=>window.removeEventListener('beforeunload',warn);
  },[mounted,status]);
  function clearForExit(event) {
    if(mounted&&!window.confirm('Discard unsaved work in this tab? Saved records and existing recovery journals are kept.')){event.preventDefault();return false;}
    ++request.current;blockSessionRequests(true);
    // Keep a submitting form connected until the browser performs its native POST.
    // Successful logout navigation destroys this document and its memory-only drafts.
    if(event.type!=='submit'){discard();setStatus('signed-out');}
    return true;
  }
  return <>
    {status==='ready'?null:<main className="signin-shell" aria-label="Home OS sign-in"><section className="signin-card">
      <div className="signin-brand"><span className="signin-mark" aria-hidden="true">H</span>Home OS</div>
      <p className="signin-eyebrow">Your private space</p>
      <h1>{status==='checking'?'Checking sign-in…':'Sign in to continue'}</h1>
      <p>A little order. A calmer home.</p>
      {status==='denied'&&<p className="signin-message" role="alert">This account does not have access. Your existing work stays locked.</p>}
      {status==='unavailable'&&<p className="signin-message" role="alert">Sign-in is temporarily unavailable. No pending operation will be retried automatically.</p>}
      {mounted&&<p className="signin-message">Unsaved work is held privately in this tab for up to one hour while locked. Keep this tab open; closing or reloading it loses unsaved drafts.</p>}
      {discarded&&<p className="signin-message">Unsaved work in this tab was cleared. Saved records and existing recovery journals are unchanged.</p>}
      {status==='checking'?<p className="signin-loading" role="status">Connecting to your account</p>:<>
        <div className="signin-actions">
          <a className="signin-primary" href="/api/auth/login" target="_blank" rel="noopener noreferrer">Sign in</a>
          <button className="signin-secondary" type="button" onClick={check}>Check sign-in</button>
        </div>
        <p className="signin-note">Sign-in opens separately. Return here when finished. If you cancel, you can try again whenever you’re ready.</p>
        <div className="signin-links">
          <a href="/api/auth/switch" target="_blank" rel="noopener noreferrer" onClick={clearForExit}>Try another account</a>
          <form method="post" action="/api/auth/logout" onSubmit={clearForExit}><button type="submit">Sign out</button></form>
        </div>
      </>}
    </section></main>}
    {mounted&&<div key={generation} hidden={status!=='ready'} inert={status!=='ready'?'':undefined} aria-hidden={status!=='ready'?true:undefined}><AccountContext.Provider value={clearForExit}>{children}</AccountContext.Provider></div>}
  </>;
}
