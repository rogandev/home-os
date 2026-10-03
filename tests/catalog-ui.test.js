import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";
import { createCatalogFixture } from "../fixtures/catalog/model.js";
import { validateCatalogName, validateReplacement } from "../src/catalog.js";

async function fixture() {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/", pretendToBeVisual: true });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const server = await createServer({ configFile: false, plugins: [react()], server: { middlewareMode: true, watch: null, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } });
  const { default: Manager } = await server.ssrLoadModule("/src/CatalogManager.jsx");
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(document.getElementById("root"));
  const adapter = createCatalogFixture();
  await act(async () => root.render(createElement(Manager, { adapter })));
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
  return { adapter, button, click, change, dom, async close() {
    await act(async () => root.unmount()); await server.close(); dom.window.close();
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  } };
}

test("catalog validation rejects missing, duplicate and invalid replacement values", () => {
  const records = [{ id: "a", name: "Skin Care", usageCount: 2 }];
  assert.throws(() => validateCatalogName("  ", records), /Enter a name/);
  assert.throws(() => validateCatalogName("skin care ", records), /already exists/);
  assert.throws(() => validateCatalogName("x".repeat(101), records), /100/);
  assert.equal(validateCatalogName("  Face Care ", records), "Face Care");
  assert.throws(() => validateReplacement(records[0], "", records), /replacement/);
  assert.throws(() => validateReplacement(records[0], "a", records), /available/);
  assert.throws(() => validateReplacement(records[0], "missing", records), /available/);
});

test("catalog manager fixture interactions", async t => {
  for (const kind of ["category", "location"]) {
    await t.test(`${kind}: add, duplicate, rename all assignments, cancel and replace`, async () => {
      const f = await fixture();
      try {
        if (kind === "location") await f.click("Locations");
        const original = kind === "category" ? "Skin Care" : "Bathroom";
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
        assert.equal(data[key].some(row => row.name === "Renamed value"), false);
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
    await t.test(`${failure}: error and explicit recovery without replay`, async () => {
      const f = await fixture(); try {
        f.adapter.configure({ failure }); await f.click("Rename Skin Care"); await f.change("dialog input", "Face Care"); await f.click("Save");
        assert.equal(f.adapter.writes.length, 1);
        if (failure === "validation") {
          assert.ok(document.querySelector("dialog")); assert.match(document.querySelector('[role="alert"]').textContent, /not allowed/);
          f.adapter.configure(); await f.click("Save"); assert.equal(f.adapter.writes.length, 2);
        } else {
          assert.equal(document.querySelector("dialog"), null); assert.equal(f.button("Add category").disabled, true);
          if (failure === "refresh") { await f.click("Reload values"); assert.equal(f.button("Add category").disabled, true); }
          f.adapter.configure(); await f.click("Reload values");
          assert.equal(f.button("Add category").disabled, false); assert.equal(f.adapter.writes.length, 1);
          assert.ok(f.button(`Rename ${["refresh", "lost-response"].includes(failure) ? "Face Care" : "Skin Care"}`));
        }
      } finally { await f.close(); }
    });
  }
});
