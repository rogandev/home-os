import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins:[react()],
  define:{"import.meta.env.VITE_HOME_SUPPLY_TRACKING":JSON.stringify("true"),"import.meta.env.VITE_HOME_DELIVERY_TRACKING":JSON.stringify("false"),"import.meta.env.VITE_ROGAN_API_URL":JSON.stringify("http://127.0.0.1:5195"),"import.meta.env.VITE_ROGAN_API_TOKEN":JSON.stringify("")},
  build:{outDir:"dist-supply",target:"esnext",rollupOptions:{input:"fixtures/supply.html"}},
});
