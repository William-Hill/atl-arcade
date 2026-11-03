import { defineConfig, devices } from "@playwright/test";

const PORT = 5180;

// The title tag of the beat timing test in e2e/beat.spec.js.
const BEAT_TIMING = /@beat-timing/;

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
  // The beat timing test measures timer jitter in ms, so other tests and
  // other apps on the computer can make it fail (#63). It runs in its own
  // project, last, with one retry. A real drift fails both attempts.
  // The test writes the load average to its report.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, grepInvert: BEAT_TIMING },
    { name: "beat-timing", use: { ...devices["Desktop Chrome"] }, grep: BEAT_TIMING, retries: 1 },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
