import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogAdapter } from "../src/catalog-adapter.js";
import { canonicalItemReferences, validateCatalogName } from "../src/catalog.js";
import { createCatalogTransport, createMemoryJournal } from "../fixtures/catalog/model.js";

const uuid = "845a98bd-5d87-45e3-a98a-e74a56ec5e57";
const setup = () => {
  const transport = createCatalogTransport();
  const journal = createMemoryJournal();
  const adapter = createCatalogAdapter({ request: transport.request, journal, enabled: true });
  return { transport, journal, adapter };
};

test("default gate prevents even read calls", async () => {
  const adapter = createCatalogAdapter({ request: () => assert.fail("must not call network"), journal: createMemoryJournal() });
  await assert.rejects(adapter.load(), /disabled/);
  await assert.rejects(adapter.mutate({ kind: "categories", action: "add", name: "Test" }), /disabled/);
});

test("HTTP adapter uses exact PR78 envelopes, individual records, UUIDs and replacement version", async () => {
  const { adapter, transport } = setup();
  const created = await adapter.mutate({ kind: "categories", action: "add", name: "Dental Care" });
  assert.equal(created.name, "Dental Care"); assert.equal(Array.isArray(created), false);
  const request = transport.writes[0];
  assert.equal(request.path, "/categories"); assert.equal(request.method, "POST");
  assert.match(request.body.requestId, /^[a-f0-9-]{36}$/); assert.deepEqual(Object.keys(request.body).sort(), ["name", "requestId"]);
  await adapter.mutate({ kind: "categories", action: "rename", id: created.id, version: created.version, name: "Teeth" });
  assert.deepEqual(Object.keys(transport.writes[1].body).sort(), ["name", "requestId", "version"]);
  await adapter.mutate({ kind: "categories", action: "delete", id: "skin", version: 1, replacementId: created.id, replacementVersion: 2 });
  assert.deepEqual(Object.keys(transport.writes[2].body).sort(), ["replacementId", "replacementVersion", "requestId", "version"]);
  const snapshot = await adapter.load();
  assert.equal(snapshot.categories.find(row => row.id === "skin").isActive, false);
  assert.ok(snapshot.categories.find(row => row.id === "skin").deletedAt);
  assert.equal(snapshot.items.every(item => item.categoryId === created.id), true);
  assert.equal(snapshot.orders[0].remainingQuantity, 3);
  assert.equal(snapshot.allocationsByItem.cream[0].quantity, 2);
});

test("uncertain outcome survives adapter recreation, exact retry replays durable ledger then reloads current data", async () => {
  const { adapter, journal, transport } = setup();
  transport.configure({ failure: "lost-response" });
  await assert.rejects(adapter.mutate({ kind: "categories", action: "rename", id: "skin", version: 1, name: "Face Care" }), /lost/);
  const retained = await journal.read();
  assert.ok(retained);
  transport.state.categories[0].name = "Changed later"; transport.state.categories[0].version = 3;
  const reopened = createCatalogAdapter({ request: transport.request, journal, enabled: true });
  await assert.rejects(reopened.load(), /pending/); // Never automatically replay.
  const response = await reopened.retryPending();
  assert.equal(response.name, "Face Care"); // Historical response.
  assert.deepEqual(transport.writes[0], transport.writes[1]);
  assert.equal(await journal.read(), null);
  assert.equal((await reopened.load()).categories[0].name, "Changed later");
});

test("known 409 clears request; uncertain failures and journal failure never permit a new operation", async () => {
  const { adapter, journal, transport } = setup();
  transport.configure({ failure: "collision" });
  await assert.rejects(adapter.mutate({ kind: "locations", action: "delete", id: "office", version: 1, replacementId: "closet", replacementVersion: 1 }), { code: "HOME_OS_CONTAINER_NAME_CONFLICT" });
  assert.equal(await journal.read(), null);
  transport.configure({ failure: "offline" });
  await assert.rejects(adapter.mutate({ kind: "categories", action: "add", name: "Dental" }));
  await assert.rejects(adapter.mutate({ kind: "categories", action: "add", name: "Other" }), /pending/);
  assert.equal(transport.writes.length, 2);
  const blocked = createCatalogAdapter({ request: () => assert.fail("no write before durable journal"), enabled: true, journal: { read: async () => null, write: async () => { throw new Error("Storage full"); } } });
  await assert.rejects(blocked.mutate({ kind: "categories", action: "add", name: "Test" }), /Storage full/);
});

test("delete unused category omits replacement rather than sending null", async () => {
  const { adapter, transport } = setup();
  await adapter.mutate({ kind: "categories", action: "delete", id: "hair", version: 1, replacementId: null });
  assert.deepEqual(Object.keys(transport.writes[0].body).sort(), ["requestId", "version"]);
});

test("location usage includes all containers and replacement preserves allocations and container IDs", async () => {
  const { adapter, transport } = setup();
  const before = await adapter.load();
  assert.equal(before.locations.find(row => row.id === "office").usageCount, 4);
  const added = await adapter.mutate({ kind: "locations", action: "add", name: "Attic" });
  assert.equal(added.containerCount, 1); assert.equal(added.usageCount, 1);
  await adapter.mutate({ kind: "locations", action: "delete", id: "office", version: 1, replacementId: added.id, replacementVersion: 1 });
  const after = await adapter.load();
  assert.deepEqual(after.allocationsByItem, before.allocationsByItem);
  assert.deepEqual(after.orders, before.orders);
  assert.ok(after.containers.some(row => row.id === "empty" && row.locationId === added.id && !row.isActive));
  assert.equal(transport.writes.filter(row => row.path.includes("stock-allocations")).length, 0);
});

test("canonical item reference patches exclude legacy strings and unchanged inactive assignments", () => {
  const catalogs = { categories: [{ id: "skin", isActive: true }, { id: "old", isActive: false }], locations: [{ id: "office", isActive: true }, { id: "deleted", isActive: true, deletedAt: "2026-01-01" }] };
  assert.deepEqual(canonicalItemReferences({ categoryId: "skin", category: "legacy", locationId: "office", location: "Kiehl's Bag" }, null, catalogs), { categoryId: "skin", locationId: "office" });
  assert.deepEqual(canonicalItemReferences({ categoryId: "old", locationId: "office" }, { categoryId: "old", locationId: "office" }, catalogs), {});
  assert.throws(() => canonicalItemReferences({ categoryId: "old", locationId: "office" }, null, catalogs), /active category/);
  assert.throws(() => canonicalItemReferences({ categoryId: "skin", locationId: "deleted" }, null, catalogs), /active location/);
  assert.deepEqual(canonicalItemReferences({ categoryId: "old", locationId: "office" }, { categoryId: "old", locationId: "previous" }, catalogs), { locationId: "office" });
});

test("name validation normalizes whitespace and counts code points, server remains authoritative for historical aliases", () => {
  assert.equal(validateCatalogName("  Face\tCare \n", []), "Face Care");
  assert.equal(validateCatalogName("😀".repeat(100), []).length, 200);
  assert.throws(() => validateCatalogName("😀".repeat(101), []), /100/);
  assert.throws(() => validateCatalogName("Bad\u0001name", []), /control/);
  assert.throws(() => validateCatalogName("RETired", [{ id: "a", name: "Retired", isActive: false, deletedAt: "yesterday" }]), /exists/);
});
