import { createCatalogTransport, createMemoryJournal } from "../catalog/model.js";
import { createCatalogAdapter } from "../../src/catalog-adapter.js";
import { localDate } from "../../src/delivery.js";

// Disposable UI model only. Requests never leave memory; the real API contract is
// checked separately by flowboard-api's PostgreSQL integration and smoke suites.
export function createIntegratedFixture() {
  const transport = createCatalogTransport();
  const { state, writes } = transport;
  const journal = createMemoryJournal();
  const copies = new Map(), operations = new Map(), events = new Map();
  const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return localDate(d); };
  for (const item of state.items) Object.assign(item, { brand: "Fixture", description: "Disposable sample inventory", size: "100 ml", form: "Bottle", notes: "Reload resets every change", replenishmentPolicy: "auto_replenish" });
  Object.assign(state.orders[0], { orderedQuantity: 3, orderedDate: day(-5), expectedDeliveryDate: day(0), receivedDate: null });
  state.items[0].status = "awaiting_shipment";
  const supply = {
    settings: { warningDays: 7, version: 1 },
    profiles: [{ itemId: "cream", estimatedDaysPerUnit: 30, warningDays: null, version: 1 }, { itemId: "wash", estimatedDaysPerUnit: 3, warningDays: null, version: 1 }],
    subscriptions: [{ itemId: "cream", status: "active", quantityPerDelivery: 3, intervalCount: 1, intervalUnit: "month", nextDeliveryDate: day(0), nextDeliveryOrderId: 1, retailer: "Fixture store", notes: "No provider actions", version: 1 }, { itemId: "wash", status: "active", quantityPerDelivery: 1, intervalCount: 1, intervalUnit: "month", nextDeliveryDate: day(14), nextDeliveryOrderId: null, retailer: "Fixture store", notes: "", version: 1 }],
    usage: [{ id: "00000000-0000-4000-8000-000000000001", itemId: "cream", containerId: "office-default", openedOn: day(-5), finishedOn: null }],
  };
  const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
  const publicCopy = value => structuredClone(value);
  function findItem(id) { return state.items.find(i => i.id === id) || fail("Fixture item not found", 404); }
  function updateStatus(item) {
    item.status = state.orders.some(o => o.itemId === item.id && o.status === "open") ? "awaiting_shipment"
      : item.replenishmentPolicy === "do_not_order" ? "do_not_order" : item.quantity <= item.reorder_at ? "need_to_order" : "normal";
  }
  async function request(path, options = {}) {
    const method = options.method || "GET";
    const body = options.body ? JSON.parse(options.body) : {};
    if (method === "GET") {
      if (path === "/supply") return publicCopy({ ...supply, linkedOrders: state.orders.filter(o => supply.subscriptions.some(s => s.nextDeliveryOrderId === o.id)) });
      if (path === "/orders?status=open") return publicCopy(state.orders.filter(o => o.status === "open"));
      if (/^\/orders\/\d+\/events$/.test(path)) return publicCopy(events.get(Number(path.split("/")[2])) || []);
      return transport.request(path, options);
    }
    if (path === "/items" && method === "POST") {
      const signature = JSON.stringify(body), prior = copies.get(body.createRequestId);
      if (prior) { if (prior.signature !== signature) fail("Copy request changed", 409); return publicCopy(prior.response); }
      for (const [field, kind] of [["categoryId", "categories"], ["locationId", "locations"]]) {
        if (!state[kind].some(r => r.id === body[field] && r.isActive && !r.deletedAt)) fail(`Choose an active ${kind}`);
      }
      const { allocations, createRequestId, ...fields } = body;
      const rows = allocations ?? [{ containerId: state.containers.find(c => c.locationId === body.locationId && c.isCompatibility)?.id, quantity: body.quantity }];
      if (rows.reduce((n, r) => n + r.quantity, 0) !== body.quantity) fail("Storage quantities must match");
      const created = await transport.request(path, { ...options, body: JSON.stringify(fields) });
      state.allocationsByItem[created.id] = rows.map(r => ({ ...r, itemId: created.id }));
      updateStatus(findItem(created.id));
      const response = { ...findItem(created.id), ...(allocations || createRequestId ? { allocations: publicCopy(state.allocationsByItem[created.id]) } : {}) };
      if (createRequestId) copies.set(createRequestId, { signature, response: publicCopy(response) });
      return publicCopy(response);
    }
    if (path === "/supply/settings") {
      if (body.expectedVersion !== supply.settings.version) fail("Settings changed", 409);
      supply.settings = { warningDays: body.warningDays, version: supply.settings.version + 1 };
      writes.push({ path, method, body }); return publicCopy(supply.settings);
    }
    const itemRoute = path.match(/^\/items\/([^/]+)\/(supply|subscription|usage\/(open|finish))$/);
    if (itemRoute) {
      const [, id, action, usageAction] = itemRoute, item = findItem(id);
      if (usageAction) {
        const signature = JSON.stringify([path, body]);
        if (operations.has(body.requestId)) { if (operations.get(body.requestId) !== signature) fail("Request changed", 409); return { ok: true, replayed: true }; }
        const active = supply.usage.find(u => u.itemId === id && !u.finishedOn);
        if (usageAction === "open") {
          if ((active?.id ?? null) !== body.expectedActiveUsageId) fail("In-use unit changed", 409);
          if (active && body.replaceActive !== true) fail("Confirm replacement", 409);
          const allocation = state.allocationsByItem[id].find(a => a.containerId === body.containerId && a.quantity > 0);
          if (!allocation) fail("No spare available", 409);
          allocation.quantity--; item.quantity--; if (active) active.finishedOn = body.date;
          supply.usage.push({ id: body.requestId, itemId: id, containerId: body.containerId, openedOn: body.date, finishedOn: null });
          updateStatus(item);
        } else { if (!active || active.id !== body.usageId) fail("In-use unit changed", 409); active.finishedOn = body.date; }
        operations.set(body.requestId, signature); writes.push({ path, method, body }); return { ok: true, replayed: false };
      }
      const key = action === "supply" ? "profiles" : "subscriptions";
      const current = supply[key].find(r => r.itemId === id);
      if (body.expectedVersion !== (current?.version ?? 0)) fail("Supply settings changed", 409);
      if (action === "subscription" && body.status === "active" && item.replenishmentPolicy === "do_not_order") fail("Resume ordering first", 409);
      const { expectedVersion, ...fields } = body;
      const saved = { ...current, ...fields, itemId: id, version: (current?.version ?? 0) + 1 };
      supply[key] = [...supply[key].filter(r => r.itemId !== id), saved];
      if (saved.status === "active") item.replenishmentPolicy = "auto_replenish";
      writes.push({ path, method, body }); return publicCopy(saved);
    }
    const orderRoute = path.match(/^\/orders\/(\d+)(?:\/(receive|cancel))?$/);
    if (orderRoute) {
      const order = state.orders.find(o => o.id === Number(orderRoute[1]));
      if (!order || order.status !== "open") fail("Order is no longer open", 409);
      const item = findItem(order.itemId);
      if (orderRoute[2] === "receive") {
        if (!Number.isInteger(body.quantity) || body.quantity <= 0 || body.quantity > order.remainingQuantity) fail("Choose a valid receipt quantity");
        if (!state.containers.some(c => c.id === body.containerId && c.isActive)) fail("Choose active storage");
        const rows = state.allocationsByItem[item.id]; let allocation = rows.find(r => r.containerId === body.containerId);
        if (!allocation) { allocation = { itemId: item.id, containerId: body.containerId, quantity: 0 }; rows.push(allocation); }
        allocation.quantity += body.quantity; item.quantity += body.quantity; order.remainingQuantity -= body.quantity;
        if (!order.remainingQuantity) { order.status = "received"; order.receivedDate = body.receivedDate; }
      } else if (orderRoute[2] === "cancel" || method === "DELETE") order.status = "cancelled";
      else {
        if (body.quantity !== undefined) { const received = order.orderedQuantity - order.remainingQuantity; order.orderedQuantity = body.quantity; order.remainingQuantity = body.quantity - received; }
        for (const field of ["orderedDate", "expectedDeliveryDate"]) if (Object.hasOwn(body, field)) order[field] = body[field];
      }
      updateStatus(item); writes.push({ path, method, body });
      events.set(order.id, [...(events.get(order.id) || []), { id: crypto.randomUUID(), eventType: orderRoute[2] || "corrected", quantity: body.quantity ?? null, createdAt: new Date().toISOString() }]);
      return publicCopy({ order, item });
    }
    return transport.request(path, options);
  }
  const adapter = createCatalogAdapter({ request, journal, enabled: true });
  return Object.assign(adapter, { request, state, supply, writes });
}
