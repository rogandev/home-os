import { useEffect, useRef, useState } from 'react';
import { containerDraft, saveContainer } from './container-create.js';

export default function ContainerCreator({ request, locations, disabled, onCreated, onOpenChange }) {
  const [open, setOpen] = useState(false), [name, setName] = useState(''), [locationId, setLocationId] = useState('');
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(null), [error, setError] = useState(''), [saved, setSaved] = useState(null);
  const dialog = useRef(null), lock = useRef(false);
  useEffect(() => { onOpenChange(open); }, [open, onOpenChange]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); previous?.focus(); };
  }, [open]);
  function close() { if (!lock.current && !pending) { setOpen(false); setError(''); } }
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    let draft;
    try { draft = pending || containerDraft(name, locationId, locations, `container-${crypto.randomUUID()}`); }
    catch (failure) { setError(failure.message); return; }
    lock.current = true; setBusy(true); setPending(draft); setError('');
    try {
      const result = await saveContainer(request, draft);
      await onCreated();
      setSaved(result); setPending(null); setOpen(false);
    } catch (failure) {
      if (failure.status >= 400 && failure.status < 500) setPending(null);
      setError(failure.status >= 400 && failure.status < 500 ? failure.message : 'Could not verify the result. Check and retry will look for the saved container before sending anything again.');
    } finally { lock.current = false; setBusy(false); }
  }
  return <section aria-label="Storage containers">
    <h2>Storage containers</h2><p>Create an empty container within a room. Item quantities stay unchanged.</p>
    <button disabled={disabled || open} onClick={() => { setName(''); setLocationId(''); setError(''); setSaved(null); setOpen(true); }}>Create container</button>
    {saved && <p role="status">{saved.existing ? 'Container verified' : 'Container created'}: {saved.record.name} · {locations.find(row => row.id === saved.record.locationId)?.name}. ID: <code>{saved.record.id}</code></p>}
    {open && <dialog ref={dialog} aria-labelledby="container-title" onCancel={event => { event.preventDefault(); close(); }}>
      <form onSubmit={submit}><h2 id="container-title">Create container</h2>
        <label>Container name<input autoFocus value={name} disabled={busy || !!pending} onChange={event => setName(event.target.value)} /></label>
        <label>Room<select value={locationId} disabled={busy || !!pending} onChange={event => setLocationId(event.target.value)}><option value="">Choose a room</option>{locations.filter(row => row.isActive && !row.deletedAt).map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        {error && <p role="alert" className="catalog-error">{error}</p>}
        <div className="catalog-dialog-actions"><button type="button" disabled={busy || !!pending} onClick={close}>Cancel</button><button className="catalog-primary" disabled={busy}>{busy ? 'Checking…' : pending ? 'Check and retry' : 'Create empty container'}</button></div>
      </form>
    </dialog>}
  </section>;
}
