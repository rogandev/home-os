import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";
import { createCatalogFixture } from "../fixtures/catalog/model.js";
import { validateCatalogName, validateReplacement } from "../src/catalog.js";

async function fixture({ app = false, enabled = true, management = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] }, define: { "import.meta.env.VITE_HOME_CATALOGS": JSON.stringify(String(app && enabled)), "import.meta.env.VITE_HOME_CATALOG_MANAGEMENT": JSON.stringify(String(management)) } });
  const { default: Manager } = await server.ssrLoadModule(app ? "/src/App.jsx" : "/src/CatalogManager.jsx");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const adapter = createCatalogFixture();
  const originalFetch = globalThis.fetch;
  const itemTransport = adapter;
  // App item writes use its existing JSON transport; catalog requests use the
  // injected adapter. Both are isolated; no network request can escape the test.
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\/home-os/, "") + parsed.search;
    const data = await itemTransport.request(path, options);
    return new Response(JSON.stringify(data), { status: 200 });
  };
  await act(async () => root.render(createElement(Manager, app ? { catalogAdapter: adapter } : { adapter })));
  const button = name => [...document.querySelectorAll("button")].find(el => (el.getAttribute("aria-label") || el.textContent) === name);
  const click = async name => { const el = button(name); assert.ok(el, name); await act(async () => el.click()); };
  const change = async (selector, value) => {
    const el = document.querySelector(selector);
    assert.ok(el, selector);
    await act(async () => {
      Object.getOwnPropertyDescriptor(el.tagName === "SELECT" ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype, "value").set.call(el, value);
      el.dispatchEvent(new dom.window.Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
    });
  };
  return { adapter, itemTransport, button, click, change, dom, async close() {
    await act(async () => root.unmount()); await server.close(); dom.window.close(); globalThis.fetch = originalFetch;
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  } };
}

test("catalog validation rejects missing, duplicate and invalid replacement values", () => {
  const records = [{ id: "a", name: "Skin Care", usageCount: 2, isActive: true, deletedAt: null }];
  assert.throws(() => validateCatalogName("  ", records), /Enter a name/);
  assert.throws(() => validateCatalogName("skin care ", records), /already exists/);
  assert.throws(() => validateCatalogName("x".repeat(101), records), /100/);
  assert.equal(validateCatalogName("  Face Care ", records), "Face Care");
  assert.throws(() => validateReplacement(records[0], "", records), /replacement/);
  assert.throws(() => validateReplacement(records[0], "a", records), /available/);
  assert.throws(() => validateReplacement(records[0], "missing", records), /available/);
});

