import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

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
  },
  server: {
    port: 5173,
    host: "127.0.0.1",
    open: false,
  },
});
