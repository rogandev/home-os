import React from "react";
import { createRoot } from "react-dom/client";
import HomeOS from "../../src/App.jsx";
import { createCatalogFixture } from "./model.js";
const fixture = createCatalogFixture();
// All app requests terminate in this disposable transport. No network fallback.
window.fetch = async (url, options = {}) => {
  try {
    const parsed = new URL(url, window.location.origin);
    if (!parsed.pathname.startsWith("/home-os/")) throw new Error("Fixture only accepts Home OS paths.");
    const value = await fixture.request(parsed.pathname.replace(/^\/home-os/, "") + parsed.search, options);
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status || 500 });
  }
};
createRoot(document.getElementById("root")).render(<><p style={{ background: "#303048", color: "#fff", padding: 12 }}>Disposable integrated fixture · no production API · reload resets data</p><HomeOS catalogAdapter={fixture} /></>);
