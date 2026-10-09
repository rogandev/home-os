import { editableItemValues } from "./replenishment.js";
import { allocationTotal } from "./storage.js";

// Explicit allowlist: never copy IDs, system dates, derived status, orders or history.
export function inventoryCopyDraft(item, allocations = [], { canonical = false } = {}) {
  const draft = {
    ...editableItemValues(item),
    allocations: allocations.map(({ containerId, quantity }) => ({ containerId, quantity: Number(quantity) })),
  };
  if (canonical) {
    delete draft.category;
    delete draft.location;
    draft.categoryId = item.categoryId || "";
    draft.locationId = item.locationId || "";
  }
  return draft;
}

export function validateInventoryCopy(draft) {
  if (!draft.name.trim()) throw new Error("Give this item a name before saving.");
  if (!Number.isInteger(draft.quantity) || draft.quantity < 0) throw new Error("Quantity must be a whole number of zero or more.");
  if (!Number.isInteger(draft.reorder_at) || draft.reorder_at < 0) throw new Error("Reorder level must be a whole number of zero or more.");
  const containers = new Set();
  for (const row of draft.allocations) {
    if (!row.containerId || containers.has(row.containerId)) throw new Error("Choose each storage container only once.");
    if (!Number.isInteger(row.quantity) || row.quantity < 0) throw new Error("Container quantities must be whole numbers of zero or more.");
    containers.add(row.containerId);
  }
  if (allocationTotal(draft.allocations) !== draft.quantity) throw new Error("Storage quantities must match the item total. Reload its storage details before copying.");
}

// One intent keeps one key and frozen body through ambiguous network failures.
// A confirmed response is cached too, so repeated clicks cannot create a second item.
export function createInventoryCopySaver(request, createId = () => crypto.randomUUID()) {
  let body = null;
  let pending = null;
  let result = null;
  let uncertain = false;
  return {
    get pending() { return Boolean(pending); },
    get uncertain() { return uncertain; },
    save(draft) {
      if (result) return Promise.resolve(result);
      if (pending) return pending;
      if (!body) {
        const payload = inventoryCopyDraft(draft, draft.allocations, {
          canonical: Object.hasOwn(draft, "categoryId") || Object.hasOwn(draft, "locationId"),
        });
        validateInventoryCopy(payload);
        body = JSON.stringify({ ...payload, createRequestId: createId() });
      }
      pending = Promise.resolve().then(() => request("/items", { method: "POST", body })).then(created => {
        if (!created?.id || !Array.isArray(created.allocations)) throw new Error("The server did not confirm the complete save.");
        result = created;
        uncertain = false;
        return created;
      }).catch(error => {
        const definitiveRejection = [400, 401, 403, 404, 413, 422].includes(error.status);
        // Once a response has been lost, only success can settle the original intent.
        uncertain = uncertain || !definitiveRejection;
        if (!uncertain) body = null;
        error.uncertain = uncertain;
        throw error;
      }).finally(() => { pending = null; });
      return pending;
    },
  };
}
