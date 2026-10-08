import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createIntegratedFixture } from "../fixtures/integration/model.js";
import { inventoryCopyDraft } from "../src/inventory-copy.js";

test("combined browser fixture supports copy, catalogs, usage and confirmed receipt without a network", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("Unexpected network request"); };
  try {
    const f = createIntegratedFixture();
    const send = (path, method, body) => f.request(path, { method, body: JSON.stringify(body) });
    const before = structuredClone(f.state.items[0]);
    const draft = { ...inventoryCopyDraft(before, f.state.allocationsByItem.cream, { canonical: true }), createRequestId: randomUUID() };
    const copied = await send("/items", "POST", draft);
    assert.deepEqual(await send("/items", "POST", draft), copied);
    assert.equal(f.state.items.length, 3);
    assert.deepEqual(f.state.items[0], before);
    assert.equal(f.supply.usage.some(u => u.itemId === copied.id), false);
    const opening = { requestId: randomUUID(), containerId: "office-default", expectedActiveUsageId: null, date: "2026-10-08", replaceActive: false };
    await send(`/items/${copied.id}/usage/open`, "POST", opening);
    await send(`/items/${copied.id}/usage/open`, "POST", opening);
    assert.equal(f.state.items.find(i => i.id === copied.id).quantity, 1);
    await send(`/items/${copied.id}/usage/finish`, "POST", { requestId: randomUUID(), usageId: opening.requestId, date: "2026-10-09" });
    assert.equal(f.state.items.find(i => i.id === copied.id).quantity, 1);
    const category = f.state.categories[0];
    await send(`/categories/${category.id}`, "PATCH", { requestId: randomUUID(), version: category.version, name: "Renamed sample category" });
    assert.equal(f.state.items.find(i => i.id === copied.id).category, "Renamed sample category");
    await send("/orders/1/receive", "POST", { containerId: "office-default", quantity: 1, receivedDate: "2026-10-08" });
    assert.equal(f.state.items[0].quantity, before.quantity + 1);
    assert.equal((await f.request("/supply")).linkedOrders[0].remainingQuantity, 2);
    await send("/orders/1/receive", "POST", { containerId: "office-default", quantity: 2, receivedDate: "2026-10-08" });
    assert.equal((await f.request("/supply")).linkedOrders[0].status, "received");
    assert.equal((await f.load()).orders.length, 0);
    await assert.rejects(f.request("/not-a-fixture-route"), /Unexpected fixture/);
  } finally { globalThis.fetch = original; }
});
