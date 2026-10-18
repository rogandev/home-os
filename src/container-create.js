const normalized = value => value.trim().toLocaleLowerCase();
export function containerDraft(name, locationId, locations, id) {
  name = name.trim();
  if (!name || name.length > 100) throw new Error('Enter a container name between 1 and 100 characters.');
  if (!locations.some(row => row.id === locationId && row.isActive && !row.deletedAt)) throw new Error('Choose an active location.');
  return { id, locationId, name };
}

// Always reconcile before POST, including retries after a lost response. A stable
// ID and the backend's unique location/name constraint prevent duplicate creates.
export async function saveContainer(request, draft) {
  const read = () => request('/containers');
  const find = rows => {
    const row = rows.find(r => r.id === draft.id) || rows.find(r => r.locationId === draft.locationId && normalized(r.name) === normalized(draft.name));
    if (row && (row.locationId !== draft.locationId || normalized(row.name) !== normalized(draft.name) || !row.isActive || row.isCompatibility)) {
      throw Object.assign(new Error('A conflicting or inactive container exists. Review storage before creating another.'), { status: 409 });
    }
    return row;
  };
  const existing = find(await read());
  if (existing) return { record: existing, existing: true };
  try {
    await request('/containers', { method: 'POST', body: JSON.stringify(draft) });
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.status !== 409) throw error;
    // A timeout or conflict may represent a committed request. Never blindly retry.
    const saved = find(await read());
    if (saved) return { record: saved, existing: true };
    throw error;
  }
  const saved = find(await read());
  if (!saved) throw new Error('The saved container could not be verified. Check again before retrying.');
  return { record: saved, existing: false };
}
