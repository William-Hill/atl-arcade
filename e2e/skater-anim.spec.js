import { expect, test } from "@playwright/test";
import { SESSIONS } from "../src/playtest/sessions.js";
import { CLIPS } from "../src/render/skater-anim.js";

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

test("every Nia clip renders as a contact sheet", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1200, height: 360 });
  await page.goto("/skater.html?skater=nia");
  await page.waitForFunction(() => window.__skater && (window.__skater.ready || window.__skater.error), null, { timeout: 30000 });
  const names = await page.evaluate(() => window.__skater.clips);
  expect([...names].sort()).toEqual(Object.keys(CLIPS).sort());
  for (const name of names) {
    const info = await page.evaluate((n) => window.__skater.sheet(n), name);
    expect(info.tracks).toBeGreaterThan(5);
    await page.screenshot({ path: `assets/skaters/nia/clips/${name}.png` });
  }
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

// The pixel check: a silhouette of the skater alone, from a camera in front of
// it, is compared with the silhouette of the bind pose (the T-pose). A T-pose
// frame has an IoU near 1.
test("the scripted sessions show no T-pose frame", async ({ page }) => {
  test.setTimeout(120000);
  const errors = collectErrors(page);
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 30000 });
  const tpose = await page.evaluate(() => window.__atl.skaterModel.tposeSilhouette());
  const tposePixels = tpose.reduce((a, b) => a + b, 0);
  expect(tposePixels).toBeGreaterThan(300);
  // Control: a second bind-pose frame must fail the gate below.
  const again = await page.evaluate(() => window.__atl.skaterModel.tposeSilhouette());
  let ci = 0;
  let cu = 0;
  for (let k = 0; k < tpose.length; k += 1) {
    if (tpose[k] && again[k]) ci += 1;
    if (tpose[k] || again[k]) cu += 1;
  }
  expect(ci / cu).toBeGreaterThan(0.95);
  // Control: the idle pose at the spawn must pass it.
  const idle = await page.evaluate(() => window.__atl.skaterModel.silhouette());
  let ii = 0;
  let iu = 0;
  for (let k = 0; k < tpose.length; k += 1) {
    if (tpose[k] && idle[k]) ii += 1;
    if (tpose[k] || idle[k]) iu += 1;
  }
  expect(ii / iu).toBeLessThan(0.8);

  const report = [];
  for (const session of SESSIONS) {
    const samples = await page.evaluate(async ({ script, start }) => {
      const atl = window.__atl;
      const out = [];
      const done = atl.runScript(script, start);
      let finished = false;
      done.then(() => {
        finished = true;
      });
      while (!finished) {
        await new Promise((r) => setTimeout(r, 120));
        out.push({ clip: atl.skaterModel.clip, mask: atl.skaterModel.silhouette() });
      }
      return out;
    }, session);
    for (const [i, s] of samples.entries()) {
      let inter = 0;
      let union = 0;
      let pixels = 0;
      for (let k = 0; k < s.mask.length; k += 1) {
        if (s.mask[k]) pixels += 1;
        if (s.mask[k] && tpose[k]) inter += 1;
        if (s.mask[k] || tpose[k]) union += 1;
      }
      report.push({ session: session.id, i, clip: s.clip, iou: inter / union, pixels });
    }
    await page.screenshot({ path: `e2e/__screenshots__/skater-anim-${session.id}.png` });
  }

  const clipsSeen = [...new Set(report.map((r) => r.clip))].sort();
  const worst = report.reduce((a, b) => (b.iou > a.iou ? b : a));
  console.log(`samples ${report.length}, clips seen: ${clipsSeen.join(", ")}, worst IoU ${worst.iou.toFixed(3)} (${worst.clip})`);
  if (process.env.ANIM_DEBUG) console.log(report.map((r) => `${r.session}#${r.i} ${r.clip} ${r.iou.toFixed(2)}`).join("\n"));
  for (const r of report) {
    expect(r.pixels, `empty mask at ${r.session} #${r.i}`).toBeGreaterThan(100);
    expect(r.iou, `T-pose-like frame at ${r.session} #${r.i} (${r.clip})`).toBeLessThan(0.8);
  }
  expect(clipsSeen).toEqual(expect.arrayContaining(["push", "coast", "carve_left", "grind_frontside", "jump", "land", "bail", "air_mute"]));
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the switch button turns the skater to ride backward", async ({ page }) => {
  test.setTimeout(60000);
  const errors = collectErrors(page);
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 30000 });
  const samples = await page.evaluate(async () => {
    const atl = window.__atl;
    const P = (frames, extra = {}) => ({ frames, input: { push: true, ...extra } });
    const script = [P(90), { frames: 2, input: { switch: true } }, { frames: 60, input: {} }, P(60), { frames: 30, input: {} }];
    const out = [];
    let finished = false;
    atl.runScript(script, { position: [-24, 0, 0], yaw: 0 }).then(() => {
      finished = true;
    });
    let shot = false;
    while (!finished) {
      await new Promise((r) => setTimeout(r, 100));
      out.push({ clip: atl.skaterModel.clip, facing: atl.skaterModel.facing, backward: atl.skater.backward });
      if (!shot && atl.skaterModel.clip === "ride_back" && atl.skaterModel.facing > 3.1) {
        shot = true;
        out.push({ shot: true });
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    return out;
  });
  const back = samples.filter((s) => s.clip === "ride_back");
  expect(back.length).toBeGreaterThan(3);
  expect(Math.max(...back.map((s) => s.facing))).toBeCloseTo(Math.PI, 2);
  expect(samples.filter((s) => s.clip === "push" || s.clip === "coast").every((s) => !s.backward)).toBe(true);
  await page.screenshot({ path: "e2e/__screenshots__/skater-anim-backward.png" });
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
