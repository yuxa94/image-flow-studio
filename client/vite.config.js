import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Reads server/.env directly, so there's a single .env file for the whole
  // app instead of duplicating keys into a client/.env too.
  envDir: fileURLToPath(new URL("../server", import.meta.url)),
  // Only vars starting with VITE_, or the exact VWORLD_API_KEY, reach client
  // code / index.html — GEMINI_API_KEY and REPLICATE_API_TOKEN stay
  // server-only even though they live in the same .env file.
  envPrefix: ["VITE_", "VWORLD_API_KEY"],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});
