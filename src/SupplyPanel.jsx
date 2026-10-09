import { useRef, useState } from "react";
import { supplyForecast } from "./supply.js";
import "./supply.css";

export function SupplySettings({ settings,apiFetch,onRefresh }) {
  const [open,setOpen] = useState(false), [days,setDays] = useState(""), [settingsVersion,setSettingsVersion] = useState(null), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  async function save(e) {
    e.preventDefault(); if (busy) return; setBusy(true);setError("");
    try {
      await apiFetch("/supply/settings",{ method:"PUT",body:JSON.stringify({ warningDays:Number(days),expectedVersion:settingsVersion }) });
      await onRefresh();setOpen(false);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="supply-settings"><button onClick={() => {setSettingsVersion(settings.version);setDays(String(settings.warningDays));setOpen(!open);}}>Supply settings</button>
    {open && <form onSubmit={save}><label>Default warning (days)<input aria-label="Default supply warning days" type="number" min="0" max="365" required value={days} onChange={e=>setDays(e.target.value)} /></label>
      <p>Warn one week before estimated run-out by default. Each item can override this. Target: one spare plus one in use.</p>
      <button disabled={busy}>Save default</button>{error && <p role="alert">{error}</p>}</form>}</div>;
}

export function SupplyPanel({ item,data,order,allocations,containers,today,apiFetch,onRefresh,Modal }) {
  const profile = data.profiles.find(p=>p.itemId===item.id);
  const subscription = data.subscriptions.find(s=>s.itemId===item.id);
  const usage = data.usage.filter(u=>u.itemId===item.id);
  const forecast = supplyForecast({ item,profile,usage,subscription,order,linkedOrder:data.linkedOrders.find(o=>o.id===subscription?.nextDeliveryOrderId),warningDays:data.settings.warningDays,today });
  const [editing,setEditing] = useState(false),[usageAction,setUsageAction] = useState(null);
  const [busy,setBusy] = useState(false),[error,setError] = useState(""),[notice,setNotice] = useState("");
  const [pending,setPending] = useState(null);
  const inFlight = useRef(false);
  const [form,setForm] = useState({}),[subForm,setSubForm] = useState({});
  const [containerId,setContainerId] = useState("");
  const sources = allocations.filter(a=>a.quantity>0 && containers.some(c=>c.id===a.containerId && c.isActive));
  const active = forecast.active;
  function edit() {
    setNotice("");setError("");setForm({ expectedVersion:profile?.version ?? 0, estimatedDaysPerUnit:profile?.estimatedDaysPerUnit ?? "",warningDays:profile?.warningDays ?? "" });
    setSubForm({ status:"active",quantityPerDelivery:1,intervalCount:1,intervalUnit:"month",nextDeliveryDate:today,retailer:"",notes:"",nextDeliveryOrderId:"",...subscription });
    setEditing(true);
  }
  async function run(action) {
    if (inFlight.current) return; inFlight.current=true;setBusy(true);setError("");setNotice("");
    try { await action(); await onRefresh();setNotice("Saved.");return true; }
    catch (e) {setError(e.message || "Save failed. Reload and try again.");return false;}
    finally {inFlight.current=false;setBusy(false);}
  }
  function close() { if (!inFlight.current && !pending) {setEditing(false);setUsageAction(null);setError("");} }
  async function saveProfile(e) {
    e.preventDefault();
    await run(async()=>{
      const saved = await apiFetch(`/items/${item.id}/supply`,{method:"PUT",body:JSON.stringify({ expectedVersion:form.expectedVersion,
        estimatedDaysPerUnit:form.estimatedDaysPerUnit === "" ? null : Number(form.estimatedDaysPerUnit),warningDays:form.warningDays === "" ? null : Number(form.warningDays) })});
      setForm(f=>({...f,expectedVersion:saved.version}));
    });
  }
  async function saveSubscription(e) {
    e.preventDefault();
    await run(async()=>{
      const saved = await apiFetch(`/items/${item.id}/subscription`,{method:"PUT",body:JSON.stringify({ ...subForm,expectedVersion:subForm.version ?? 0,
        quantityPerDelivery:Number(subForm.quantityPerDelivery),intervalCount:Number(subForm.intervalCount),nextDeliveryOrderId:subForm.nextDeliveryOrderId ? Number(subForm.nextDeliveryOrderId) : null })});
      setSubForm(saved);
    });
  }
  async function status(nextStatus) {
    await run(async()=>{
      const saved=await apiFetch(`/items/${item.id}/subscription`,{method:"PATCH",body:JSON.stringify({ status:nextStatus,expectedVersion:subscription.version })});
      setSubForm(saved);
    });
  }
  function startUsage(action) {setError("");setContainerId(sources.length===1 ? sources[0].containerId : "");setUsageAction(action);}
  async function recordUsage(replaceActive=false) {
    const operation = pending ?? { action:usageAction,body:{ requestId:crypto.randomUUID(),date:today,
      ...(usageAction === "open" ? { containerId,expectedActiveUsageId:active?.id ?? null,replaceActive } : { usageId:active.id }) } };
    setPending(operation);
    // Keep the same operation after a lost response or failed refresh: retries cannot consume another unit.
    const ok = await run(()=>apiFetch(`/items/${item.id}/usage/${operation.action}`,{method:"POST",body:JSON.stringify(operation.body)}));
    if (ok) {setPending(null);setUsageAction(null);}
  }
  async function refreshAfterFailure() {
    if (await run(async()=>{})) {setPending(null);setUsageAction(null);}
  }
  const set = (key,value)=>setForm(f=>({...f,[key]:value}));
  const setSub = (key,value)=>setSubForm(f=>({...f,[key]:value}));
  const number = n => Number(n.toFixed(1));
  return <section className="supply-panel" aria-label={`Supply for ${item.name}`}>
    <div className="supply-heading"><strong>Supply & subscriptions</strong><button onClick={edit}>Plan supply</button></div>
    {(profile || subscription || usage.length>0) && <>
      <p>{active ? "1 in use" : "None recorded in use"} · {item.quantity} spare{item.quantity===1 ? "" : "s"} · {forecast.incoming} actually incoming</p>
      <p className="supply-muted">Target: one in use + one spare. Effective stock: {forecast.effectiveStock} stored + incoming.</p>
      {forecast.days && <><p>About {number(forecast.days)} days per container · {forecast.source === "observed" ? "observed usage" : forecast.source === "refining" ? "estimate refined by usage" : "your estimate"} ({forecast.samples} completed)</p>
        <p>Stored supply runs out around <strong>{forecast.physicalRunOutDate}</strong>. Warning from {forecast.warningDate}.</p>
        {forecast.runOutDate !== forecast.physicalRunOutDate && <p>Including the dated incoming order: around {forecast.runOutDate}.</p>}
        {forecast.runOutWarning && item.replenishmentPolicy !== "do_not_order" && <p className="supply-warning">Within your {forecast.buffer}-day run-out warning.</p>}
        {forecast.overdueActive && <p>Current container has passed its estimate. Finish it when empty; Home OS never closes it automatically.</p>}
      </>}
      {subscription && <p>Tracking {subscription.status} · {subscription.quantityPerDelivery} every {subscription.intervalCount} {subscription.intervalUnit}{subscription.intervalCount===1 ? "" : "s"} · next {subscription.nextDeliveryDate}</p>}
      {forecast.label && <><strong className={forecast.mayRunOut ? "supply-warning" : ""}>{forecast.label}</strong>
        <p>At {forecast.deliveryDate}: about {Number(forecast.before.toFixed(2))} containers' supply before, {Number(forecast.after.toFixed(2))} after ({forecast.afterSpares} spares after opening the next container as needed).</p>
        {forecast.mayRunOut && <p>Less than {forecast.buffer} days remain before delivery, or supply runs out first. Consider an earlier delivery, shorter interval, or larger quantity.</p>}
        {forecast.belowSpareTarget && <p>This delivery leaves no spare after opening the next container. Consider adjusting the quantity to keep one spare.</p>}
        {forecast.likelyOverstock && <p className="supply-warning">Consider skipping this delivery</p>}
        {forecast.cadenceShortfall && <p>The recurring quantity may not cover a full interval. Consider a shorter interval or larger quantity.</p>}
      </>}
      {forecast.reason && <p>{forecast.reason}</p>}
      <div className="supply-actions"><button disabled={busy || sources.length===0} onClick={()=>startUsage("open")}>Opened a new one</button>
        <button disabled={busy || !active} onClick={()=>startUsage("finish")}>Finished one</button></div>
    </>}
    {editing && <Modal title={`Supply · ${item.name}`} onClose={close} busy={busy}><div className="supply-editor">
      <p>These are forecasts and tracking only. Change or skip deliveries with your retailer yourself.</p>
      <form onSubmit={saveProfile}><h3>Container duration</h3>
        <label>How many days does one container last?<input aria-label="Estimated days per container" type="number" min="0.1" max="3650" step="0.1" value={form.estimatedDaysPerUnit} onChange={e=>set("estimatedDaysPerUnit",e.target.value)} /></label>
        <label>Warning lead time (days)<input aria-label="Item warning days" type="number" min="0" max="365" placeholder={`Default: ${data.settings.warningDays}`} value={form.warningDays} onChange={e=>set("warningDays",e.target.value)} /></label>
        <p>Leave warning blank to use the default. Each completed container refines your estimate; after three, recent observed durations take over. Same-day records stay in history but do not set a daily rate.</p>
        <button disabled={busy}>Save supply settings</button>
      </form>
      <form onSubmit={saveSubscription}><h3>Subscription tracking</h3>
        <label>Status<select aria-label="Subscription status" value={subForm.status} onChange={e=>setSub("status",e.target.value)}>{["active","paused","cancelled"].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Containers per delivery<input aria-label="Containers per delivery" type="number" min="1" max="10000" required value={subForm.quantityPerDelivery} onChange={e=>setSub("quantityPerDelivery",e.target.value)} /></label>
        <div className="supply-grid"><label>Every<input aria-label="Delivery interval" type="number" min="1" max="365" required value={subForm.intervalCount} onChange={e=>setSub("intervalCount",e.target.value)} /></label>
          <label>Interval unit<select aria-label="Delivery interval unit" value={subForm.intervalUnit} onChange={e=>setSub("intervalUnit",e.target.value)}>{["day","week","month"].map(v=><option key={v}>{v}</option>)}</select></label></div>
        <label>Next expected delivery<input aria-label="Next subscription delivery date" type="date" required value={subForm.nextDeliveryDate} onChange={e=>setSub("nextDeliveryDate",e.target.value)} /></label>
        <label>Retailer<input maxLength="2000" value={subForm.retailer} onChange={e=>setSub("retailer",e.target.value)} /></label>
        <label>Notes<textarea maxLength="2000" value={subForm.notes} onChange={e=>setSub("notes",e.target.value)} /></label>
        <label>Actual order for this delivery<select aria-label="Subscription delivery order" value={subForm.nextDeliveryOrderId ?? ""} onChange={e=>setSub("nextDeliveryOrderId",e.target.value)}>
          <option value="">No linked order</option>{order && <option value={order.id}>Open order · {order.remainingQuantity} remaining</option>}
          {subscription?.nextDeliveryOrderId && subscription.nextDeliveryOrderId !== order?.id && <option value={subscription.nextDeliveryOrderId}>Previous linked order (closed)</option>}
        </select></label>
        <p>Link the order when this delivery is actually ordered. Receipt still needs confirmation. Activating tracking uses Auto-replenish. Pause or cancel tracking before selecting Do Not Order.</p>
        <button disabled={busy}>Save subscription tracking</button>
      </form>
      {subscription && <div className="supply-actions"><button disabled={busy || subscription.status==="active"} onClick={()=>status("active")}>Resume tracking</button><button disabled={busy || subscription.status!=="active"} onClick={()=>status("paused")}>Pause tracking</button><button disabled={busy || subscription.status==="cancelled"} onClick={()=>status("cancelled")}>Cancel tracking</button></div>}
      {usage.length>0 && <><h3>Recent usage</h3><ul>{usage.map(u=><li key={u.id}>Opened {u.openedOn} · {u.finishedOn ? `finished ${u.finishedOn}` : "in use"}</li>)}</ul></>}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
    </div></Modal>}
    {usageAction && <Modal title={usageAction==="open" ? "Opened a new one" : "Finished one"} onClose={close} busy={busy || Boolean(pending)}><div className="supply-editor">
      {usageAction==="open" ? <><label>Take one spare from<select aria-label="Open from storage container" disabled={Boolean(pending)} value={containerId} onChange={e=>setContainerId(e.target.value)}><option value="">Choose a container</option>{sources.map(a=><option key={a.containerId} value={a.containerId}>{a.containerName || containers.find(c=>c.id===a.containerId)?.name} · {a.quantity} spare</option>)}</select></label>
        {active ? <p>Does this replace the container opened on {active.openedOn}? Yes will finish that record and open this spare together.</p> : <p>This moves one spare into use and starts its usage record.</p>}
        <button disabled={busy || !containerId} onClick={()=>recordUsage(Boolean(active))}>{pending ? "Retry same action" : active ? "Yes, replace and open" : "Open this spare"}</button>
        {!pending && <button disabled={busy} onClick={close}>{active ? "No, keep current container" : "Cancel"}</button>}
      </> : <><p>Finish the container opened on {active?.openedOn}. Spare stock will not be reduced again.</p><button disabled={busy} onClick={()=>recordUsage()}>{pending ? "Retry same action" : "Confirm finished"}</button></>}
      {error && <p role="alert">{error}</p>}{pending && !busy && <button onClick={refreshAfterFailure}>Reload current state</button>}
    </div></Modal>}
  </section>;
}
