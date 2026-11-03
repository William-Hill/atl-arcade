// Shared helpers for the mobile audit scripts. No imports from src/ or prototypes/.
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium, devices } from "@playwright/test";

export const OUT = resolve(import.meta.dirname, "..");
export const BASE = process.env.BASE ?? "http://localhost:5184";
export const LEVEL_URL = (q = "") => `${BASE}/?level=beltline-eastside${q ? `&${q}` : ""}`;

export function loadAverage() {
  return execSync("uptime").toString().trim();
}

// iPhone 15 and Pixel 7 descriptors. WebKit is not installed here, so both
// run in Chromium. The iPhone descriptor keeps its viewport, DPR, touch, and
// user agent, but the engine is Blink, not WebKit.
export function profile(name, landscape = false) {
  const d = { ...devices[name] };
  delete d.defaultBrowserType;
  if (landscape) d.viewport = { width: d.viewport.height, height: d.viewport.width };
  return d;
}

export async function launch({ gpu = false } = {}) {
  const args = ["--no-sandbox", "--disable-dev-shm-usage"];
  if (gpu) args.push("--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist");
  else args.push("--enable-unsafe-swiftshader");
  return chromium.launch({ headless: true, args });
}

export async function waitReady(page, timeout = 180000) {
  await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout });
}
