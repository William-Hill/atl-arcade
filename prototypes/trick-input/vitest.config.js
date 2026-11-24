// The prototype has its own Vitest config, so the root config (src/ and
// scripts/ only) does not change. Run: npx vitest run --config prototypes/trick-input/vitest.config.js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.js"],
    environment: "node",
  },
});
