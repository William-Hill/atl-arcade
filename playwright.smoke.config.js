import { defineConfig, devices } from "@playwright/test";

// The smoke test of a deployed build (#23). It runs against a live URL, not
// against the dev server, so it has no webServer. The default suite in
// playwright.config.js does not read e2e-smoke/.
//   SMOKE_URL=https://skate-atl.vercel.app npx playwright test -c playwright.smoke.config.js
const SMOKE_URL = process.env.SMOKE_URL ?? "https://skate-atl.vercel.app";
// The request fixture does not read HTTPS_PROXY by itself. A sandbox with an
// outbound proxy needs it; CI has no proxy.
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy;

export default defineConfig({
  testDir: "./e2e-smoke",
  outputDir: "./e2e-smoke/.output",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 120000,
  reporter: [["list"]],
  use: {
    baseURL: SMOKE_URL,
    viewport: { width: 1280, height: 720 },
    ...(PROXY ? { proxy: { server: PROXY } } : {}),
    launchOptions: {
      args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
