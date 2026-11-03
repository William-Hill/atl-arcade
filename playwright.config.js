import { defineConfig, devices } from "@playwright/test";

// E2E_PORT lets two checkouts run the suite at the same time.
const PORT = Number(process.env.E2E_PORT ?? 5180);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.output",
  snapshotPathTemplate: "e2e/__screenshots__/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 720 },
    // Headless Chromium here renders WebGL through SwiftShader, so the GPU
    // sandbox is off and the software path is opted into explicitly.
    launchOptions: {
      args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
