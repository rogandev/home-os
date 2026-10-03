import { validateCatalogName, validateReplacement } from "../../src/catalog.js";

export function createCatalogFixture() {
  let nextId = 10;
  let failure = "none";
  let delay = 0;
  let refreshFails = false;
  const writes = [];
  const state = {
    categories: [{ id: "skin", name: "Skin Care", usageCount: 2, version: 1 }, { id: "hair", name: "Hair Care", usageCount: 0, version: 1 }],
    locations: [{ id: "bathroom", name: "Bathroom", usageCount: 2, version: 1 }, { id: "closet", name: "Walk-in Closet", usageCount: 0, version: 1 }],
    items: [{ id: "cream", name: "Face cream", categoryId: "skin", locationId: "bathroom" }, { id: "wash", name: "Face wash", categoryId: "skin", locationId: "bathroom" }],
  };
  const error = (message, status) => Object.assign(new Error(message), { status });
  return {
    writes,
    configure(options = {}) { failure = options.failure || "none"; delay = options.delay || 0; refreshFails = false; },
    async load() {
      if (refreshFails) throw error("Fixture reload failed", 503);
      return structuredClone(state);
    },
    async mutate(command) {
      writes.push(structuredClone(command));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (failure === "validation") throw error("That name is not allowed by the server.", 400);
      if (failure === "conflict") throw error("Changed elsewhere", 409);
      if (failure === "offline") throw new Error("Network unavailable");
      const records = state[command.kind];
      const record = records.find(row => row.id === command.id);
      if (command.action !== "add" && (!record || record.version !== command.version)) throw error("Stale value", 409);
      if (command.action === "delete") {
        validateReplacement(record, command.replacementId, records);
        const field = command.kind === "categories" ? "categoryId" : "locationId";
        const replacement = records.find(row => row.id === command.replacementId);
        if (replacement) { replacement.usageCount += record.usageCount; replacement.version += 1; }
        state.items.forEach(item => { if (item[field] === record.id) item[field] = replacement.id; });
        state[command.kind] = records.filter(row => row.id !== record.id);
      } else {
        const name = validateCatalogName(command.name, records, record?.id);
        if (record) { record.name = name; record.version += 1; }
        else records.push({ id: `fixture-${nextId++}`, name, usageCount: 0, version: 1 });
      }
      if (failure === "refresh") refreshFails = true;
      if (failure === "lost-response") throw new Error("Response lost after commit");
    },
  };
}
