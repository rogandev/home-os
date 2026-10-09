import { useCallback, useEffect, useRef, useState } from "react";
import "./razors.css";

const localToday = () => { const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export default function RazorPanel({ request, manage=false, onChanged }) {
  const [data,setData]=useState(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[edit,setEdit]=useState(null),[action,setAction]=useState(null),[pending,setPending]=useState(null);
  const lock=useRef(false),generation=useRef(0),formRef=useRef(null);
  const activeFormId=action ? `${action.razor.id}:${action.entry?.id ?? "change"}` : edit?.id ?? null;
  useEffect(()=>{
    if(activeFormId){formRef.current?.focus({preventScroll:true});formRef.current?.scrollIntoView?.({block:"start"});}
  },[activeFormId]);
  const invalidate=useCallback(()=>{generation.current+=1;},[]);
  const refresh=useCallback(async()=>{
    const n=++generation.current;
    const next=await request(`/razors?today=${localToday()}`);
    if(n===generation.current) setData(next);
    return next;
  },[request]);
  useEffect(()=>{
    let active=true;
    const load=()=>refresh().catch(e=>{if(active)setError(e.message);});load();
    const resume=()=>{if(!document.hidden)load();};document.addEventListener("visibilitychange",resume);
    return ()=>{active=false;invalidate();document.removeEventListener("visibilitychange",resume);};
  },[refresh,invalidate]);
  async function run(operation) {
    if(lock.current)return;lock.current=true;setBusy(true);setError("");
    try {
      await request(operation.path,{method:operation.method,body:JSON.stringify(operation.body)});
      await refresh();await onChanged?.();setPending(null);setAction(null);setEdit(null);
    }catch(e){setError(e.message || "Could not confirm save. Retry the same request or reload and review history.");}
    finally{lock.current=false;setBusy(false);}
  }
  async function reload() {
    if(lock.current)return;lock.current=true;setBusy(true);
    try{await refresh();await onChanged?.();setPending(null);setAction(null);setEdit(null);setError("");}
    catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}
  }
  function configure(razor) {
    setError("");setEdit(razor ? {...razor,intervalDays:razor.intervalDays??"",reminderDays:razor.reminderDays??""} : {id:crypto.randomUUID(),name:"",itemId:"",intervalDays:"",reminderDays:"",version:0});
  }
  const field=(key,value)=>setEdit(current=>({...current,[key]:value}));
  function save(e) {
    e.preventDefault();run({path:`/razors/${edit.id}`,method:"PUT",body:{name:edit.name,itemId:Number(edit.itemId),intervalDays:edit.intervalDays===""?null:Number(edit.intervalDays),reminderDays:edit.reminderDays===""?null:Number(edit.reminderDays),expectedVersion:edit.version}});
  }
  function submit(e) {
    e.preventDefault();
    const operation=pending??{path:`/razors/${action.razor.id}/${action.entry?"corrections":"changes"}`,method:"POST",body:{requestId:crypto.randomUUID(),expectedVersion:action.razor.version,today:localToday(),changedOn:action.changedOn,
      ...(action.entry?{changeId:action.entry.id,reason:action.reason}:{itemId:action.razor.itemId,containerId:action.containerId,confirmed:true})}};
    setPending(operation);run(operation);
  }
  return <section className="razor-panel" aria-label="Razor blades">
    <div className="razor-heading"><h3>Razor blades</h3><button type="button" disabled={busy} onClick={reload}>Reload</button></div>
    {error && !action && !edit && <p role="alert">{error}</p>}
    {!data && !error && <p>Loading blade status…</p>}
    {data && <>
      {!data.razors.length && <p>No razors configured. {manage?"Add each razor and choose its matching replacement inventory. No past changes will be assumed.":"Configure your razors in Home OS first."}</p>}
      {data.razors.map(razor=><article key={razor.id} className="razor-card">
        <strong>{razor.name}</strong>
        <p>{razor.ageDays===null?"Last change unknown":`${razor.ageDays} days since last change`} · {razor.dueOn?`${razor.status === "overdue"?"Overdue since":razor.status === "due"?"Due today":"Next due"} ${razor.dueOn}`:"No replacement interval set"}</p>
        {razor.remind && <p className="razor-reminder" role="status">Blade replacement {razor.status==="overdue"?"overdue":razor.status==="due"?"due today":"coming due"}.</p>}
        <p className="razor-muted">{razor.reminderDays===null?"Reminders off":`In-app reminder from ${razor.reminderDays} days before due, including overdue`}</p>
        <div className="razor-actions">
          <button type="button" disabled={busy||!!pending||!!edit||!!action} onClick={()=>{setError("");setAction({razor,changedOn:localToday(),containerId:""});}}>Change Blade</button>
          {manage && <button type="button" disabled={busy||!!pending||!!action||!!edit} onClick={()=>configure(razor)}>Configure</button>}
        </div>
        <details><summary>Replacement history</summary>
          {data.history.filter(h=>h.razorId===razor.id).length===0 && <p>No recorded changes.</p>}
          <ol>{data.history.filter(h=>h.razorId===razor.id).map(entry=><li key={entry.id}>
            {entry.changedOn} · {entry.itemName} · {entry.containerName} · 1 blade
            {manage && <button type="button" disabled={busy||!!pending||!!action||!!edit} onClick={()=>setAction({razor,entry,changedOn:entry.changedOn,reason:""})}>Correct date</button>}
            {data.corrections.filter(c=>c.changeId===entry.id).map((c,i)=><p key={i}>Date corrected from {c.previousDate} to {c.correctedDate}: {c.reason}</p>)}
          </li>)}</ol>
        </details>
      </article>)}
      {manage && !edit && <button type="button" disabled={busy||!!pending||!!action} onClick={()=>configure()}>Add razor</button>}
      {edit && <form ref={formRef} tabIndex={-1} onSubmit={save} aria-label="Configure razor">
        <h4>{edit.version?"Configure razor":"Add razor"}</h4>
        {error && <p role="alert">{error}</p>}
        <label>Razor name<input required maxLength="120" value={edit.name} onChange={e=>field("name",e.target.value)} /></label>
        <label>Matching replacement inventory<select required value={edit.itemId} onChange={e=>field("itemId",e.target.value)}><option value="">Choose inventory item</option>{data.items.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <label>Replacement interval (days, optional)<input type="number" min="1" max="3650" value={edit.intervalDays} onChange={e=>field("intervalDays",e.target.value)} /></label>
        <label>Remind days before due (blank = off)<input type="number" min="0" max="365" value={edit.reminderDays} onChange={e=>field("reminderDays",e.target.value)} /></label>
        <p>Reminders appear in the app only. Stock must count individual replacement blades, not packs. Changing the inventory mapping affects future replacements only.</p>
        <button disabled={busy}>Save razor</button><button type="button" disabled={busy} onClick={()=>setEdit(null)}>Cancel</button>
      </form>}
      {action && <form ref={formRef} tabIndex={-1} onSubmit={submit} aria-label={action.entry?"Correct blade date":"Record blade replacement"}>
        <h4>{action.entry?"Correct date":"Change Blade"} · {action.razor.name}</h4>
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={busy||!!pending}>
          <label>Actual replacement date<input required type="date" max={localToday()} value={action.changedOn} onChange={e=>setAction({...action,changedOn:e.target.value})} /></label>
          {action.entry?<><label>Correction reason<input required maxLength="1000" value={action.reason} onChange={e=>setAction({...action,reason:e.target.value})} /></label><p>Corrects this date with an audit record. Inventory is unchanged.</p></>:<>
            <label>Take one blade from<select required value={action.containerId} onChange={e=>setAction({...action,containerId:e.target.value})}><option value="">Choose storage container</option>{data.sources.filter(s=>s.itemId===action.razor.itemId).map(s=><option key={s.containerId} value={s.containerId}>{s.locationName} / {s.containerName} · {s.quantity} available</option>)}</select></label>
            {!data.sources.some(s=>s.itemId===action.razor.itemId) && <p role="status">No blades available. Add or correct stock in Home OS first.</p>}
            <p>Confirm you replaced this razor's blade. This records the date and consumes one {data.items.find(i=>i.id===action.razor.itemId)?.name} from the selected container. A backdated entry still consumes one blade now.</p>
          </>}
        </fieldset>
        <button disabled={busy||(!action.entry&&!action.containerId)}>{pending?"Retry same save":action.entry?"Save correction":"Confirm replacement"}</button>
        <button type="button" disabled={busy} onClick={pending?reload:()=>setAction(null)}>{pending?"Reload and review history":"Cancel"}</button>
      </form>}
    </>}
  </section>;
}
