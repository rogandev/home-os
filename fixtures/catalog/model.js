import { validateCatalogName, validateReplacement, isAssignable } from "../../src/catalog.js";
import { createCatalogAdapter } from "../../src/catalog-adapter.js";

export function createMemoryJournal() {
  let operation = null;
  return {
    async read() { return structuredClone(operation); },
    async write(value) { if (operation) throw new Error("Resolve the existing pending change first."); operation = structuredClone(value); },
    async clear() { operation = null; },
  };
}

export function createCatalogTransport() {
  let nextId = 10;
  let failure = "none";
  let delay = 0;
  let refreshFails = false;
  const writes = [];
  const ledger = new Map();
  const row = (id, name, itemCount = 0, containerCount = 0, extra = {}) => ({ id, name, itemCount, containerCount, usageCount: itemCount + containerCount, version: 1, isActive: true, deletedAt: null, replacementId: null, isProtected: false, ...extra });
  const state = {
    categories: [row("skin", "Skin Care", 2), row("hair", "Hair Care"), row("retired", "Retired category", 0, 0, { isActive: false, deletedAt: "2026-01-01" })],
    locations: [row("office", "Office", 2, 2), row("closet", "Walk-in Closet", 0, 1), row("kitchen", "Kitchen", 0, 1, { isProtected: true }), row("inactive", "Inactive room", 0, 0, { isActive: false })],
    items: [{ id: "cream", name: "Face cream", quantity: 2, reorder_at: 1, status: "normal", categoryId: "skin", category: "Skin Care", locationId: "office", locationName: "Office", location: "Office" }, { id: "wash", name: "Face wash", quantity: 1, reorder_at: 1, status: "need_to_order", categoryId: "skin", category: "Skin Care", locationId: "office", locationName: "Office", location: "Office" }],
    containers: [{ id: "office-default", name: "Unassigned — Office", locationId: "office", isActive: true, isCompatibility: true }, { id: "empty", name: "Empty shelf", locationId: "office", isActive: false }, { id: "closet-default", name: "Unassigned — Closet", locationId: "closet", isActive: true, isCompatibility: true }, { id: "legacy-kitchen", name: "Legacy Kitchen", locationId: "kitchen", isActive: true, isCompatibility: true }],
    orders: [{ id: 1, itemId: "cream", status: "open", remainingQuantity: 3 }],
    allocationsByItem: { cream: [{ containerId: "office-default", quantity: 2 }], wash: [{ containerId: "office-default", quantity: 1 }] },
  };
  const error = (message, status, code) => Object.assign(new Error(message), { status, code });
  function counts() {
    for (const kind of ["categories", "locations"]) for (const record of state[kind]) {
      record.itemCount = state.items.filter(item => item[kind === "categories" ? "categoryId" : "locationId"] === record.id).length;
      record.containerCount = kind === "locations" ? state.containers.filter(container => container.locationId === record.id).length : 0;
      record.usageCount = record.itemCount + record.containerCount;
    }
  }
  return {
    writes, state,
    configure(options = {}) { failure = options.failure || "none"; delay = options.delay || 0; refreshFails = false; },
    async request(path, options = {}) {
      const method = options.method || "GET";
      if (method === "GET") {
        if (refreshFails) throw error("Fixture reload failed", 503);
        if (path === "/stats") return { total_items: state.items.length, total_units: state.items.reduce((sum, item) => sum + item.quantity, 0), in_stock: 1, need_to_order: 1, awaiting_shipment: 1 };
        if (path === "/orders?status=open") return structuredClone(state.orders);
        if (/^\/items\/[^/]+\/stock-allocations$/.test(path)) return structuredClone(state.allocationsByItem[path.split("/")[2]] || []);
        if (path === "/containers") return structuredClone(state.containers.map(container => ({ ...container, locationName: state.locations.find(location => location.id === container.locationId)?.name })));
        if (["/categories", "/locations", "/items"].includes(path)) return structuredClone(state[path.slice(1)]);
        throw new Error(`Unexpected fixture GET ${path}`);
      }
      const command = JSON.parse(options.body);
      writes.push({ path, method, body: command });
      if (path === "/items" || /^\/items\/[^/]+$/.test(path)) {
        if ((command.categoryId && command.category) || (command.locationId && command.location)) throw error("Ambiguous reference", 400);
        let item = state.items.find(row => row.id === path.split("/")[2]);
        if (method === "POST") {
          item = { id: `item-${nextId++}`, status: "normal" };
          state.items.push(item);
          state.allocationsByItem[item.id] = [];
        }
        if (!item) throw error("Missing item", 404);
        Object.assign(item, command);
        if (command.categoryId) item.category = state.categories.find(row => row.id === command.categoryId).name;
        if (command.locationId) { item.locationName = state.locations.find(row => row.id === command.locationId).name; item.location = item.locationName; }
        counts();
        return structuredClone(item);
      }
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      const signature = JSON.stringify([path, method, command]);
      const previous = ledger.get(command.requestId);
      if (previous) {
        if (previous.signature !== signature) throw error("Request ID conflict", 409, "HOME_OS_REQUEST_ID_CONFLICT");
        return structuredClone(previous.record);
      }
      if (failure === "validation") throw error("That name is not allowed by the server.", 400);
      if (failure === "conflict") throw error("Changed elsewhere", 409, "HOME_OS_CATALOG_VERSION_CONFLICT");
      if (failure === "collision") throw error("Container collision", 409, "HOME_OS_CONTAINER_NAME_CONFLICT");
      if (failure === "offline") throw new Error("Network unavailable");
      const [, kind, encodedId] = path.split("/");
      const records = state[kind];
      let record = records.find(row => row.id === decodeURIComponent(encodedId || ""));
      if (method !== "POST" && (!record || record.version !== command.version)) throw error("Stale value", 409, "HOME_OS_CATALOG_VERSION_CONFLICT");
      if (method !== "POST" && !isAssignable(record)) throw error("Inactive value", 409, "HOME_OS_CATALOG_INACTIVE");
      if (method === "DELETE") {
        validateReplacement(record, command.replacementId, records);
        const field = kind === "categories" ? "categoryId" : "locationId";
        const replacement = records.find(row => row.id === command.replacementId);
        if (replacement && replacement.version !== command.replacementVersion) throw error("Replacement changed", 409, "HOME_OS_CATALOG_VERSION_CONFLICT");
        if (replacement) {
          replacement.version += 1;
          state.items.forEach(item => { if (item[field] === record.id) { item[field] = replacement.id; if (kind === "categories") item.category = replacement.name; else { item.locationName = replacement.name; item.location = replacement.name; } } });
          if (kind === "locations") state.containers.forEach(container => { if (container.locationId === record.id) container.locationId = replacement.id; });
        }
        Object.assign(record, { isActive: false, deletedAt: "2026-10-03", replacementId: replacement?.id || null, version: record.version + 1 });
      } else {
        const name = validateCatalogName(command.name, records, record?.id);
        if (record) {
          record.name = name; record.version += 1;
          state.items.forEach(item => {
            if (kind === "categories" && item.categoryId === record.id) item.category = name;
            if (kind === "locations" && item.locationId === record.id) item.locationName = name;
          });
        } else {
          record = row(`fixture-${nextId++}`, name); records.push(record);
          if (kind === "locations") state.containers.push({ id: `default-${record.id}`, name: `Unassigned — ${name}`, locationId: record.id, isActive: true, isCompatibility: true });
        }
      }
      counts();
      ledger.set(command.requestId, { signature, record: structuredClone(record) });
      if (failure === "refresh") refreshFails = true;
      if (failure === "lost-response") throw new Error("Response lost after commit");
      return structuredClone(record);
    },
  };
}

export function createCatalogFixture() {
  const transport = createCatalogTransport();
  const adapter = createCatalogAdapter({ request: transport.request, journal: createMemoryJournal(), enabled: true });
  return Object.assign(adapter, { writes: transport.writes, configure: transport.configure, state: transport.state, request: transport.request });
}
