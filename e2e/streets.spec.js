import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// #138 and #136: pictures of the street detail on the high tier. Each view
// is a fixed camera: the intersection views are 12 m over the ground and
// 24 m out from the node, and the sidewalk views are at eye height.
// The pictures go to reports/streets/<set>/ (STREET_SHOTS=before|after,
// default after). The views are fixed coordinates, so the same views work
// on an older build.

const SET = process.env.STREET_SHOTS ?? "after";
const DIR = `reports/streets/${SET}`;

// name, camera (x, z), height over the ground (m), look at (x, z).
const VIEWS = [
  { name: "ix-parkway-ralph-mcgill", camera: [405, -410], up: 12, look: [429.1, -389.18] },
  { name: "ix-parkway-north-ave", camera: [334, -725], up: 12, look: [357.74, -705.31] },
  { name: "ix-north-ave-glen-iris", camera: [-430, -690], up: 12, look: [-411.26, -709.42] },
  { name: "ix-highland-sampson", camera: [-228, 398], up: 12, look: [-210.85, 380.29] },
  { name: "crosswalk-highland-sampson", camera: [-222, 392], up: 1.7, look: [-210.85, 380.29] },
  { name: "sidewalk-highland", camera: [-262, 385.9], up: 1.7, look: [-232, 384] },
];

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("high tier: pictures of the intersections and the sidewalks", async ({ page }) => {
  test.setTimeout(240000);
  mkdirSync(DIR, { recursive: true });
  const errors = collectErrors(page);
  await page.goto("/?level=beltline-eastside&mute=1&quality=high&governor=0&view=fixed&minimap=0&skater=capsule");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 120000 });
  expect(await page.evaluate(() => window.__atl.render.quality)).toBe("high");
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 120000 });

  for (const v of VIEWS) {
    const placed = await page.evaluate((view) => {
      const ground = (x, z) => window.__atl.level.sample(x, z)?.height;
      const [cx, cz] = view.camera;
      const [lx, lz] = view.look;
      const cy = ground(cx, cz);
      const ly = ground(lx, lz);
      if (!Number.isFinite(cy) || !Number.isFinite(ly)) return null;
      window.__atl.setFixedCamera(cx, cy + view.up, cz, lx, ly + 0.3, lz);
      return { cy, ly, frames: window.__atl.frames };
    }, v);
    expect(placed, v.name).not.toBeNull();
    await page.waitForFunction((f) => window.__atl.frames > f + 3, placed.frames, { timeout: 30000 });
    await page.screenshot({ path: `${DIR}/${v.name}.jpg`, type: "jpeg", quality: 85 });
  }
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

// #138: the street detail loads on the high tier and on the low tier, with
// no console error, and the skater has the bench and curb ledges (#136).
for (const quality of ["high", "low"]) {
  test(`${quality} tier: the street detail loads`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = collectErrors(page);
    await page.goto(`/?level=beltline-eastside&mute=1&quality=${quality}&governor=0&skater=capsule`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 150000 });
    const info = await page.evaluate(() => ({ quality: window.__atl.render.quality, grindables: window.__atl.level.grindables, meshes: window.__atl.level.meshCount }));
    expect(info.quality).toBe(quality);
    expect(info.meshes).toBeGreaterThan(10);
    expect(info.grindables["ledge:bench"]).toBeGreaterThanOrEqual(3);
    expect(info.grindables["ledge:curb"]).toBeGreaterThanOrEqual(3);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}

// Street screenshots for a before and after compare (issue #135).
// Runs only when STREETS_OUT is set.

const OUT = process.env.STREETS_OUT;
const LOOK = process.env.STREETS_LOOK ?? "pbr";

export const STREETS = [
  // An Old Fourth Ward house street: porches, steps, and gable roofs.
  { name: "o4w-houses", cam: "-315.6,1.7,692.4,-328.6,2.2,679.4" },
  // The shop front of Venkman's: the name board and the sign band.
  { name: "venkmans", cam: "34.6,1.7,-210.2,15.1,3.2,-215.7" },
  // New Realm Brewing on the BeltLine trail.
  { name: "new-realm", cam: "133,1.7,-455,113.7,3.2,-461.1" },
];

test.skip(!OUT, "set STREETS_OUT to take the street screenshots");
test.setTimeout(600000);

test("street screenshots", async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewportSize({ width: 1280, height: 720 });
  mkdirSync(OUT, { recursive: true });
  const info = { look: LOOK, streets: {} };
  for (const s of STREETS) {
    const query = `level=beltline-eastside&mute=1&quality=high&governor=0&view=fixed&skater=capsule&look=${LOOK}&cam=${s.cam}`;
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 120000 });
    await page.evaluate(() => {
      const main = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      for (const el of document.querySelectorAll("body *")) {
        if (el === main || el.contains(main)) continue;
        el.style.visibility = "hidden";
      }
    });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/${s.name}.png` });
    info.streets[s.name] = `/?${query}`;
  }
  writeFileSync(`${OUT}/info.json`, `${JSON.stringify(info, null, 2)}\n`);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
