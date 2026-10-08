import React from "react";
import { createRoot } from "react-dom/client";
import HomeOS from "../../src/App.jsx";
import { createIntegratedFixture } from "./model.js";

const fixture = createIntegratedFixture();
window.__homeIntegrationFixture = fixture;
// No network fallback, credentials, durable user data or production mutations.
window.fetch = async (url, options = {}) => {
  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.origin !== "http://127.0.0.1:5196" || !parsed.pathname.startsWith("/home-os/")) throw new Error("Fixture only accepts its synthetic Home OS API.");
    const value = await fixture.request(parsed.pathname.replace(/^\/home-os/, "") + parsed.search, options);
    return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (error) { return new Response(JSON.stringify({ error: error.message, code: error.code }), { status: error.status || 500 }); }
};
createRoot(document.getElementById("root")).render(<><p style={{ background: "#303048", color: "#fff", padding: 12 }}>Disposable Home OS integration · all feature flags enabled · reload resets every change</p><HomeOS catalogAdapter={fixture} /></>);
