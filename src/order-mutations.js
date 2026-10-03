import { expectedDeliveryDatePayload } from "./delivery.js";

export function updateExpectedDeliveryDate(apiFetch, order, expectedDeliveryDate) {
  const dates = expectedDeliveryDatePayload(order, expectedDeliveryDate);
  return apiFetch(`/orders/${order.id}`, { method: "PATCH", body: JSON.stringify(dates) });
}

// One guard is shared by all order modals. React state alone cannot prevent two
// clicks in the same render, or a reopen while a request is still in flight.
export function createOrderMutationGuard() {
  let pending = false;
  let needsRefresh = false;
  return {
    get pending() { return pending; },
    get needsRefresh() { return needsRefresh; },
    async run(mutate, refresh) {
      if (pending) return false;
      if (needsRefresh) throw new Error("Reload order data before making another change.");
      pending = true;
      let saved = false;
      try {
        await mutate();
        saved = true;
        needsRefresh = true;
        await refresh();
        needsRefresh = false;
        return true;
      } catch (error) {
        // A network/5xx failure may have happened after the server committed.
        // Never offer a blind receipt retry against stale quantities.
        if (!error.status || error.status === 409 || error.status >= 500) needsRefresh = true;
        if (saved) throw new Error("The change was saved, but the latest order data could not be loaded. Reload before making another change.");
        throw error;
      } finally {
        pending = false;
      }
    },
    async refresh(load) {
      if (pending) return false;
      pending = true;
      try {
        await load();
        needsRefresh = false;
        return true;
      } finally {
        pending = false;
      }
    },
  };
}