test("catalog manager fixture interactions", async t => {
  await t.test("PR78 protected/inactive/tombstone controls and container usage", async () => {
    const f = await fixture(); try {
      assert.equal(f.button("Rename Retired category"), undefined);
      await f.click("Locations");
      assert.ok(f.button("Rename Kitchen"));
      assert.equal(f.button("Delete Kitchen"), undefined);
      assert.equal(f.button("Rename Inactive room"), undefined);
      assert.match(document.body.textContent, /4 assignments · 2 items · 2 containers/);
      await f.click("Delete Office");
      assert.equal(document.querySelector("dialog select option[value=inactive]"), null);
      await f.change("dialog select", "closet");
      f.adapter.configure({ failure: "collision" }); await f.click("Delete and save");
      assert.match(document.querySelector('[role="alert"]').textContent, /No stock was merged/);
      assert.equal(f.adapter.writes[0].body.replacementVersion, 1);
      assert.equal(f.button("Add location").disabled, true);
      f.adapter.configure(); await f.click("Reload values");
      assert.ok(f.button("Delete Office"));
    } finally { await f.close(); }
  });
  for (const kind of ["category", "location"]) {
    await t.test(`${kind}: add, duplicate, rename all assignments, cancel and replace`, async () => {
      const f = await fixture();
      try {
        if (kind === "location") await f.click("Locations");
        const original = kind === "category" ? "Skin Care" : "Office";
        const key = kind === "category" ? "categories" : "locations";
        const idKey = kind === "category" ? "categoryId" : "locationId";
        await f.click(`Add ${kind}`);
        await f.click("Save");
        assert.match(document.querySelector('[role="alert"]').textContent, /Enter/);
        await f.change("dialog input", ` ${original.toLowerCase()} `);
        await f.click("Save");
        assert.match(document.querySelector('[role="alert"]').textContent, /already exists/);
        assert.equal(f.adapter.writes.length, 0);
        await f.change("dialog input", " New value "); await f.click("Save");
        assert.ok(f.button("Rename New value"));
        await f.click(`Rename ${original}`); await f.change("dialog input", "New value"); await f.click("Save");
        assert.equal(f.adapter.writes.length, 1);
        await f.change("dialog input", "Renamed value"); await f.click("Save");
        let data = await f.adapter.load();
        assert.equal(data.items.filter(item => data[key].find(row => row.id === item[idKey]).name === "Renamed value").length, 2);
        await f.click("Delete Renamed value");
        assert.equal(f.button("Delete and save").disabled, true);
        await f.change("dialog select", "fixture-10"); await f.click("Cancel");
        assert.equal(f.adapter.writes.length, 2);
        await f.click("Delete Renamed value");
        assert.equal(document.querySelector("dialog select").value, "");
        await f.change("dialog select", "fixture-10"); await f.click("Delete and save");
        data = await f.adapter.load();
        assert.equal(data.items.filter(item => item[idKey] === "fixture-10").length, 2);
        assert.ok(data[key].find(row => row.name === "Renamed value").deletedAt);
      } finally { await f.close(); }
    });
  }
  await t.test("unused deletion needs no replacement; Escape cancels with no writes", async () => {
    const f = await fixture(); try {
      await f.click("Delete Hair Care"); assert.equal(document.querySelector("dialog select"), null);
      await act(async () => document.querySelector("dialog").dispatchEvent(new f.dom.window.Event("cancel", { cancelable: true })));
      assert.equal(document.querySelector("dialog"), null); assert.equal(f.adapter.writes.length, 0);
      await f.click("Delete Hair Care"); await f.click("Delete and save"); assert.equal(f.adapter.writes.length, 1);
    } finally { await f.close(); }
  });
  await t.test("single-flight save blocks repeated submission, dismissal and tab changes", async () => {
    const f = await fixture(); try {
      f.adapter.configure({ delay: 50 }); await f.click("Rename Skin Care"); await f.change("dialog input", "Face Care");
      await act(async () => {
        const form = document.querySelector("dialog form");
        form.dispatchEvent(new f.dom.window.Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new f.dom.window.Event("submit", { bubbles: true, cancelable: true }));
        document.querySelector("dialog").dispatchEvent(new f.dom.window.Event("cancel", { cancelable: true }));
      });
      assert.ok(document.querySelector("dialog")); assert.equal(f.button("Cancel").disabled, true); assert.equal(f.button("Locations").disabled, true);
      await act(async () => new Promise(resolve => setTimeout(resolve, 70)));
      assert.equal(f.adapter.writes.length, 1); assert.equal(document.querySelector("dialog"), null);
    } finally { await f.close(); }
  });
  for (const failure of ["validation", "conflict", "offline", "refresh", "lost-response"]) {
    await t.test(`${failure}: error and explicit recovery with exact replay only when uncertain`, async () => {
      const f = await fixture(); try {
        f.adapter.configure({ failure }); await f.click("Rename Skin Care"); await f.change("dialog input", "Face Care"); await f.click("Save");
        assert.equal(f.adapter.writes.length, 1);
        if (failure === "validation") {
          assert.ok(document.querySelector("dialog")); assert.match(document.querySelector('[role="alert"]').textContent, /not allowed/);
          f.adapter.configure(); await f.click("Save"); assert.equal(f.adapter.writes.length, 2);
        } else {
          assert.equal(document.querySelector("dialog"), null); assert.equal(f.button("Add category").disabled, true);
          if (failure === "refresh") { await f.click("Reload values"); assert.equal(f.button("Add category").disabled, true); }
          f.adapter.configure(); await f.click(f.button("Resolve pending change") ? "Resolve pending change" : "Reload values");
          assert.equal(f.button("Add category").disabled, false); assert.equal(f.adapter.writes.length, ["offline", "lost-response"].includes(failure) ? 2 : 1);
          assert.ok(f.button(`Rename ${["refresh", "lost-response", "offline"].includes(failure) ? "Face Care" : "Skin Care"}`));
        }
      } finally { await f.close(); }
    });
  }
});


