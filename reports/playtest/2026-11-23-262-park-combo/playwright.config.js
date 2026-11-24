// The config of the #262 park combo ride. It is not part of `npm run e2e`.
// Run: npx playwright test --config reports/playtest/2026-11-23-262-park-combo/playwright.config.js
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 5181);

export default defineConfig({
  testDir: ".",
  testMatch: "park-combo.spec.js",
  outputDir: "./.output",
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: { args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: `npm run dev -- --port ${PORT} --strictPort`, cwd: "../../..", port: PORT, reuseExistingServer: false, timeout: 120000 },
});
