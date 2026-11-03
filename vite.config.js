import { defineConfig } from "vite";
import { resolve } from "node:path";
import { rapierWasmFile } from "./tools/vite/rapier-wasm-file.js";

export default defineConfig({
  // Rapier loads its WASM as a file (#74). The dev server must not prebundle
  // Rapier, so that the .wasm URL stays next to rapier.mjs.
  plugins: [rapierWasmFile()],
  optimizeDeps: { exclude: ["@dimforge/rapier3d-compat"] },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        skater: resolve(import.meta.dirname, "skater.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.js", "scripts/**/*.test.js"],
    environment: "node",
  },
});
