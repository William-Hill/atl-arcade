import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        beatLock: resolve(import.meta.dirname, "prototypes/beat-lock-concept/index.html"),
      },
    },
  },
});
