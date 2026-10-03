import { useEffect, useRef, useState } from "react";
import { needsCatalogReload, validateCatalogName, validateReplacement, isAssignable, catalogConflictMessage } from "./catalog.js";
import "./catalog.css";

// adapter.load() -> { categories, locations }; adapter.mutate(command) -> void.
// Uses the PR78 adapter only in isolated fixtures until approved rollout.
export default function CatalogManager({ adapter, onSnapshot = () => {} }) {
  const [snapshot, setSnapshot] = useState(null);
  const [kind, setKind] = useState("categories");
  const [editor, setEditor] = useState(null);
  const [name, setName] = useState("");
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const lock = useRef(false);
  const dialog = useRef(null);
  const singular = kind === "categories" ? "category" : "location";
  const allRecords = snapshot?.[kind] || [];
  const records = allRecords.filter(isAssignable);

  async function refresh() {
    const next = await adapter.load();
    setSnapshot(next);
    onSnapshot(next);
  }

  async function reload() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (adapter.pending) await adapter.retryPending();
      await refresh();
      setBlocked(false);
      setEditor(null);
      setError("");
    } catch (failure) {
      setBlocked(true);
      setError(adapter.pending ? "An unresolved change is retained. Resolve pending change resends the exact original request safely, then reloads current values." : catalogConflictMessage(failure));
    } finally { lock.current = false; setBusy(false); }
  }

  useEffect(() => { reload(); }, [adapter]);
  useEffect(() => {
    if (!editor) return;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [editor]);

  function close() {
    if (lock.current) return;
    setEditor(null);
    setError("");
  }

  function open(mode, record = null) {
    setEditor({ mode, record });
    setName(record?.name || "");
    setReplacement("");
    setError("");
    setNotice("");
  }

  async function save(event) {
    event.preventDefault();
    if (lock.current || blocked) return;
    let command;
    try {
      command = { kind, action: editor.mode, id: editor.record?.id, version: editor.record?.version };
      if (editor.mode === "delete") {
        command.replacementId = validateReplacement(editor.record, replacement, records);
        if (command.replacementId) command.replacementVersion = records.find(record => record.id === replacement).version;
      }
      else command.name = validateCatalogName(name, allRecords, editor.record?.id);
    } catch (failure) { setError(failure.message); return; }
    lock.current = true;
    setBusy(true);
    setError("");
    let committed = false;
    try {
      await adapter.mutate(command);
      committed = true;
      await refresh();
      setEditor(null);
      setNotice("Saved. All assignments now use the current values.");
    } catch (failure) {
      if (committed || needsCatalogReload(failure)) {
        setBlocked(true);
        setEditor(null);
        setError(committed
          ? "Saved, but current values could not be loaded. Reload before making another change."
          : adapter.pending ? "An unresolved change is retained. Resolve pending change resends the exact original request safely." : catalogConflictMessage(failure));
      } else setError(failure.message || "Check the details and try again.");
    } finally { lock.current = false; setBusy(false); }
  }

  return <section className="catalog" aria-label="Categories and locations">
    <header><p className="catalog-eyebrow">HOME OS / SETTINGS</p><h1>Categories & locations</h1>
      <p>Organize your inventory. Names stay consistent everywhere they’re used.</p></header>
    <div className="catalog-tabs" aria-label="Value type">
      {["categories", "locations"].map(value => <button key={value} aria-pressed={kind === value} disabled={busy || !!editor} onClick={() => { setKind(value); setNotice(""); }}>{value === "categories" ? "Categories" : "Locations"}</button>)}
    </div>
    {!editor && error && <p role="alert" className="catalog-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {blocked && <button onClick={reload} disabled={busy}>{busy ? "Loading…" : adapter.pending ? "Resolve pending change" : "Reload values"}</button>}
    <div className="catalog-toolbar"><p>{records.length} {records.length === 1 ? singular : kind}</p><button className="catalog-primary" disabled={!snapshot || busy || blocked} onClick={() => open("add")}>Add {singular}</button></div>
    {!snapshot && !blocked && <p role="status">Loading values…</p>}
    {snapshot && !records.length && <p>No {kind} yet. Add your first {singular} to get started.</p>}
    <ul className="catalog-list">{records.map(record => <li key={record.id}>
      <div className="catalog-value"><strong>{record.name}</strong><span>{record.usageCount} {record.usageCount === 1 ? "assignment" : "assignments"} · {record.itemCount} items · {record.containerCount} containers{record.isProtected ? " · Protected legacy location" : ""}</span></div>
      <div className="catalog-actions"><button disabled={busy || blocked} aria-label={`Rename ${record.name}`} onClick={() => open("rename", record)}>Rename</button>{!record.isProtected && <button disabled={busy || blocked} aria-label={`Delete ${record.name}`} onClick={() => open("delete", record)}>Delete</button>}</div>
    </li>)}</ul>
    {editor && <dialog ref={dialog} aria-labelledby="catalog-dialog-title" onCancel={event => { event.preventDefault(); close(); }}>
      <form onSubmit={save}>
        <h2 id="catalog-dialog-title">{editor.mode === "add" ? "Add" : editor.mode === "rename" ? "Rename" : "Delete"} {singular}</h2>
        {editor.mode === "delete" ? <>
          <p>Delete <strong>{editor.record.name}</strong>?</p>
          <p>{editor.record.usageCount > 0 ? `This value has ${editor.record.usageCount} assignments. Choose where to move them before deleting.` : "This value has no assignments."}</p>
          {editor.record.usageCount > 0 && <label>Replacement {singular}<select autoFocus value={replacement} disabled={busy} onChange={event => setReplacement(event.target.value)}>
            <option value="">Choose a replacement</option>{records.filter(record => record.id !== editor.record.id).map(record => <option key={record.id} value={record.id}>{record.name}</option>)}
          </select></label>}
          {editor.record.usageCount > 0 && records.length < 2 && <p>Add another {singular} first, then return here.</p>}
          {replacement && <p>All assignments will move to <strong>{records.find(record => record.id === replacement)?.name}</strong>.</p>}
        </> : <>
          <label>Name<input autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
          {editor.mode === "rename" && <p>All {editor.record.usageCount} assignments will use the new name.</p>}
        </>}
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="catalog-dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="catalog-primary" disabled={busy || blocked || (editor.mode === "delete" && editor.record.usageCount > 0 && !replacement)}>{busy ? "Saving…" : editor.mode === "delete" ? "Delete and save" : "Save"}</button></div>
      </form>
    </dialog>}
  </section>;
}
