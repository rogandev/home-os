import { checkRecoveryStorage } from "./storage-check.js";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { isAssignable } from "../../src/catalog.js";
import CatalogManager from "../../src/CatalogManager.jsx";
import { createCatalogFixture } from "./model.js";

const adapter = createCatalogFixture();
function Fixture() {
  const [snapshot, setSnapshot] = useState(null);
  const [category, setCategory] = useState("");
  const [failure, setFailure] = useState("none");
  const [storageResult, setStorageResult] = useState("");
  return <main>
    <aside><strong>Disposable fixture · PR78 contract</strong><p>No production API, credentials, or persistent inventory. Reload to reset. The storage check retains then clears a disposable request envelope.</p>
      <label>Failure mode <select value={failure} onChange={event => { setFailure(event.target.value); adapter.configure({ failure: event.target.value }); }}>
        {["none", "validation", "conflict", "collision", "offline", "refresh", "lost-response"].map(mode => <option key={mode}>{mode}</option>)}
      </select></label> <button onClick={() => adapter.configure({ failure, delay: 1200 })}>Delay next operations</button>
    <button onClick={async () => { try { setStorageResult(await checkRecoveryStorage()); } catch (error) { setStorageResult(error.message); } }}>Check recovery storage</button><p role="status">{storageResult}</p>
    </aside>
    <CatalogManager adapter={adapter} onSnapshot={next => { setSnapshot(next); setCategory(current => next.categories.some(row => row.id === current && isAssignable(row)) ? current : ""); }} />
    {snapshot && <section className="preview"><h2>Assignment preview</h2><p>These fixture items demonstrate stable IDs in forms and filters. Production item integration awaits the platform contract.</p>
      <label>Filter by category <select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{snapshot.categories.filter(isAssignable).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <ul>{snapshot.items.filter(item => !category || item.categoryId === category).map(item => <li key={item.id}>{item.name} · {snapshot.categories.find(row => row.id === item.categoryId)?.name} · {snapshot.locations.find(row => row.id === item.locationId)?.name}</li>)}</ul>
      <label>New item category <select>{snapshot.categories.filter(isAssignable).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>New item location <select>{snapshot.locations.filter(isAssignable).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    </section>}
  </main>;
}
document.head.insertAdjacentHTML("beforeend", `<style>body{margin:0;background:#09090e;color:#e2e8f0;font:14px system-ui}main{padding:24px 12px}aside,.preview{max-width:720px;margin:0 auto 22px;padding:16px;box-sizing:border-box}aside{border:1px dashed #62627b;border-radius:12px;color:#b8b8cc}select,button{font:inherit;padding:8px;background:#20202d;color:#fff;border:1px solid #535367;border-radius:6px}label{display:block;margin:10px 0}.preview li{margin:12px 0}.preview{margin-top:24px}</style>`);
createRoot(document.getElementById("root")).render(<Fixture />);
