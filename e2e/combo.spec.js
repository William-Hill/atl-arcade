import { expect, test } from "@playwright/test";
import { GRIND } from "../src/sim/skate/constants.js";

const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

// Grind the straight rail, jump off, land, shuffle: a 3-link combo.
const THREE_LINK = [
  { frames: 90, input: { push: true } },
  { frames: 40, input: { grind: true, steer: BAL } },
  { frames: 1, input: { grind: true, steer: BAL, jump: true } },
  { frames: 45, input: {} },
  { frames: 1, input: { style1: true } },
  { frames: 36, input: {} },
];

async function ready(page) {
  await page.goto("/");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 20000 });
}

test("a scripted grind, jump, style move yields a 3-link combo on the HUD", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  await ready(page);

  const result = await page.evaluate(async (script) => {
    const end = await window.__atl.runScript(script, { position: [-26, 0, -2], yaw: 0 });
    return { end, events: window.__atl.events, hud: { combo: document.getElementById("hud-combo").textContent, pending: document.getElementById("hud-pending").textContent } };
  }, THREE_LINK);

  // Pause the render one frame so the HUD reflects the final tick.
  await page.waitForTimeout(50);
  const hud = await page.evaluate(() => ({
    combo: document.getElementById("hud-combo").textContent,
    pending: document.getElementById("hud-pending").textContent,
    score: document.getElementById("hud-score").textContent,
    style: document.getElementById("hud-style-fill").style.width,
  }));

  const moves = result.events.filter((e) => e.type === "move").map((e) => e.name);
  expect(moves).toEqual(["Rail Grind", "Hop", "Shuffle"]);
  expect(result.end.combo.links).toHaveLength(3);
  expect(result.end.combo.multiplier).toBe(3);
  expect(result.end.combo.active).toBe(true);
  expect(hud.combo).toBe("Rail Grind + Hop + Shuffle");
  expect(hud.pending).toMatch(/^\d[\d,]* x 3$/);
  expect(hud.style).toBe("25%");
  await page.screenshot({ path: "e2e/__screenshots__/combo-three-link.png" });

  // The combo banks after the link window and the score shows on the HUD.
  await page.waitForFunction(() => !window.__atl.combo.active, null, { timeout: 5000 });
  await page.waitForTimeout(50);
  const banked = await page.evaluate(() => ({ score: document.getElementById("hud-score").textContent, combo: window.__atl.combo }));
  expect(banked.combo.score).toBe(result.end.combo.pending * 3);
  expect(banked.score.replace(/,/g, "")).toBe(String(banked.combo.score));
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});

test("the two style moves animate the capsule differently", async ({ page }) => {
  await ready(page);
  const samples = await page.evaluate(async () => {
    const out = {};
    for (const [key, name] of [["style1", "shuffle"], ["style2", "spin"]]) {
      const done = window.__atl.runScript([{ frames: 60, input: { push: true } }, { frames: 1, input: { [key]: true } }, { frames: 60, input: {} }]);
      const list = [];
      const until = performance.now() + 2500;
      while (performance.now() < until) {
        await new Promise((r) => requestAnimationFrame(r));
        const s = window.__atl.skater;
        if (s.style) {
          const r = window.__atl.skaterRotation;
          list.push({ z: r.z, dy: r.y - s.yaw, anim: s.style.anim });
        }
      }
      await done;
      out[name] = list;
    }
    return out;
  });

  expect(samples.shuffle.length).toBeGreaterThan(3);
  expect(samples.spin.length).toBeGreaterThan(3);
  expect(samples.shuffle.every((x) => x.anim === "tilt")).toBe(true);
  expect(samples.spin.every((x) => x.anim === "spin")).toBe(true);
  // Shuffle rocks around z and keeps the yaw; spin turns around y and keeps z.
  expect(Math.max(...samples.shuffle.map((x) => Math.abs(x.z)))).toBeGreaterThan(0.2);
  expect(Math.max(...samples.shuffle.map((x) => Math.abs(x.dy)))).toBeLessThan(0.01);
  expect(Math.max(...samples.spin.map((x) => Math.abs(x.dy)))).toBeGreaterThan(1);
  expect(Math.max(...samples.spin.map((x) => Math.abs(x.z)))).toBeLessThan(0.01);
});
