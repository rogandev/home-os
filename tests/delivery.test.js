import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { deliveryDatePayload, deliveryStatus, dueDeliveryOrders, expectedDeliveryDatePayload, isCalendarDate, localDate, millisecondsUntilTomorrow, receiptDatePayload } from "../src/delivery.js";

test("calendar dates reject normalized invalid dates and accept leap years", () => {
  for (const value of [null, undefined, "", "2026-2-01", "2026-02-29", "2026-04-31", "2026-13-01", "0000-01-01", "1900-02-29", "2026-10-02T00:00:00Z"]) {
    assert.equal(isCalendarDate(value), false, String(value));
  }
  for (const value of ["2024-02-29", "2000-02-29", "2026-10-02", "0099-01-01"]) assert.equal(isCalendarDate(value), true, value);
});

test("new order dates are required and delivery may be unknown or on the order day", () => {
  assert.deepEqual(deliveryDatePayload({ orderedDate: "2026-10-02", expectedDeliveryDate: "" }), { orderedDate: "2026-10-02", expectedDeliveryDate: null });
  assert.deepEqual(deliveryDatePayload({ orderedDate: "2026-10-02", expectedDeliveryDate: "2026-10-02" }), { orderedDate: "2026-10-02", expectedDeliveryDate: "2026-10-02" });
  assert.throws(() => deliveryDatePayload({ orderedDate: "" }), /order date/);
  assert.throws(() => deliveryDatePayload({ orderedDate: "2026-10-02", expectedDeliveryDate: "2026-10-01" }), /before the order date/);
  assert.throws(() => deliveryDatePayload({ orderedDate: "2026-10-02", expectedDeliveryDate: "2026-02-29" }), /valid expected/);
});

test("legacy missing order dates stay unknown; recorded dates cannot be cleared", () => {
  for (const existingOrder of [{}, { orderedDate: null }]) {
    assert.deepEqual(deliveryDatePayload({ orderedDate: "", expectedDeliveryDate: "2026-10-03" }, { existingOrder }), { expectedDeliveryDate: "2026-10-03" });
  }
  assert.throws(() => deliveryDatePayload({ orderedDate: "", expectedDeliveryDate: "" }, { existingOrder: { orderedDate: "2026-10-01" } }), /order date/);
});

test("receipt dates are explicit local calendar dates without invented ordering restrictions", () => {
  assert.deepEqual(receiptDatePayload("2026-10-01"), { receivedDate: "2026-10-01" });
  assert.throws(() => receiptDatePayload("2026-02-29"), /date this stock arrived/);
  assert.throws(() => receiptDatePayload(""), /date this stock arrived/);
});

test("only due and overdue open orders with remaining stock prompt for confirmation", () => {
  const open = { status: "open", remainingQuantity: 3, expectedDeliveryDate: "2026-10-02" };
  assert.deepEqual(deliveryStatus(open, "2026-10-02"), { kind: "due", label: "Expected today", needsConfirmation: true });
  assert.deepEqual(deliveryStatus(open, "2026-10-03"), { kind: "overdue", label: "1 day overdue", needsConfirmation: true });
  assert.deepEqual(deliveryStatus(open, "2026-10-04"), { kind: "overdue", label: "2 days overdue", needsConfirmation: true });
  assert.equal(deliveryStatus(open, "2026-10-01").needsConfirmation, false);
  for (const order of [null, {}, { ...open, expectedDeliveryDate: null }, { ...open, expectedDeliveryDate: "not-a-date" }, { ...open, remainingQuantity: 0 }, { ...open, status: "received" }, { ...open, status: "cancelled" }]) {
    assert.equal(deliveryStatus(order, "2026-10-02"), null);
  }
  assert.equal(open.status, "open");
  assert.equal(open.remainingQuantity, 3);
});

test("defaults use the local day across positive and negative UTC offsets", () => {
  const module = new URL("../src/delivery.js", import.meta.url).href;
  const script = `import { localDate } from ${JSON.stringify(module)}; console.log(localDate(new Date("2026-10-02T03:00:00Z")));`;
  const inTimezone = timezone => execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timezone }, encoding: "utf8" }).trim();
  assert.equal(inTimezone("America/Los_Angeles"), "2026-10-01");
  assert.equal(inTimezone("Pacific/Auckland"), "2026-10-02");
  assert.equal(localDate(new Date(2026, 9, 2)), "2026-10-02");
});

