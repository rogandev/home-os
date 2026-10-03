// Deliberately not imported by the production entry point. Enable only in fixtures
// until API PR78 is deployed and verified. request is an injected authenticated
// JSON transport scoped to /home-os; this module never discovers credentials.
export function createCatalogAdapter({ request, journal, uuid = () => crypto.randomUUID(), enabled = false }) {
  let inFlight = false;
  let pending = null;
  const requireEnabled = () => { if (!enabled) throw new Error("Catalog integration is disabled pending backend rollout."); };
  async function execute(operation) {
    try {
      const record = await request(operation.path, { method: operation.method, body: operation.body });
      await journal.clear(operation);
      pending = null;
      return record; // Historical on replay; never substitute for a current reload.
    } catch (error) {
      // A definite HTTP rejection did not commit. Network/5xx remain uncertain.
      if (error.status >= 400 && error.status < 500) {
        await journal.clear(operation);
        pending = null;
      }
      throw error;
    }
  }
  async function singleFlight(action) {
    requireEnabled();
    if (inFlight) throw new Error("A catalog operation is already pending.");
    inFlight = true;
    try { return await action(); } finally { inFlight = false; }
  }
  return {
    get pending() { return pending; },
    async load() {
      requireEnabled();
      pending = await journal.read();
      if (pending) throw new Error("Resolve the pending change using its original request before making another change.");
      const [categories, locations, items, containers, orders, stats] = await Promise.all([
        request("/categories"), request("/locations"), request("/items"),
        request("/containers"), request("/orders?status=open"), request("/stats"),
      ]);
      const allocations = await Promise.all(items.map(item => request(`/items/${encodeURIComponent(item.id)}/stock-allocations`)));
      return { categories, locations, items, containers, orders, stats,
        allocationsByItem: Object.fromEntries(items.map((item, i) => [item.id, allocations[i]])) };
    },
    mutate(command) {
      return singleFlight(async () => {
        pending = await journal.read();
        if (pending) throw new Error("Resolve the pending change first.");
        if (!["categories", "locations"].includes(command.kind) || !["add", "rename", "delete"].includes(command.action)) throw new Error("Unknown catalog operation.");
        const method = { add: "POST", rename: "PATCH", delete: "DELETE" }[command.action];
        const body = { requestId: uuid() };
        if (command.action !== "add") body.version = command.version;
        if (command.action !== "delete") body.name = command.name;
        else if (command.replacementId) {
          body.replacementId = command.replacementId;
          body.replacementVersion = command.replacementVersion;
        }
        const operation = { path: `/${command.kind}${command.action === "add" ? "" : `/${encodeURIComponent(command.id)}`}`, method, body: JSON.stringify(body) };
        // Persist exact bytes before any network call. Failure to journal fails closed.
        await journal.write(operation);
        pending = operation;
        return execute(operation);
      });
    },
    retryPending() {
      return singleFlight(async () => {
        pending = await journal.read();
        if (!pending) throw new Error("No pending change to resolve.");
        return execute(pending);
      });
    },
  };
}

// Stores ONLY one unresolved mutation envelope, never catalogs/items or a shared
// data replica. scope must uniquely identify the API origin + account context.
export function createIndexedDBCatalogJournal(scope, indexedDB = globalThis.indexedDB) {
  if (!scope || !indexedDB) throw new Error("Durable catalog recovery storage is unavailable.");
  const opened = new Promise((resolve, reject) => {
    const opening = indexedDB.open("home-os-catalog-recovery", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("pending");
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
    opening.onblocked = () => reject(new Error("Close other tabs to open recovery storage."));
  });
  async function transaction(mode, action) {
    const db = await opened;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pending", mode);
      const req = action(tx.objectStore("pending"));
      tx.oncomplete = () => resolve(req.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("Recovery storage transaction aborted."));
    });
  }
  return {
    read: () => transaction("readonly", store => store.get(scope)),
    async write(operation) {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        const store = tx.objectStore("pending");
        const get = store.get(scope);
        get.onsuccess = () => { if (get.result) tx.abort(); else store.put(operation, scope); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(new Error("Another unresolved change exists. Reload before continuing."));
      });
    },
    async clear(operation) {
      const db = await opened;
      return new Promise((resolve, reject) => {
        const tx = db.transaction("pending", "readwrite");
        const store = tx.objectStore("pending");
        const get = store.get(scope);
        get.onsuccess = () => { if (JSON.stringify(get.result) === JSON.stringify(operation)) store.delete(scope); };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("Recovery cleanup failed."));
      });
    },
  };
}
