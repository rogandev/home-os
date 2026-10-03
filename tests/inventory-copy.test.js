import test from "node:test";
import assert from "node:assert/strict";
import { createInventoryCopySaver, inventoryCopyDraft, validateInventoryCopy } from "../src/inventory-copy.js";

const source = {
  id: 41, name: "Face wash", brand: "Sample", description: "Gentle wash", category: "Skin Care",
  size: "100 ml", form: "Bottle", notes: "Use daily", quantity: 3, reorder_at: 2,
  location: "Walk-in Closet", replenishmentPolicy: "auto_replenish", status: "awaiting_shipment",
  created_at: "old-date", updated_at: "old-date", incomingQuantity: 4,
  orders: [{ id: 18 }], history: [{ id: 22 }],
};
const allocations = [
  { itemId: 41, containerId: "shelf", quantity: 2, created_at: "old-date" },
  { itemId: 41, containerId: "bag", quantity: 1 },
  { itemId: 41, containerId: "drawer", quantity: 0 },
];
const draft = () => inventoryCopyDraft(source, allocations);

test("size-only edit preserves all editable values and deep allocations, never identity/history/orders", () => {
  const original = structuredClone({ source, allocations });
  const copy = draft();
  assert.deepEqual(copy.allocations, allocations.map(({ containerId, quantity }) => ({ containerId, quantity })));
  for (const key of ["id", "status", "created_at", "updated_at", "orders", "history", "incomingQuantity"]) assert.equal(key in copy, false);
  const before = structuredClone(copy);
  copy.size = "200 ml";
  assert.deepEqual({ ...copy, size: before.size }, before);
  copy.allocations[0].quantity = 99;
  assert.deepEqual({ source, allocations }, original);
  assert.equal(before.description, source.description);
});

test("opening and cancelling a draft makes zero requests", () => {
  let requests = 0;
  createInventoryCopySaver(() => { requests += 1; });
  draft();
  assert.equal(requests, 0);
});

test("zero/empty and multiple allocations validate, but mismatches/invalid quantities do not", () => {
  validateInventoryCopy(draft());
  validateInventoryCopy(inventoryCopyDraft({ ...source, quantity: 0 }, []));
  validateInventoryCopy(inventoryCopyDraft({ ...source, quantity: 0 }, [{ containerId: "drawer", quantity: 0 }]));
  assert.throws(() => validateInventoryCopy({ ...draft(), quantity: 4 }), /must match/);
  assert.throws(() => validateInventoryCopy({ ...draft(), allocations: [{ containerId: "shelf", quantity: -1 }] }), /whole numbers/);
  assert.throws(() => validateInventoryCopy({ ...draft(), allocations: [{ containerId: "shelf", quantity: 1.5 }] }), /whole numbers/);
  assert.throws(() => validateInventoryCopy({ ...draft(), allocations: [{ containerId: "shelf", quantity: 1 }, { containerId: "shelf", quantity: 2 }] }), /only once/);
});

test("rapid repeated saves share one request and confirmed retries return cached result", async () => {
  let calls = 0;
  let release;
  const response = { id: 99, allocations: [] };
  const saver = createInventoryCopySaver(async () => { calls += 1; await new Promise(resolve => { release = resolve; }); return response; }, () => "one-key");
  const first = saver.save(draft());
  const second = saver.save(draft());
  assert.equal(first, second);
  assert.equal(saver.pending, true);
  await Promise.resolve();
  release();
  assert.equal(await first, response);
  assert.equal(await saver.save(draft()), response);
  assert.equal(calls, 1);
});

test("lost response retry keeps the exact body/key even if caller changes its draft", async () => {
  const bodies = [];
  const saver = createInventoryCopySaver(async (path, options) => {
    assert.equal(path, "/items");
    bodies.push(options.body);
    if (bodies.length === 1) throw new TypeError("Failed to fetch");
    return { id: 99, allocations: [] };
  }, () => "same-key");
  await assert.rejects(saver.save(draft()), error => error.uncertain === true);
  assert.equal(saver.uncertain, true);
  const result = await saver.save({ ...draft(), size: "unsafe late edit" });
  assert.equal(result.id, 99);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(saver.uncertain, false);
});

test("validation failure is editable and a corrected retry uses a new intent", async () => {
  const bodies = [];
  let key = 0;
  const saver = createInventoryCopySaver(async (_path, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw Object.assign(new Error("invalid container"), { status: 400 });
    return { id: 99, allocations: [] };
  }, () => `key-${++key}`);
  await assert.rejects(saver.save(draft()), error => error.uncertain === false);
  await saver.save({ ...draft(), size: "200 ml" });
  assert.notEqual(bodies[0].createRequestId, bodies[1].createRequestId);
  assert.equal(bodies[1].size, "200 ml");
});

test("a malformed success or conflict stays recoverable under the same key", async () => {
  for (const response of [null, { id: 99 }, Object.assign(new Error("key conflict"), { status: 409 })]) {
    const saver = createInventoryCopySaver(async () => { if (response instanceof Error) throw response; return response; }, () => "key");
    await assert.rejects(saver.save(draft()), error => error.uncertain === true);
    assert.equal(saver.uncertain, true);
  }
});

test("a rejection after an ambiguous response cannot release the original frozen intent", async () => {
  let attempts = 0;
  const saver = createInventoryCopySaver(async () => { throw Object.assign(new Error("offline"), attempts++ ? { status: 401 } : {}); }, () => "key");
  await assert.rejects(saver.save(draft()), error => error.uncertain);
  await assert.rejects(saver.save(draft()), error => error.uncertain);
});

test("an oversized request rejection allows editing and a corrected save", async () => {
  const bodies = [];
  let key = 0;
  const saver = createInventoryCopySaver(async (_path, options) => {
    bodies.push(JSON.parse(options.body));
    if (bodies.length === 1) throw Object.assign(new Error("request entity too large"), { status: 413 });
    return { id: 99, allocations: [] };
  }, () => `key-${++key}`);
  await assert.rejects(saver.save({ ...draft(), notes: "x".repeat(110000) }), error => error.uncertain === false);
  await saver.save({ ...draft(), notes: "Short corrected notes" });
  assert.equal(bodies[1].notes, "Short corrected notes");
  assert.notEqual(bodies[0].createRequestId, bodies[1].createRequestId);
});
