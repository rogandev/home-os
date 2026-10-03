import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Separate entry: not imported by src/main.jsx or included in production build.
export default defineConfig({
  plugins: [react()],
  define: { "import.meta.env.VITE_HOME_CATALOGS": JSON.stringify("true") },
  cacheDir: "node_modules/.vite-catalog",
  optimizeDeps: { include: ["react", "react-dom/client"] },
  server: { host: "127.0.0.1", port: 4176, strictPort: true, hmr: false, headers: { "Content-Security-Policy": "connect-src 'self' ws://127.0.0.1:4176; object-src 'none'; base-uri 'self'" } },
  build: { outDir: "fixture-dist", rollupOptions: { input: ["fixtures/catalog/index.html", "fixtures/catalog/app.html"] } },
});
