import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";

async function fixture({ enabled = true, failPatch = 0, failRefresh = false, delayPatch = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const originals = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.scrollTo = () => {};
  const items = ["today", "oldest", "late", "future", "unknown", "need", "legacy"].map(id => ({ id, name: `${id} item`, brand: "", category: "Skin Care", quantity: id === "need" ? 0 : 2, reorder_at: 1, location: "Kitchen", status: id === "need" ? "need_to_order" : "awaiting_shipment" }));
  const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`;
  const orders = ["today", "oldest", "late", "future", "unknown"].map(id => ({ id: `${id}-order`, itemId: id, status: "open", orderedQuantity: 5, remainingQuantity: 3, orderedDate: id === "unknown" ? null : "1999-01-01", expectedDeliveryDate: ({ today, oldest: "2000-01-01", late: "2000-01-02", future: "2099-01-01", unknown: null })[id] }));
  const writes = [];
  let saved = false;
  let releasePatch;
  const patchGate = new Promise(resolve => { releasePatch = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace(/^\/home-os/, "");
    const method = options.method || "GET";
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (method !== "GET") {
      writes.push({ path, method, body: options.body ? JSON.parse(options.body) : undefined });
      if (delayPatch) await patchGate;
      if (failPatch) return response({ error: "Date rejected by server" }, failPatch);
      assert.equal(method, "PATCH");
      assert.equal(path, "/orders/oldest-order");
      const patch = JSON.parse(options.body);
      assert.deepEqual(Object.keys(patch), ["expectedDeliveryDate"]);
      Object.assign(orders.find(order => order.id === "oldest-order"), patch);
      saved = true;
      return response(orders.find(order => order.id === "oldest-order"));
    }
    if (saved && failRefresh && path === "/orders") return response({ error: "Refresh unavailable" }, 503);
    if (path === "/items") return response(items);
    if (path === "/orders") return response(orders);
    if (path === "/stats") return response({ total_items: items.length, total_units: 12, need_to_order: 1, awaiting_shipment: 6 });
    if (path === "/locations") return response([{ id: "kitchen", name: "Kitchen", isActive: true }]);
    if (path === "/containers") return response([{ id: "shelf", name: "Shelf", locationName: "Kitchen", isActive: true }]);
    if (/\/stock-allocations$/.test(path)) return response([]);
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, define: { "import.meta.env.VITE_HOME_DELIVERY_TRACKING": JSON.stringify(String(enabled)), "import.meta.env.VITE_ROGAN_API_URL": JSON.stringify("http://localhost:3001") } });
  const { default: App } = await server.ssrLoadModule("/src/App.jsx");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root"));
  await act(async () => { root.render(createElement(App)); });
  const byText = text => [...document.querySelectorAll("button")].find(button => button.textContent === text);
  const click = async button => { assert.ok(button, "button exists"); await act(async () => { button.click(); }); };
  const changeDate = async value => {
    const input = document.querySelector('[aria-label="Updated expected delivery date"]');
    assert.ok(input, "date editor exists");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  return {
    dom, writes, items, orders, click, byText, changeDate, releasePatch,
    async openOrders() { await click([...document.querySelectorAll("button")].find(button => /^Orders/.test(button.textContent))); },
    async openNotYet() { await click(document.querySelector('section[aria-label="Due and overdue deliveries"] [aria-label="Not yet arrived: oldest item"]')); },
    async close() {
      await act(async () => { root.unmount(); });
      await server.close();
      globalThis.fetch = originalFetch;
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
      }
      dom.window.close();
    },
  };
}

// Run these sequentially: every fixture owns a document and a fresh Vite module
// graph, including its own shared order mutation guard.
test("delivery check-in UI", async t => {
  await t.test("compact overdue/today list is first, sorted, unique, and never auto-receives", async () => {
    const f = await fixture();
    try {
      await f.openOrders();
      const section = document.querySelector('section[aria-label="Due and overdue deliveries"]');
      assert.ok(section);
      assert.equal(section.parentElement.firstElementChild, section);
      assert.deepEqual([...section.querySelectorAll("li")].map(row => row.firstElementChild.firstElementChild.textContent), ["oldest item", "late item", "today item"]);
      assert.equal(document.body.textContent.split("oldest item").length - 1, 1);
      assert.match(section.textContent, /Did this arrive\? \(3\)/);
      assert.match(document.body.textContent, /NEED TO ORDER \(1\)/);
      assert.match(document.body.textContent, /ALREADY COMING \(3\)/);
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(f.writes, []);
      await f.click(section.querySelector('[aria-label="Confirm arrival for oldest item"]'));
      assert.ok(document.querySelector('[aria-label="Quantity received"]'));
      assert.ok(document.querySelector('[aria-label="Received into container"]'));
      assert.ok(document.querySelector('[aria-label="Actual arrival date"]'));
      assert.deepEqual(f.writes, []);
    } finally { await f.close(); }
  });

  await t.test("Not yet opens optional date editing; Keep waiting and Escape send no writes", async () => {
    const f = await fixture();
    try {
      await f.openOrders();
      await f.openNotYet();
      assert.equal(document.querySelector('[aria-label="Quantity received"]'), null);
      assert.equal(f.byText("Save expected date").disabled, true);
      await f.changeDate("2099-01-02");
      await f.click(f.byText("Keep waiting"));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await f.openNotYet();
      assert.equal(document.querySelector('[aria-label="Updated expected delivery date"]').value, "2000-01-01");
      await act(async () => document.dispatchEvent(new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      assert.deepEqual(f.writes, []);
    } finally { await f.close(); }
  });

  await t.test("saving a new date performs one date-only PATCH and moves the row out of due deliveries", async () => {
    const f = await fixture();
    try {
      const beforeItems = structuredClone(f.items);
      await f.openOrders(); await f.openNotYet(); await f.changeDate("2099-01-02");
      await f.click(f.byText("Save expected date"));
      assert.deepEqual(f.writes, [{ path: "/orders/oldest-order", method: "PATCH", body: { expectedDeliveryDate: "2099-01-02" } }]);
      assert.equal(document.querySelector('[role="dialog"]'), null);
      const section = document.querySelector('section[aria-label="Due and overdue deliveries"]');
      assert.doesNotMatch(section.textContent, /oldest item/);
      assert.match(document.body.textContent, /ALREADY COMING \(4\)/);
      assert.deepEqual(f.items, beforeItems);
      assert.equal(f.orders.find(order => order.id === "oldest-order").remainingQuantity, 3);
      assert.equal(f.orders.find(order => order.id === "oldest-order").status, "open");
    } finally { await f.close(); }
  });

  await t.test("clearing the optional date preserves the open order and its stock", async () => {
    const f = await fixture();
    try {
      await f.openOrders(); await f.openNotYet(); await f.changeDate("");
      await f.click(f.byText("Save expected date"));
      assert.deepEqual(f.writes[0].body, { expectedDeliveryDate: null });
      assert.equal(f.orders[1].status, "open");
      assert.equal(f.orders[1].remainingQuantity, 3);
      assert.match(document.body.textContent, /Delivery date not set/);
    } finally { await f.close(); }
  });

  await t.test("invalid dates stay editable and do not lock order mutations", async () => {
    const f = await fixture();
    try {
      await f.openOrders(); await f.openNotYet(); await f.changeDate("1998-01-01");
      await f.click(f.byText("Save expected date"));
      assert.match(document.querySelector('[role="alert"]').textContent, /before the order date/);
      assert.deepEqual(f.writes, []);
      assert.equal(document.querySelector("fieldset").disabled, false);
      await f.changeDate("2099-01-02"); await f.click(f.byText("Save expected date"));
      assert.equal(f.writes.length, 1);
    } finally { await f.close(); }
  });

  await t.test("repeated save clicks and dismissal while saving cannot replay the patch", async () => {
    const f = await fixture({ delayPatch: true });
    try {
      await f.openOrders(); await f.openNotYet(); await f.changeDate("2099-01-02");
      const save = f.byText("Save expected date");
      await act(async () => { save.click(); save.click(); });
      assert.equal(f.writes.length, 1);
      assert.ok(document.querySelector("fieldset").disabled);
      await act(async () => document.dispatchEvent(new f.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      assert.ok(document.querySelector('[role="dialog"]'));
      await act(async () => f.releasePatch());
      assert.equal(f.writes.length, 1);
      assert.equal(document.querySelector('[role="dialog"]'), null);
    } finally { f.releasePatch(); await f.close(); }
  });

  await t.test("a definite server rejection leaves fields available for correction", async () => {
    const f = await fixture({ failPatch: 400 });
    try {
      await f.openOrders(); await f.openNotYet(); await f.changeDate("2099-01-02");
      await f.click(f.byText("Save expected date"));
      assert.match(document.querySelector('[role="alert"]').textContent, /Date rejected by server/);
      assert.equal(document.querySelector("fieldset").disabled, false);
      assert.equal(f.writes.length, 1);
    } finally { await f.close(); }
  });

  for (const options of [{ failPatch: 503 }, { failRefresh: true }]) {
    await t.test(`uncertain/saved-then-refresh-failed result requires reload: ${JSON.stringify(options)}`, async () => {
      const f = await fixture(options);
      try {
        await f.openOrders(); await f.openNotYet(); await f.changeDate("2099-01-02");
        await f.click(f.byText("Save expected date"));
        assert.ok(f.byText("Reload data"));
        assert.equal(document.querySelector('section[aria-label="Due and overdue deliveries"]'), null);
        assert.equal(f.writes.length, 1);
        if (options.failRefresh) assert.match(document.body.textContent, /change was saved/);
      } finally { await f.close(); }
    });
  }

  await t.test("flag off preserves the old Orders sections and hides every new check-in control", async () => {
    const f = await fixture({ enabled: false });
    try {
      assert.equal(document.querySelector('[aria-label^="Not yet arrived:"]'), null);
      await f.openOrders();
      assert.equal(document.querySelector('section[aria-label="Due and overdue deliveries"]'), null);
      assert.doesNotMatch(document.body.textContent, /Did this arrive\?|Not yet/);
      assert.match(document.body.textContent, /ALREADY COMING \(6\)/);
      assert.deepEqual(f.writes, []);
    } finally { await f.close(); }
  });
});
