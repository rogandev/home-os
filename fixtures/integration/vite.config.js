import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: Object.fromEntries([
    ...["VITE_HOME_CATALOGS", "VITE_HOME_CATALOG_MANAGEMENT", "VITE_HOME_INVENTORY_COPY", "VITE_HOME_SUPPLY_TRACKING", "VITE_HOME_DELIVERY_TRACKING"].map(key => [`import.meta.env.${key}`, JSON.stringify("true")]),
    ["import.meta.env.VITE_ROGAN_API_URL", JSON.stringify("http://127.0.0.1:5196")],
    ["import.meta.env.VITE_ROGAN_API_TOKEN", JSON.stringify("")], ["import.meta.env.VITE_API_TOKEN", JSON.stringify("")],
  ]),
  server: { host: "127.0.0.1", port: 5196, strictPort: true, hmr: false, headers: { "Content-Security-Policy": "connect-src 'self'; object-src 'none'; base-uri 'self'" } },
  build: { outDir: "dist-integration", rollupOptions: { input: "fixtures/integration/index.html" } },
});
