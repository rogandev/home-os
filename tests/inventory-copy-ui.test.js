import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";

async function fixture({ enabled = true, allocationError = false, failFirst = 0, lostResponse = false, delay = false, addRefreshError = false, quantity = 3, allocations = [{ containerId: "shelf", quantity: 2 }, { containerId: "bag", quantity: 1 }, { containerId: "drawer", quantity: 0 }] } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const originals = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.scrollTo = () => {};
  const source = { id: 41, name: "Face wash", brand: "Sample", description: "Gentle", category: "Skin Care", location: "Walk-in Closet", quantity, reorder_at: 2, size: "100 ml", form: "Bottle", notes: "Keep upright", replenishmentPolicy: "auto_replenish", status: "awaiting_shipment", created_at: "old", updated_at: "old" };
  const items = [source];
  const orders = [{ id: 1, itemId: 41, status: "open", orderedQuantity: 4, remainingQuantity: 4 }];
  const before = structuredClone({ source, allocations, orders });
  const writes = [], reads = [], results = new Map();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname.replace(/^\/home-os/, "");
    const method = options.method || "GET";
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (method !== "GET") {
      writes.push({ path, method, body: JSON.parse(options.body) });
      assert.equal(path, "/items"); assert.equal(method, "POST");
      if (delay) await gate;
      if (failFirst && writes.length === 1) return response({ error: "Rejected request" }, failFirst);
      const body = JSON.parse(options.body);
      let created = results.get(body.createRequestId);
      if (!created || !body.createRequestId) {
        const { createRequestId, allocations: rows = [], ...fields } = body;
        created = { ...fields, id: 99, status: "normal", allocations: rows.map(row => ({ ...row, itemId: 99 })) };
        items.push(created);
        if (createRequestId) results.set(createRequestId, created);
      }
      if (lostResponse && writes.length === 1) throw new TypeError("Lost response after commit");
      return response(created, 201);
    }
    reads.push(path);
    if (path === "/items") return response(items);
    if (path === "/orders") return response(orders);
    if (path === "/stats") return response({ total_items: items.length, total_units: 3 });
    if (path === "/locations") return response([{ id: "closet", name: "Walk-in Closet", isActive: true }]);
    if (path === "/containers") return response(["shelf", "bag", "drawer"].map(id => ({ id, name: id, locationName: "Walk-in Closet", isActive: true })));
    if (path === "/items/41/stock-allocations") return allocationError ? response({ error: "Unavailable" }, 500) : response(allocations);
    if (path === "/items/99/stock-allocations") return addRefreshError ? response({ error: "Unavailable" }, 500) : response([]);
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const server = await createServer({ configFile: false, root: process.cwd(), plugins: [react()], server: { middlewareMode: true, watch: null }, optimizeDeps: { noDiscovery: true, include: [] }, define: { "import.meta.env.VITE_HOME_INVENTORY_COPY": JSON.stringify(String(enabled)), "import.meta.env.VITE_HOME_DELIVERY_TRACKING": '"false"', "import.meta.env.VITE_ROGAN_API_URL": '"http://localhost:3001"' } });
  const { default: App } = await server.ssrLoadModule("/src/App.jsx");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(App)));
  const byText = text => [...document.querySelectorAll("button")].find(button => button.textContent === text);
  const input = name => document.querySelector(`input[aria-label="${name}"]`);
  const click = async button => { assert.ok(button, "button exists"); await act(async () => button.click()); };
  const change = async (name, value) => {
    await act(async () => {
      const field = input(name); assert.ok(field);
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(field, value);
      field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      field.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    });
  };
  return {
    dom, source, allocations, orders, before, items, writes, reads, results, byText, input, click, change, release,
    async open() { await click(document.querySelector('[data-item-id="41"] [aria-label="Copy Face wash"]')); },
    async escape() { await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); },
    async close() {
      release(); await act(async () => root.unmount()); await server.close(); globalThis.fetch = originalFetch;
      for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
      dom.window.close();
    },
  };
}

