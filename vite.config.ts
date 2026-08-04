import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

// Direct Vite runs also request an ephemeral loopback port. The guarded
// launcher injects the actual per-run URL into Tauri with a config overlay.
const DEV_UI_PORT = 0;
const VIRTUAL_ICONS_ID = "virtual:sparkly-solar-icons";
const RESOLVED_VIRTUAL_ICONS_ID = `\0${VIRTUAL_ICONS_ID}`;

type IconCollection = {
  prefix: string;
  icons: Record<string, unknown>;
  aliases?: Record<string, { parent: string }>;
  width?: number;
  height?: number;
};

function rendererFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return rendererFiles(absolute);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : [];
  });
}

function selectiveSolarIcons(): Plugin {
  return {
    name: "sparkly-selective-solar-icons",
    resolveId(id) {
      return id === VIRTUAL_ICONS_ID ? RESOLVED_VIRTUAL_ICONS_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ICONS_ID) return null;

      const used = new Set<string>();
      const iconPattern = /solar:([a-z0-9-]+)/g;
      for (const file of rendererFiles(path.resolve(__dirname, "src/renderer/src"))) {
        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(iconPattern)) used.add(match[1]);
      }

      const collectionPath = path.resolve(__dirname, "node_modules/@iconify-json/solar/icons.json");
      const collection = JSON.parse(fs.readFileSync(collectionPath, "utf8")) as IconCollection;
      const icons = Object.fromEntries(
        [...used]
          .filter((name) => Object.hasOwn(collection.icons, name))
          .map((name) => [name, collection.icons[name]]),
      );
      const aliases = Object.fromEntries(
        Object.entries(collection.aliases ?? {}).filter(([name]) => used.has(name)),
      );
      for (const alias of Object.values(aliases)) {
        if (Object.hasOwn(collection.icons, alias.parent)) {
          icons[alias.parent] = collection.icons[alias.parent];
        }
      }

      const unresolved = [...used].filter(
        (name) => !Object.hasOwn(collection.icons, name) && !Object.hasOwn(collection.aliases ?? {}, name),
      );
      if (unresolved.length > 0) {
        throw new Error(`Unknown Solar icons: ${unresolved.join(", ")}`);
      }

      const subset = {
        prefix: collection.prefix,
        icons,
        ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
        ...(collection.width ? { width: collection.width } : {}),
        ...(collection.height ? { height: collection.height } : {}),
      };
      return `export default ${JSON.stringify(subset)};`;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [selectiveSolarIcons(), react()],
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
    port: DEV_UI_PORT,
    strictPort: false,
    host: "127.0.0.1",
    open: false,
    hmr: {
      host: "127.0.0.1",
    },
  },
});
