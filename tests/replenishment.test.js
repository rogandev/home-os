import test from "node:test";
import assert from "node:assert/strict";
import { editableItemValues, replenishmentPolicyFor } from "../src/replenishment.js";

test("uses the API replenishment policy when present", () => {
  assert.equal(replenishmentPolicyFor({ replenishmentPolicy: "auto_replenish" }), "auto_replenish");
});

test("preserves legacy do-not-order items and defaults other items to manual", () => {
  assert.equal(replenishmentPolicyFor({ status: "do_not_order" }), "do_not_order");
  assert.equal(replenishmentPolicyFor({ status: "need_to_order" }), "manual");
});

test("edit values contain only user-editable API fields", () => {
  const values = editableItemValues({
    id: 42,
    name: "Bed Head Paste",
    status: "do_not_order",
    replenishmentPolicy: "do_not_order",
    created_at: "server-owned",
    updated_at: "server-owned",
  });

  assert.equal(values.name, "Bed Head Paste");
  assert.equal(values.replenishmentPolicy, "do_not_order");
  assert.equal(Object.hasOwn(values, "id"), false);
  assert.equal(Object.hasOwn(values, "status"), false);
  assert.equal(Object.hasOwn(values, "created_at"), false);
  assert.equal(Object.hasOwn(values, "updated_at"), false);
});
