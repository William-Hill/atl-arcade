import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// #158: the PBR ground sets. For each tier and look it saves pictures of the
// BeltLine trail, a street, a sidewalk, and a brick path, and writes the
// ground texture bytes and the draw calls of each view to
// reports/ground-pbr/<set>/metrics.json (GROUND_SHOTS=before|after). The
// spec runs only with GROUND_SHOTS set: it takes a long time on the software
// GPU and it writes over the evidence in reports/. The views are fixed
// coordinates and the spec only reads window.__atl hooks that are older than
// #158, so the same spec runs on the build before the change.

const SET = process.env.GROUND_SHOTS;
const DIR = `reports/ground-pbr/${SET}`;

// name, camera (x, z), height over the ground (m), look at (x, z).
const VIEWS = [
  // On the trail at skating height, and from 8 m (the tile repeat).
  { name: "trail", camera: [233, -294], up: 1.7, look: [262, -256] },
  { name: "trail-high", camera: [228, -300], up: 8, look: [262, -256] },
  // Ralph McGill Boulevard, on the road.
  { name: "street", camera: [380, -367.5], up: 1.7, look: [356.5, -357] },
  // A sidewalk on North Avenue.
  { name: "sidewalk", camera: [212, -700.2], up: 1.7, look: [250, -699.8] },
  // A paving-stone footway in Historic Fourth Ward Park (OSM surface).
  { name: "brick", camera: [-171.5, -432], up: 1.7, look: [-171.6, -417] },
];

const CONFIGS = [
  { name: "pbr-high", quality: "high", look: "pbr" },
  { name: "pbr-phone", quality: "phone", look: "pbr" },
  { name: "pbr-low", quality: "low", look: "pbr" },
  { name: "toon-high", quality: "high", look: "toon" },
  { name: "toon-low", quality: "low", look: "toon" },
];

const metrics = {};

test.skip(!SET, "set GROUND_SHOTS=before|after to take the ground pictures");

for (const cfg of CONFIGS) {
  test(`ground pictures and metrics: ${cfg.name}`, async ({ page }) => {
    test.setTimeout(1200000);
    mkdirSync(DIR, { recursive: true });
    const errors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (err) => errors.push(String(err)));
    // The ground textures that the page downloads (the resource timing
    // buffer fills up before they load, so read the responses).
    const textures = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (!/\/assets\/ground\//.test(url) || /\.json/.test(url)) return;
      // The body size on the wire (res.body() is empty for a fetch() stream).
      const body = await res.request().sizes().then((z) => ({ length: z.responseBodySize })).catch(() => null);
      textures.push({ file: new URL(url).pathname.replace(/^.*\/assets\/ground\//, ""), bytes: body ? body.length : null });
    });
    await page.goto(`/?level=beltline-eastside&mute=1&quality=${cfg.quality}&look=${cfg.look}&governor=0&view=fixed&minimap=0&skater=capsule&weather=0&cars=0&traffic=0&peds=0&npcs=0&skaters=0`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 150000 });
    await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 150000 });
    expect(await page.evaluate(() => window.__atl.render.quality)).toBe(cfg.quality);
    await page.waitForLoadState("networkidle");
    // Hide the HUD, so the pictures show the ground.
    await page.evaluate(() => {
      const main = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      for (const el of document.querySelectorAll("body *")) if (el !== main && !el.contains(main)) el.style.visibility = "hidden";
    });
    const out = { quality: cfg.quality, look: cfg.look, views: {} };
    for (const v of VIEWS) {
      const placed = await page.evaluate((view) => {
        const ground = (x, z) => window.__atl.level.sample(x, z)?.height;
        const [cx, cz] = view.camera;
        const [lx, lz] = view.look;
        const cy = ground(cx, cz);
        const ly = ground(lx, lz);
        if (!Number.isFinite(cy) || !Number.isFinite(ly)) return null;
        window.__atl.setFixedCamera(cx, cy + view.up, cz, lx, ly + 0.2, lz);
        return { frames: window.__atl.frames };
      }, v);
      expect(placed, v.name).not.toBeNull();
      await page.waitForFunction((f) => window.__atl.frames > f + 6, placed.frames, { timeout: 300000 });
      await page.waitForTimeout(500);
      out.views[v.name] = await page.evaluate(() => window.__atl.rendererInfo);
      await page.screenshot({ path: `${DIR}/${cfg.name}-${v.name}.png` });
    }
    out.groundTextures = textures;
    out.groundTextureBytes = out.groundTextures.reduce((n, e) => n + e.bytes, 0);
    metrics[cfg.name] = out;
    writeFileSync(`${DIR}/metrics.json`, `${JSON.stringify(metrics, null, 2)}\n`);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}