test("inventory Copy component flow", async t => {
  await t.test("opening, editing, Cancel, Close, Escape and backdrop make no writes", async () => {
    const f = await fixture();
    try {
      await f.open();
      for (const [label,value] of [["Product name","Face wash"],["Description","Gentle"],["Brand","Sample"],["Size","100 ml"],["Form","Bottle"],["Notes","Keep upright"],["Quantity","3"],["Reorder at","2"]]) assert.equal(f.input(label).value,value);
      assert.equal(f.input("drawer copy quantity").value,"0");
      await f.change("Size","200 ml"); await f.click(f.byText("Cancel"));
      assert.equal(document.querySelector('[role="dialog"]'),null);
      await f.open(); assert.equal(f.input("Size").value,"100 ml"); await f.escape();
      await f.open(); await f.click(document.querySelector('[aria-label="Close Copy Item"]'));
      await f.open(); await f.click(document.querySelector('.modal-backdrop'));
      assert.equal(document.querySelector('[role="dialog"]'),null);
      assert.deepEqual(f.writes,[]);
      assert.deepEqual({source:f.source,allocations:f.allocations,orders:f.orders},f.before);
    } finally { await f.close(); }
  });
  await t.test("size-only save preserves all fields and storage, creates one independent item without extra GET", async () => {
    const f = await fixture({delay:true});
    try {
      await f.open(); await f.change("Size","200 ml");
      const button=f.byText("Save Copy"); await act(async()=>{button.click();button.click();});
      assert.equal(f.writes.length,1); await f.escape(); assert.ok(document.querySelector('[role="dialog"]'));
      assert.ok(document.querySelector('fieldset').disabled);
      await act(async()=>f.release());
      assert.equal(document.querySelector('[role="dialog"]'),null);
      const body=f.writes[0].body;
      assert.equal(body.size,"200 ml"); assert.equal(body.description,"Gentle");
      assert.deepEqual(body.allocations,f.allocations);
      for(const k of ['id','status','created_at','updated_at','orders','history']) assert.equal(k in body,false);
      assert.equal(f.items.length,2); assert.notEqual(f.items[1].id,f.source.id);
      assert.equal(f.reads.includes('/items/99/stock-allocations'),false);
      assert.deepEqual({source:f.source,allocations:f.allocations,orders:f.orders},f.before);
    } finally { await f.close(); }
  });
  await t.test("lost committed response freezes fields and dismissal; safe retry resolves same record", async () => {
    const f=await fixture({lostResponse:true});
    try {
      await f.open(); await f.click(f.byText('Save Copy'));
      assert.equal(f.items.length,2); assert.ok(document.querySelector('fieldset').disabled);
      assert.ok(f.byText('Cancel').disabled); await f.escape(); assert.ok(document.querySelector('[role="dialog"]'));
      await f.click(f.byText('Retry Save Safely'));
      assert.equal(f.items.length,2); assert.equal(f.writes.length,2); assert.deepEqual(f.writes[0],f.writes[1]);
      assert.equal(document.querySelector('[role="dialog"]'),null);
    } finally { await f.close(); }
  });
  for(const status of [400,413]) await t.test(`${status} rejection stays editable and permits correction`,async()=>{
    const f=await fixture({failFirst:status});
    try { await f.open(); await f.click(f.byText('Save Copy')); assert.equal(document.querySelector('fieldset').disabled,false); await f.change('Notes','Corrected'); await f.click(f.byText('Save Copy')); assert.equal(f.writes[1].body.notes,'Corrected'); assert.notEqual(f.writes[0].body.createRequestId,f.writes[1].body.createRequestId); assert.equal(f.items.length,2); }
    finally { await f.close(); }
  });
  await t.test("editing storage changes only draft quantities and total",async()=>{
    const f=await fixture(); try {await f.open(); await f.change('shelf copy quantity','5'); assert.equal(f.input('Quantity').value,'6'); assert.deepEqual(f.allocations,f.before.allocations); await f.click(f.byText('Save Copy')); assert.equal(f.writes[0].body.quantity,6); assert.equal(f.writes[0].body.allocations[0].quantity,5);}finally{await f.close();}
  });
  for(const rows of [[],[{containerId:'drawer',quantity:0}]]) await t.test(`zero total preserves ${rows.length} storage rows`,async()=>{
    const f=await fixture({quantity:0,allocations:rows});try{await f.open(); await f.click(f.byText('Save Copy'));assert.equal(f.writes[0].body.quantity,0);assert.deepEqual(f.writes[0].body.allocations,rows);}finally{await f.close();}
  });
  await t.test("unavailable source allocations block copying",async()=>{const f=await fixture({allocationError:true});try{await f.open(); assert.equal(document.querySelector('[role="dialog"]'),null); assert.match(document.querySelector('[role="alert"]').textContent,/Reload before copying/); assert.equal(f.writes.length,0);}finally{await f.close();}});
  await t.test("legacy Add closes after committed create even if storage refresh fails",async()=>{const f=await fixture({addRefreshError:true});try{await f.click(f.byText('+ Add Item'));await f.change('Product name','New item');await f.click(f.byText('Save Item'));assert.equal(document.querySelector('[role="dialog"]'),null);assert.equal(f.writes.length,1);assert.equal(f.items.length,2);}finally{await f.close();}});
  await t.test("off by default leaves Copy absent and existing inventory actions available",async()=>{const f=await fixture({enabled:false});try{assert.equal(f.byText('Copy'),undefined);assert.ok(f.byText('Edit'));assert.ok(f.byText('+ Add Item'));assert.deepEqual(f.writes,[]);}finally{await f.close();}});
});
