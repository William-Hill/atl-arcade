import { expect, test } from "@playwright/test";
import fs from "node:fs";

// The v3 move set in the game (#107 follow-up). For each skater, one ride
// plays the idle, the cruise (push and coast), a turn, a dance, and the
// brake. The test saves frames of each move to e2e/.output/moves/ and checks:
// - each move plays its clip;
// - the body does not turn sideways: the hip line stays within 20 degrees
//   of square to the travel direction (the lean layer bug turned it 48).
const P = (frames, steer = 0) => ({ frames, input: { push: true, steer } });
const C = (frames, steer = 0) => ({ frames, input: { steer } });
const RIDE = [
  C(120), // idle
  P(120), // cruise: push
  C(20), // cruise: coast
  C(90, 1), // a U-turn while the skater coasts (the lap session turn)
  P(60, 1), // a turn under push: the old sideways case
  P(30),
  { frames: 1, input: { style1: true } },
  C(110), // the dance
  P(60),
  { frames: 70, input: { brake: true } }, // the brake
  C(30),
];
const MOVES = { idle: /^idle$/, cruise: /^(push|coast)$/, turn: /^carve_/, dance: /^dance_/, brake: /^brake$/ };
const OUT = "e2e/.output/moves";

// The toon look on the greybox level, and the pbr look (the target look)
// on the BeltLine level from its spawn. Both looks load the same GLB.
const LOOKS = [
  { look: "toon", query: "level=greybox", start: { position: [-24, 0, 0], yaw: 0 } },
  { look: "pbr", query: "level=beltline-eastside&look=pbr", start: {} },
];

for (const { look, query, start } of LOOKS)
for (const name of ["nia", "marcus"]) {
  test(`${name} plays the v3 moves on the ${look} look and stays square to the travel direction`, async ({ page }) => {
    test.setTimeout(300000);
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    await page.goto(`/?${query}&mute=1&skater=${name}`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.skaterModel.loaded, null, { timeout: 120000 });
    expect(await page.evaluate(() => window.__atl.look)).toBe(look);
    // A probe in the page: the clip and the hip angle on each frame.
    await page.evaluate(({ script, start }) => {
      const atl = window.__atl;
      const g = atl.scene.getObjectByName("skater");
      const find = (n) => {
        let b = null;
        g.traverse((o) => {
          if (!b && o.isBone && o.name.replace(/[^A-Za-z]/g, "").endsWith(n)) b = o;
        });
        return b;
      };
      const L = find("LeftUpLeg");
      const R = find("RightUpLeg");
      const V = g.position.constructor;
      const a = new V();
      const b = new V();
      const probe = { samples: [], done: false };
      window.__moves = probe;
      atl.runScript(script, start).then(() => {
        probe.done = true;
      });
      const tick = () => {
        L.getWorldPosition(a);
        R.getWorldPosition(b);
        // The yaw of the hip line (to the skater's left), against the body yaw.
        const hip = Math.atan2(-(a.x - b.x), -(a.z - b.z));
        const d = hip - g.rotation.y;
        probe.samples.push({ clip: atl.skaterModel.clip, facing: atl.skaterModel.facing, off: (Math.atan2(Math.sin(d), Math.cos(d)) * 180) / Math.PI });
        if (!probe.done) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { script: RIDE, start });

    fs.mkdirSync(OUT, { recursive: true });
    const shots = Object.fromEntries(Object.keys(MOVES).map((k) => [k, 0]));
    for (;;) {
      const { clip, done } = await page.evaluate(() => ({ clip: window.__atl.skaterModel.clip, done: window.__moves.done }));
      if (done) break;
      const move = Object.keys(MOVES).find((k) => MOVES[k].test(clip));
      if (move && shots[move] < 4 && !(move === "idle" && shots.cruise > 0)) {
        // A 320 x 400 px crop around the skater.
        const p = await page.evaluate(() => window.__atl.projectSkater());
        const vp = page.viewportSize();
        const x = Math.round(Math.min(Math.max(((p.x + 1) / 2) * vp.width - 160, 0), vp.width - 320));
        const y = Math.round(Math.min(Math.max(((1 - p.y) / 2) * vp.height - 190, 0), vp.height - 400));
        await page.screenshot({ path: `${OUT}/${look}-${name}-${move}-${shots[move]}.png`, clip: { x, y, width: 320, height: 400 } });
        shots[move] += 1;
      }
      await page.waitForTimeout(move ? 120 : 30);
    }
    const samples = await page.evaluate(() => window.__moves.samples);
    const seen = new Set(samples.map((s) => s.clip));
    for (const [move, re] of Object.entries(MOVES)) {
      expect([...seen].some((c) => re.test(c)), `${name}: no ${move} clip in ${[...seen].join(", ")}`).toBe(true);
      expect(shots[move], `${name}: frames of ${move}`).toBeGreaterThan(0);
    }
    // Forward clips only: a dance spin and the backward ride turn the body on purpose.
    const forward = samples.filter((s) => !/^dance_|^grind_/.test(s.clip) && Math.abs(s.facing) < 0.01);
    const worst = Math.max(...forward.map((s) => Math.abs(s.off)));
    fs.writeFileSync(`${OUT}/${look}-${name}-ride.json`, JSON.stringify({ worst, clips: [...seen], frames: samples.length }));
    expect(forward.length).toBeGreaterThan(80);
    expect(worst, `${name}: the hips turned ${worst.toFixed(1)} degrees off the travel direction`).toBeLessThan(20);
    expect(errors).toEqual([]);
  });
}
