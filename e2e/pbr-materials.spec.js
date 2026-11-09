import { expect, test } from "@playwright/test";

// #157: the pbr look has no toon material left. The spec loads ?look=pbr
// with every part of the scene on (the level, the player skater, the NPC
// skaters, the walkers and their Meshy outfits, the crowd, the traffic and
// the landmark GLBs), walks the whole scene graph with the material audit
// (materialAudit() in src/render/pbr-palette.js, window.__atl.materials),
// and fails on a toon material, an ink hull, a toon ramp, a Lambert or
// Phong material, or an unlit or other material type that is not on its list. On the high tier the skater then goes to each landmark
// GLB, so the pools that fill near the camera (walker kinds, car models)
// are in the scene, and the audit runs again. A toon control run shows that
// the audit finds the toon materials.

const BASE = "level=beltline-eastside&mute=1&governor=0&skaters=1&time=14&weather=clear&minimap=0";

// The unlit materials (MeshBasicMaterial) that the pbr look keeps: emissive
// or baked parts only. Any other unlit material is a leftover.
const UNLIT_OK = [
  /^landmark-shadow-/, // the shadow proxy of a landmark GLB (shadow layer only)
  /^car-lamps</, // the car head and tail lamps (emissive)
  /^car-beams</, // the car lamp beams (emissive)
  /<fact-card-/, // the fact cards (a UI panel in the world)
  /^skater-shadow</, // the shadow blob of a GLB skater (player and NPC skaters)
  /^skater-blob<Scene$/, // the shadow blob on a tier with no shadow map (phone, low)
  // The patterns below test the mesh name (the path up to the first "<"),
  // not a parent name, so a new mesh under one of these groups is not
  // allowed by accident.
  /^[\w-]*impostor[\w-]*(<|$)/, // the tree impostors (baked)
  /^(lamp|lamps|lamp-pool)(<|$)/, // the street lamp heads and pools (emissive)
];

// The other material types (ShaderMaterial, RawShaderMaterial,
// LineBasicMaterial, ...) that the pbr look keeps, as "Type mesh<parent".
// Any other one is a leftover or a new material that needs a decision.
const OTHER_OK = [
  /^ShaderMaterial sky<Scene$/, // the sky dome (src/render/sky.js)
  /^ShaderMaterial rain<Scene$/, // the rain streaks (src/render/rain.js)
  /^ShaderMaterial fx-(bursts|screen)<Scene$/, // the effects (src/render/effects/effects-view.js)
  /^LineBasicMaterial debug-colliders<Scene$/, // the collider lines (?debug, hidden by default)
];

async function waitLoaded(page) {
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 600000 });
  await page.waitForFunction(
    () => {
      const a = window.__atl;
      // A dev server reload (new optimized deps) clears __atl for a moment.
      if (!a?.ready) return false;
      const skater = a.skaterModel.loaded || a.skaterModel.error;
      const npcs = !a.skaters || a.skaters.loaded + a.skaters.failed >= a.skaters.count;
      const peds = !a.pedModels || a.pedModels.loaded || a.pedModels.error;
      return skater && npcs && peds;
    },
    null,
    { timeout: 600000 },
  );
  await settle(page);
}

// Waits until the landmark GLB count stops going up and a few frames draw.
async function settle(page) {
  let last = -1;
  for (let i = 0; i < 30; i++) {
    const n = await page.evaluate(() => window.__atl?.level?.landmarks?.glb?.models ?? 0);
    if (n === last) break;
    last = n;
    await page.waitForTimeout(2000);
  }
  const f = await page.evaluate(() => window.__atl?.frames ?? 0);
  await page.waitForFunction((f0) => window.__atl?.frames > f0 + 6, f, { timeout: 600000 });
}

function expectNoToon(audit, where) {
  expect(audit.toon, `toon materials ${where}`).toEqual([]);
  expect(audit.hulls, `ink hulls ${where}`).toEqual([]);
  expect(audit.ramps, `toon ramps ${where}`).toEqual([]);
  expect(audit.legacy, `Lambert or Phong materials ${where}`).toEqual([]);
  const odd = audit.unlit.filter((p) => !UNLIT_OK.some((re) => re.test(p)));
  expect(odd, `unlit materials not on the list ${where}`).toEqual([]);
  const other = audit.other.filter((p) => !OTHER_OK.some((re) => re.test(p)));
  expect(other, `other material types not on the list ${where}`).toEqual([]);
  expect(audit.counts.MeshToonMaterial ?? 0).toBe(0);
  expect((audit.counts.MeshStandardMaterial ?? 0) + (audit.counts.MeshPhysicalMaterial ?? 0)).toBeGreaterThan(50);
}

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("pbr look, high tier: no toon material on the level, the skaters, the people, the traffic or the landmarks", async ({ page }) => {
  test.setTimeout(1800000);
  const errors = collectErrors(page);
  await page.goto(`/?${BASE}&quality=high&look=pbr`);
  await waitLoaded(page);
  const scene = await page.evaluate(() => ({
    look: window.__atl.look,
    skaters: window.__atl.skaters?.loaded ?? 0,
    peds: window.__atl.pedModels,
    cars: window.__atl.cars?.models ?? null,
    landmarks: window.__atl.level.landmarks?.glb ?? null,
  }));
  expect(scene.look).toBe("pbr");
  // Every part is in the scene, so the audit sees it.
  expect(scene.skaters).toBeGreaterThan(0);
  expect(scene.peds?.loaded).toBe(true);
  expect(scene.landmarks?.models).toBeGreaterThan(0);
  expectNoToon(await page.evaluate(() => window.__atl.materials), "at the spawn");

  // Walk the scene: go to each landmark GLB, and audit there.
  const sites = await page.evaluate(() => {
    const out = [];
    window.__atl.scene.traverse((o) => {
      if (o.isLOD && o.parent?.name === "landmark-models") out.push([o.position.x, o.position.z]);
    });
    return out;
  });
  expect(sites.length).toBeGreaterThan(0);
  for (const [x, z] of sites) {
    // fastTravel() gives null when no trail, path or street is near: the
    // audit then does not see the landmark, so the spec fails.
    const spot = await page.evaluate(([px, pz]) => window.__atl.fastTravel(px, pz), [x, z]);
    expect(spot, `a fast travel spot near (${Math.round(x)}, ${Math.round(z)})`).not.toBeNull();
    await page.waitForTimeout(3000);
    await settle(page);
    expectNoToon(await page.evaluate(() => window.__atl.materials), `near (${Math.round(x)}, ${Math.round(z)})`);
  }
  expect(errors).toEqual([]);
});

for (const quality of ["phone", "low"]) {
  test(`pbr look, ${quality} tier: no toon material in the scene`, async ({ page }) => {
    test.setTimeout(1200000);
    const errors = collectErrors(page);
    await page.goto(`/?${BASE}&quality=${quality}&look=pbr`);
    await waitLoaded(page);
    expect(await page.evaluate(() => window.__atl.look)).toBe("pbr");
    expectNoToon(await page.evaluate(() => window.__atl.materials), `on the ${quality} tier`);
    expect(errors).toEqual([]);
  });
}

test("toon look control: the audit finds the toon materials and the ink hulls", async ({ page }) => {
  test.setTimeout(1200000);
  await page.goto(`/?${BASE}&quality=low&look=toon`);
  await waitLoaded(page);
  const audit = await page.evaluate(() => window.__atl.materials);
  expect(audit.clean).toBe(false);
  expect(audit.toon.length).toBeGreaterThan(20);
  expect(audit.hulls.length).toBeGreaterThan(0);
});
