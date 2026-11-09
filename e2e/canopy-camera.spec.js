import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createLevelEnv } from "../src/level/ground.js";
import { withCanopy } from "../src/level/levels.js";
import { chainStrips, followLineScript } from "../src/playtest/trail-script.js";
import { bodyFor, skateFor } from "../src/sim/skate/body.js";

// #230: on the BeltLine the follow camera went inside a tree canopy and hid
// the skater. Nia rides the Eastside Trail north past a street tree (a red
// maple at x 221, z -314.7, on the slope below the raised trail). Without
// the canopy test (?canopycam=0) the camera goes through its crown; with it
// (the default) the camera stays out of every canopy and Nia stays on screen.

const NIA = skateFor(bodyFor("nia"));
const LEVEL = withCanopy(
  JSON.parse(readFileSync(new URL("../levels/beltline-eastside/level.json", import.meta.url), "utf8")),
  JSON.parse(readFileSync(new URL("../levels/beltline-eastside/canopy.json", import.meta.url), "utf8")),
);
const QUERY = "level=beltline-eastside&quality=low&time=14&weather=clear&mute=1&view=follow";
// A trail point 2380 frames north of the spawn on the trail follower, at rest.
const START = { position: [236.93, 23.03, -288.81], yaw: 2.253 };
const TREE = { x: 220.98, z: -314.72 };
// The ride passes the tree at about frame 327 (the camera was in the crown
// from frame 317 to 337 before the fix, in node).
const RIDE_FRAMES = 480;
const AT_TREE = 327;

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function open(page, extra = "") {
  await page.goto(`/?${QUERY}${extra}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 60000 });
  await page.waitForFunction(() => window.__atl.skaterModel.loaded || window.__atl.skaterModel.error, null, { timeout: 60000 });
}

// One ride, sampled every frame. Each sample says if the camera was inside
// a canopy volume. The canopy test of the page (window.__atl.canopy) works
// with ?canopycam=0 too: the volumes are built, only the clip is off.
async function ride(page, script) {
  return page.evaluate(async (s) => {
    window.__atl.recorder.start(1);
    const end = await window.__atl.runScript(s.script, s.start);
    const samples = window.__atl.recorder.stop().map((x) => ({ ...x, inCanopy: window.__atl.canopy.inside(...x.camera) }));
    return { end, samples };
  }, script);
}

// Rides the script and freezes the render (window.__atl.renderPaused) at the
// first frame that `stop` accepts, or at `atTick` ticks into the ride.
// Returns the frozen sample; the screenshot then shows that frame.
async function rideAndFreeze(page, script, { atTick = Infinity, inCanopy = false } = {}) {
  return page.evaluate(
    (s) =>
      new Promise((resolve) => {
        const atl = window.__atl;
        const t0 = atl.ticks;
        atl.recorder.start(1);
        atl.runScript(s.script, s.start);
        const check = () => {
          const last = atl.recorder.samples[atl.recorder.samples.length - 1];
          const inside = last ? atl.canopy.inside(...last.camera) : false;
          if (last && (atl.ticks - t0 >= s.atTick || (s.inCanopy && inside))) {
            atl.renderPaused = true;
            atl.recorder.stop();
            resolve({ ...last, inCanopy: inside, rideTick: atl.ticks - t0 });
            return;
          }
          if (atl.ticks - t0 >= s.end) {
            atl.recorder.stop();
            resolve(null);
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      }),
    { ...script, atTick, inCanopy, end: script.script.reduce((n, e) => n + e.frames, 0) },
  );
}

function plan(frames) {
  const env = createLevelEnv(LEVEL);
  const [trail] = chainStrips(LEVEL.strips, "trail");
  return followLineScript(trail, START, env, { frames, k: NIA });
}

// The screenshots go to the test output folder (e2e/.output, not in git).
// CANOPY_SHOTS=1 writes the committed evidence in e2e/__screenshots__
// instead; use it only to update that evidence on purpose.
function shotPath(testInfo, name) {
  return process.env.CANOPY_SHOTS === "1" ? `e2e/__screenshots__/${name}` : testInfo.outputPath(name);
}

const near = (s) => Math.hypot(s.skater[0] - TREE.x, s.skater[2] - TREE.z) < 14;

test.describe.configure({ timeout: 240000 });

test("before (#230): with the canopy test off, the camera goes through the street tree crown", async ({ page }, testInfo) => {
  const planned = plan(RIDE_FRAMES);
  await open(page, "&canopycam=0");
  const result = await ride(page, { script: planned.script, start: START });
  const inside = result.samples.filter((s) => s.inCanopy);
  expect(inside.length, "the spot shows the bug without the fix").toBeGreaterThan(0);
  expect(result.samples.every((s) => s.canopyHit === null)).toBe(true);

  // The evidence: the frame where the camera is in the crown.
  const frozen = await rideAndFreeze(page, { script: planned.script, start: START }, { inCanopy: true });
  expect(frozen, "a frame with the camera in the crown").not.toBeNull();
  await page.screenshot({ path: shotPath(testInfo, "canopy-camera-before.png") });
});

test("after (#230): riding past a street tree, the camera stays out of every canopy and Nia stays on screen", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  const planned = plan(RIDE_FRAMES);
  expect(planned.offTrack).toBeLessThan(LEVEL.strips.find((s) => s.kind === "trail").width / 2);
  await open(page);
  const info = await page.evaluate((t) => ({ count: window.__atl.canopy.count, near: window.__atl.canopy.near(t.x, t.z, 1).length }), TREE);
  expect(info.count).toBeGreaterThan(1000);
  expect(info.near).toBeGreaterThan(0);

  const result = await ride(page, { script: planned.script, start: START });
  for (let i = 0; i < 3; i += 1) expect(Math.abs(result.end.position[i] - planned.state.position[i])).toBeLessThan(0.01);
  expect(result.end.stats.respawns).toBe(0);
  const { samples } = result;
  expect(samples.length).toBeGreaterThan(20);
  // She passed the tree.
  expect(samples.some(near)).toBe(true);

  const inside = samples.filter((s) => s.inCanopy);
  expect(inside, `camera in a canopy: ${JSON.stringify(inside.slice(0, 3))}`).toEqual([]);
  // The canopy test pulled the camera in at the tree.
  expect(samples.filter(near).some((s) => s.canopyHit !== null)).toBe(true);
  // Nia is on screen the whole ride.
  const offscreen = samples.filter((s) => Math.abs(s.x) > 1 || Math.abs(s.y) > 1 || s.z > 1);
  expect(offscreen, `off-screen samples: ${JSON.stringify(offscreen.slice(0, 3))}`).toEqual([]);

  // The evidence: the frame at the tree, where the old camera was in the crown.
  const frozen = await rideAndFreeze(page, { script: planned.script, start: START }, { atTick: AT_TREE });
  await page.screenshot({ path: shotPath(testInfo, "canopy-camera-after.png") });
  expect(frozen.inCanopy).toBe(false);
  expect(Math.abs(frozen.x) < 1 && Math.abs(frozen.y) < 1).toBe(true);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

// Review of #234: in the pbr look the Blender GLB trees (assets/trees) take
// the place of the procedural trees. The canopy volume of each variant must
// hold the GLB crown too. The GLB files use Draco, so the test reads them in
// the browser with the loader of the game.
test("the canopy volume of each tree variant holds its GLB crown (pbr look)", async ({ page }) => {
  await page.goto("/src/sim/canopy-fit.js");
  const result = await page.evaluate(async () => {
    const view = await import("/src/render/geo-view.js");
    const cam = await import("/src/sim/camera.js");
    const trees = await import("/src/level/geo/trees.js");
    const out = { checked: 0, outside: [] };
    for (const species of Object.keys(view.TREE_GLB_URLS)) {
      const glb = await view.loadKitTemplates(view.TREE_GLB_URLS[species]);
      for (let variant = 0; variant < trees.TREE_VARIANTS; variant += 1) {
        const t = glb[`tree_${species}_${variant}`];
        if (!t) {
          out.outside.push(`${species}:${variant} has no GLB tree`);
          continue;
        }
        // A placement that gets this variant, at scale 1.2 and a yaw.
        let p = null;
        for (let x = 0; x < 100 && !p; x += 0.7) {
          const q = { kind: "tree_round", species, x, y: 0, z: 0, scale: 1.2 };
          if (trees.treeKindFor(q) === `tree:${species}:${variant}`) p = q;
        }
        const v = cam.treeVolume(p);
        // The crown: every vertex at or over the lowest leaf card.
        let bottom = Infinity;
        for (let i = 0; i < t.positions.length / 3; i += 1) if (t.leaf[i * 3 + 2] >= 0) bottom = Math.min(bottom, t.positions[i * 3 + 1]);
        const yaw = 2.2;
        for (let i = 0; i < t.positions.length / 3; i += 1) {
          const [x, y, z] = [t.positions[i * 3], t.positions[i * 3 + 1], t.positions[i * 3 + 2]];
          if (y < bottom) continue;
          out.checked += 1;
          const wx = x * Math.cos(yaw) + z * Math.sin(yaw);
          const wz = -x * Math.sin(yaw) + z * Math.cos(yaw);
          if (!cam.insideVolume(v, [p.x + wx * p.scale, y * p.scale, p.z + wz * p.scale])) {
            out.outside.push(`${species}:${variant} vertex ${i}`);
            break;
          }
        }
      }
    }
    return out;
  });
  expect(result.checked).toBeGreaterThan(10000);
  expect(result.outside).toEqual([]);
});