test("midnight refresh and overdue day counts handle DST days", () => {
  const module = new URL("../src/delivery.js", import.meta.url).href;
  const script = `import { millisecondsUntilTomorrow } from ${JSON.stringify(module)}; console.log(JSON.stringify([millisecondsUntilTomorrow(new Date(2026, 2, 8)), millisecondsUntilTomorrow(new Date(2026, 10, 1))]));`;
  const durations = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: "America/Los_Angeles" }, encoding: "utf8" }));
  assert.deepEqual(durations, [23 * 3600000, 25 * 3600000]);
  assert.equal(deliveryStatus({ status: "open", remainingQuantity: 1, expectedDeliveryDate: "2026-03-08" }, "2026-03-09").label, "1 day overdue");
  assert.equal(millisecondsUntilTomorrow(new Date(2026, 9, 2, 23, 59, 59)), 1000);
});

test("due deliveries prioritize oldest overdue orders, then today, without changing the source", () => {
  const open = { status: "open", remainingQuantity: 3 };
  const orders = [
    { ...open, id: "today", expectedDeliveryDate: "2026-10-03" },
    { ...open, id: "future", expectedDeliveryDate: "2026-10-04" },
    { ...open, id: "late", expectedDeliveryDate: "2026-09-30" },
    { ...open, id: "unknown", expectedDeliveryDate: null },
    { ...open, id: "same-date", expectedDeliveryDate: "2026-09-30" },
    { ...open, id: "invalid", expectedDeliveryDate: "2026-02-29" },
    { ...open, id: "received", status: "received", expectedDeliveryDate: "2026-09-01" },
    { ...open, id: "cancelled", status: "cancelled", expectedDeliveryDate: "2026-09-01" },
    { ...open, id: "empty", remainingQuantity: 0, expectedDeliveryDate: "2026-09-01" },
    { ...open, id: "missing-quantity", remainingQuantity: undefined, expectedDeliveryDate: "2026-09-01" },
  ];
  const original = structuredClone(orders);
  assert.deepEqual(dueDeliveryOrders(orders, "2026-10-03").map(order => order.id), ["late", "same-date", "today"]);
  assert.deepEqual(orders, original);
  assert.deepEqual(dueDeliveryOrders(orders, "invalid"), []);
});

test("due delivery sorting uses the browser's local day across timezones and DST", () => {
  const module = new URL("../src/delivery.js", import.meta.url).href;
  const script = `import { dueDeliveryOrders, localDate } from ${JSON.stringify(module)};
    const orders = ["2026-03-09", "2026-03-08", "2026-03-07"].map(expectedDeliveryDate => ({ status: "open", remainingQuantity: 1, expectedDeliveryDate }));
    console.log(JSON.stringify(dueDeliveryOrders(orders, localDate(new Date("2026-03-09T03:00:00Z"))).map(order => order.expectedDeliveryDate)));`;
  const inTimezone = timezone => JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: timezone }, encoding: "utf8" }));
  assert.deepEqual(inTimezone("America/Los_Angeles"), ["2026-03-07", "2026-03-08"]);
  assert.deepEqual(inTimezone("Pacific/Auckland"), ["2026-03-07", "2026-03-08", "2026-03-09"]);
});

test("Not yet only changes the optional expected date and preserves unknown history", () => {
  const order = { id: "order-1", status: "open", orderedQuantity: 5, remainingQuantity: 3, orderedDate: "2026-10-01", expectedDeliveryDate: "2026-10-02" };
  const original = structuredClone(order);
  assert.deepEqual(expectedDeliveryDatePayload(order, "2026-10-04"), { expectedDeliveryDate: "2026-10-04" });
  assert.deepEqual(expectedDeliveryDatePayload(order, ""), { expectedDeliveryDate: null });
  assert.deepEqual(expectedDeliveryDatePayload({ ...order, orderedDate: null }, "2026-09-01"), { expectedDeliveryDate: "2026-09-01" });
  assert.throws(() => expectedDeliveryDatePayload(order, "2026-09-30"), /before the order date/);
  assert.throws(() => expectedDeliveryDatePayload(order, "2026-02-29"), /valid expected/);
  for (const stale of [null, { ...order, status: "received" }, { ...order, remainingQuantity: 0 }]) {
    assert.throws(() => expectedDeliveryDatePayload(stale, "2026-10-04"), /no longer awaiting/);
  }
  assert.deepEqual(order, original);
});
