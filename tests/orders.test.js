import test from "node:test";
import assert from "node:assert/strict";
import {
  openOrderMap,
  receivedOrderQuantity,
  suggestedOrderQuantity,
  validateOrderCorrection,
  validateReceipt,
} from "../src/orders.js";

test("suggests enough incoming stock to move above the reorder threshold", () => {
  assert.equal(suggestedOrderQuantity({ quantity: 0, reorder_at: 2 }), 3);
  assert.equal(suggestedOrderQuantity({ quantity: 4, reorder_at: 1 }), 1);
});

test("order corrections preserve quantities already received", () => {
  const order = { orderedQuantity: 5, remainingQuantity: 3 };
  assert.equal(receivedOrderQuantity(order), 2);
  assert.equal(validateOrderCorrection(order, 4), 4);
  assert.throws(() => validateOrderCorrection(order, 2), /already received/);
});

test("receipts require a valid amount and an explicit container", () => {
  const order = { remainingQuantity: 2 };
  assert.deepEqual(validateReceipt(order, 2, "blue-box"), { quantity: 2, containerId: "blue-box" });
  assert.throws(() => validateReceipt(order, 3, "blue-box"), /Only 2/);
  assert.throws(() => validateReceipt(order, 1, ""), /Choose the container/);
});

test("maps only open orders to their items", () => {
  const map = openOrderMap([
    { id: 1, itemId: 10, status: "open" },
    { id: 2, itemId: 11, status: "received" },
  ]);
  assert.equal(map.get(10).id, 1);
  assert.equal(map.has(11), false);
});
