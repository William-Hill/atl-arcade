// Renders vehicle GLBs in the real game scene (PBR look) in headless Chromium.
// First load: read the parked car spots; second load (?cars=0, so the game's
// own cars are gone): put the GLBs in a row along the curb from the parked
// spot nearest --near, and screenshot from the street side.
//   node scripts/assets/vehicles-in-context.mjs --out shot.png [--near x,z] [--side 1|-1] assets/vehicles/a.glb ...
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => (args.includes(k) ? args.splice(args.indexOf(k), 2)[1] : d);
const out = take("--out", "vehicles-in-context.png");
const near = take("--near", "-40,800").split(",").map(Number);
const side = Number(take("--side", "1"));
const dist = Number(take("--dist", "11"));
const files = args.map((f) => "/" + f.replace(/^\.?\//, ""));
const LOOK = "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&skater=capsule";

const server = await createServer({ server: { port: 5193, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ready = (page) => page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 240000 });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`http://localhost:5193/?${LOOK}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await ready(page);
  const parked = await page.evaluate(() => window.__atl.cars?.parkedList ?? []);
  if (!parked.length) throw new Error("no parked cars");
  const a = parked.reduce((b, c) => (Math.hypot(c.x - near[0], c.z - near[1]) < Math.hypot(b.x - near[0], b.z - near[1]) ? c : b));
  const fx = Math.cos(a.yaw), fz = -Math.sin(a.yaw);
  // Row along the curb: each vehicle 1.6 m behind the one before, by its length.
  const LEN = { hatchback: 4.1, van: 5.2, taxi: 4.9, box_truck: 7.5, sedan: 4.6, pickup: 5.4, bus: 12 };
  let t = 0;
  const spots = files.map((url) => {
    const L = LEN[url.split("/").pop().replace(".glb", "")] ?? 5;
    const s = { url, x: a.x + fx * (t - L / 2), y: a.y, z: a.z + fz * (t - L / 2), yaw: a.yaw };
    t -= L + 1.6;
    return s;
  });
  const mid = { x: a.x + (fx * t) / 2, z: a.z + (fz * t) / 2 };
  // Camera on the street side (perpendicular to the row), a little ahead of the
  // row. ?cam heights are over the terrain.
  const cam = [mid.x - fz * side * dist + fx * 4, 2.2, mid.z + fx * side * dist + fz * 4, mid.x, 1.2, mid.z];
  await page.goto(`http://localhost:5193/?${LOOK}&cars=0&cam=${cam.map((v) => v.toFixed(2)).join(",")}`, { waitUntil: "domcontentloaded", timeout: 240000 });
  await ready(page);
  const placed = await page.evaluate(async (spots) => {
    const { place } = await import("/scripts/assets/vehicles-in-context.js");
    return place(window.__atl.scene, spots);
  }, spots);
  const f0 = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f0) => window.__atl.frames > f0 + 4, f0, { timeout: 120000 });
  await page.screenshot({ path: out, timeout: 270000 });
  console.log(JSON.stringify({ anchor: a, cam, placed }));
} finally {
  await browser.close();
  await server.close();
}