test("inventory catalog rollout integration", async t => {
  await t.test("emergency management gate retains canonical item forms", async () => {
    const f = await fixture({ app: true, management: false }); try {
      assert.equal(f.button("Settings"), undefined);
      await f.click("+ Add Item");
      assert.match(f.button("Category").textContent, /Choose a value/);
      assert.match(document.body.textContent, /Preferred room is used/);
    } finally { await f.close(); }
  });
  await t.test("new item requires explicit catalog choices and sends only canonical IDs", async () => {
    const f = await fixture({ app: true }); try {
      await f.click("+ Add Item");
      await f.change('input[placeholder="e.g. Ultra Facial Cream"]', "Fixture lotion");
      await f.click("Save Item");
      assert.match(document.body.textContent, /Choose an active category/);
      assert.equal(f.adapter.writes.length, 0);
      await f.click("Category"); await f.click("Hair Care");
      await f.click("Location"); await f.click("Office");
      await f.click("Save Item");
      const write = f.adapter.writes[0];
      assert.equal(write.path, "/items");
      assert.equal(write.body.categoryId, "hair"); assert.equal(write.body.locationId, "office");
      assert.equal("category" in write.body, false); assert.equal("location" in write.body, false);
    } finally { await f.close(); }
  });
  await t.test("replacement deletion clears removed filter; unresolved catalog changes block leaving settings", async () => {
    const f = await fixture({ app: true }); try {
      await f.click("Filter by category"); await f.click("Skin Care");
      await f.click("Settings"); await f.click("Delete Skin Care");
      await f.change("dialog select", "hair"); await f.click("Delete and save");
      await f.click("Inventory");
      assert.match(f.button("Filter by category").textContent, /All Categories/);
      assert.match(document.body.textContent, /Face cream/);
      await f.click("Settings"); f.adapter.configure({ failure: "lost-response" });
      await f.click("Rename Hair Care"); await f.change("dialog input", "Hair products"); await f.click("Save");
      assert.equal(f.button("Inventory").disabled, true);
      assert.equal(f.button("+ Add Item").disabled, true);
      await f.click("Resolve pending change");
      assert.equal(f.button("Inventory").disabled, false);
      await f.click("Inventory"); assert.match(document.body.textContent, /Hair products/);
    } finally { await f.close(); }
  });
  await t.test("flag on: settings rename preserves ID filter and canonical item edit preserves stock", async () => {
    const f = await fixture({ app: true }); try {
      await f.click("Filter by category");
      await f.click("Skin Care");
      await f.click("Settings");
      await f.click("Rename Skin Care"); await f.change("dialog input", "Face Care"); await f.click("Save");
      await f.click("Inventory");
      assert.match(f.button("Filter by category").textContent, /Face Care/);
      assert.match(document.body.textContent, /Face cream/);
      await f.click("Edit");
      await f.click("Location"); await f.click("Walk-in Closet");
      await f.click("Save Item");
      const write = f.itemTransport.writes.at(-1);
      assert.equal(write.method, "PATCH");
      assert.equal(write.body.locationId, "closet");
      assert.equal("location" in write.body, false);
      assert.equal("category" in write.body, false);
      assert.equal("categoryId" in write.body, false); // unchanged dimension omitted
      assert.deepEqual(f.itemTransport.state.allocationsByItem.cream, [{ containerId: "office-default", quantity: 2 }]);
    } finally { await f.close(); }
  });
  await t.test("flag off retains legacy forms and hides settings", async () => {
    const f = await fixture({ app: true, enabled: false }); try {
      assert.equal(f.button("Settings"), undefined);
      await f.click("+ Add Item");
      assert.match(f.button("Category").textContent, /Skin Care/);
      assert.match(f.button("Location").textContent, /Walk-in Closet/);
      assert.equal(document.body.textContent.includes("Preferred room is used"), false);
    } finally { await f.close(); }
  });
});
