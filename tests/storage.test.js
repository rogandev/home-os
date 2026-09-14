import test from "node:test";
import assert from "node:assert/strict";
import {
  allocationPayload,
  allocationRows,
  allocationTotal,
  moveStock,
  setAllocationQuantity,
} from "../src/storage.js";

const containers = [
  { id: "blue-box", name: "Tim's Blue Box", locationId: "bathroom", locationName: "Bathroom", isActive: true, isCompatibility: false },
  { id: "closet-bin", name: "Closet Backstock Bin", locationId: "closet", locationName: "Walk-in Closet", isActive: true, isCompatibility: false },
];

test("joins persisted allocations to available containers", () => {
  const rows = allocationRows([
    { containerId: "blue-box", containerName: "Tim's Blue Box", locationName: "Bathroom", quantity: 2 },
  ], containers);

  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.containerId === "blue-box").quantity, 2);
  assert.equal(rows.find(row => row.containerId === "closet-bin").quantity, 0);
});

test("moving stock preserves the authoritative combined total", () => {
  const rows = allocationRows([{ containerId: "blue-box", quantity: 3 }], containers);
  const moved = moveStock(rows, "blue-box", "closet-bin", 2);

  assert.equal(allocationTotal(rows), 3);
  assert.equal(allocationTotal(moved), 3);
  assert.equal(moved.find(row => row.containerId === "blue-box").quantity, 1);
  assert.equal(moved.find(row => row.containerId === "closet-bin").quantity, 2);
});

test("invalid quantities and ambiguous moves are rejected locally", () => {
  const rows = allocationRows([{ containerId: "blue-box", quantity: 1 }], containers);
  assert.throws(() => setAllocationQuantity(rows, "blue-box", -1), /whole numbers/);
  assert.throws(() => moveStock(rows, "blue-box", "closet-bin", 2), /enough stock/);
  assert.throws(() => moveStock(rows, "blue-box", "blue-box", 1), /different containers/);
});

test("allocation payload omits zero-quantity rows", () => {
  const rows = allocationRows([{ containerId: "blue-box", quantity: 2 }], containers);
  assert.deepEqual(allocationPayload(rows), [{ containerId: "blue-box", quantity: 2 }]);
});
