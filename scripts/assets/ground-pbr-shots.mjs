// Screenshots of the full PBR ground sets (#158) in the real game renderer
// (pbr look), for docs/ground-textures-pbr.md:
// - trail and street at skating height: BEFORE is the game as it is
//   (index.html), AFTER is scripts/assets/ground-pbr-preview.html with the
//   new sets on the surface material, at the identical camera and light;
//   AFTER-ktx2 and AFTER-phone are the same with the KTX2 maps and the 512
//   px tier.
// - swatch-<set>-top and swatch-<set>-skate: a 16 m swatch of each set on
//   the plaza lot beside the trail (JPG and KTX2), for the contact sheet and
//   the tiling check.
// Logs window.__atl.rendererInfo and window.__groundPbr (bytes, GPU bytes,
// texture formats) per shot. Serial runs on SwiftShader.
//   node scripts/assets/ground-pbr-shots.mjs --out <dir> [name-prefix ...]
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const out = take("--out", "/tmp/ground-pbr-shots");
mkdirSync(out, { recursive: true });

// A camera at skating height (1.6 m) along a strip segment a -> b: the eye
// `e` m along it, looking at the ground `t` m along it.
function along([ax, az], [bx, bz], e, t, h = 1.6) {
  const l = Math.hypot(bx - ax, bz - az);
  const [dx, dz] = [(bx - ax) / l, (bz - az) / l];
  return [ax + dx * e, h, az + dz * e, ax + dx * t, 0, az + dz * t].map((v) => +v.toFixed(2));
}
const TRAIL = along([330.39, -100.59], [335.65, -69.49], 2, 14);
// Bernina Avenue NE (residential, 8 m), with its sidewalks.
const STREET = along([390.58, 103.09], [434.56, 92.49], 4, 18);
const PLAZA = [311.5, -85.2];
const PAGE = "/scripts/assets/ground-pbr-preview.html";
const SHOTS = [];
for (const [name, cam] of [
  ["trail", TRAIL],
  ["street", STREET],
]) {
  SHOTS.push([`${name}-BEFORE`, "/", cam, ""]);
  SHOTS.push([`${name}-AFTER`, PAGE, cam, ""]);
  SHOTS.push([`${name}-AFTER-ktx2`, PAGE, cam, "&format=ktx2"]);
  SHOTS.push([`${name}-AFTER-phone`, PAGE, cam, "&tier=phone"]);
}
for (const set of ["sidewalk", "brick", "asphalt", "trail"]) {
  const [x, z] = PLAZA;
  const q = `&swatch=${set}&at=${x},${z}&size=16`;
  SHOTS.push([`swatch-${set}-top`, PAGE, [x, 9, z + 2.5, x, 0, z], q]);
  SHOTS.push([`swatch-${set}-skate`, PAGE, [x, 1.6, z + 8, x, 0, z - 3], q]);
  SHOTS.push([`swatch-${set}-skate-ktx2`, PAGE, [x, 1.6, z + 8, x, 0, z - 3], `${q}&format=ktx2`]);
}
const want = args.length ? SHOTS.filter(([n]) => args.some((a) => n.startsWith(a))) : SHOTS;
const BASE =
  "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&skater=capsule&npcs=0&cars=0";

const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const log = [];
try {
  for (const [name, path, cam, extra] of want) {
    // A fresh page per shot: a heavy pbr page can stall the next navigation.
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.setDefaultTimeout(300000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 400)));
    await page.goto(`http://localhost:5196${path}?${BASE}&cam=${cam.join(",")}${extra}`, { waitUntil: "commit" });
    await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 300000 });
    if (path !== "/") await page.waitForFunction(() => window.__groundPbr?.ready, null, { timeout: 300000 });
    const f = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((f0) => window.__atl.frames > f0 + 6, f, { timeout: 300000 });
    await page.screenshot({ path: `${out}/${name}.png` });
    const r = await page.evaluate(() => {
      const g = window.__groundPbr;
      return { renderer: window.__atl.rendererInfo, groundPbr: g ? { maps: g.maps, download: g.download, gpu: g.gpu, swapped: g.swapped } : null };
    });
    log.push({ name, cam, extra, errors, ...r });
    console.log(name, errors.length ? `ERRORS ${errors.join(" | ")}` : "ok", JSON.stringify(r.renderer));
    await page.close();
  }
} finally {
  writeFileSync(`${out}/shots-${args.length ? args.join("_") : "all"}.json`, JSON.stringify(log, null, 2) + "\n");
  await browser.close();
  await server.close();
}
