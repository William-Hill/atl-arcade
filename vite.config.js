import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        skater: resolve(import.meta.dirname, "skater.html"),
      },
    },
  },
  test: {
    include: ["src/**/*.test.js"],
    environment: "node",
  },
});
