import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// The Vite dev server serves the dashboard frontend on the same port as the
// client base URL (48231). API paths (/v1, /health, /stats, /logs) are proxied
// to the Rust bridge server, which binds a fallback port (48232) when 48231 is
// already taken by Vite. This keeps local development and the client on one
// base URL: http://localhost:48231.
const BRIDGE_PORT = 48232;

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/renderer/src"),
    },
  },
  build: {
    outDir: "dist",
    target: "chrome130",
  },
  server: {
    port: 48231,
    host: "::",
    open: false,
    hmr: {
      host: "localhost",
      clientPort: 48231,
    },
    proxy: {
      "/v1": `http://127.0.0.1:${BRIDGE_PORT}`,
      "/health": `http://127.0.0.1:${BRIDGE_PORT}`,
      "/stats": `http://127.0.0.1:${BRIDGE_PORT}`,
      "/logs": `http://127.0.0.1:${BRIDGE_PORT}`,
    },
  },
});
