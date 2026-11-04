// The asset lab capture for the art loop (agents/asset-judge.md).
//
// It runs only when LAB_KIND is set, so the normal e2e run skips it:
//
//   LAB_KIND=brick-loft LAB_PICK=0 LAB_LOOK=pbr npx playwright test e2e/lab.spec.js
//
// It saves one PNG for each lab view (src/level/geo/lab.js) in
// reports/lab/<kind>-<pick>-<look>/, plus info.json with the building and the
// URLs. The HUD is hidden, so the PNG shows only the scene.

import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { LAB_VIEWS } from "../src/level/geo/lab.js";

const KIND = process.env.LAB_KIND;
const PICK = Number(process.env.LAB_PICK ?? 0);
const LOOK = process.env.LAB_LOOK ?? "pbr";
const VIEWS = process.env.LAB_VIEWS ? process.env.LAB_VIEWS.split(",") : LAB_VIEWS;

test.skip(!KIND, "set LAB_KIND to run the asset lab");
test.setTimeout(600000);

test(`asset lab: ${KIND} pick ${PICK}, ${LOOK} look`, async ({ page }) => {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.setViewportSize({ width: 1280, height: 720 });
  // LAB_OUT sets another folder, so a new capture keeps an older one.
  const dir = process.env.LAB_OUT ?? `reports/lab/${KIND}-${PICK}-${LOOK}`;
  mkdirSync(dir, { recursive: true });
  const info = { kind: KIND, pick: PICK, look: LOOK, views: {} };
  for (const view of VIEWS) {
    const query = `level=beltline-eastside&mute=1&quality=high&governor=0&view=fixed&skater=capsule&look=${LOOK}&lab=building&kind=${KIND}&pick=${PICK}&labview=${view}`;
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 120000 });
    await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 120000 });
    const lab = await page.evaluate(() => window.__atl.lab);
    expect(lab, "the lab building").not.toBeNull();
    // Hide the HUD, the minimap, and every overlay; keep the WebGL canvas.
    await page.evaluate(() => {
      const main = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      for (const el of document.querySelectorAll("body *")) {
        if (el === main || el.contains(main)) continue;
        el.style.visibility = "hidden";
      }
    });
    // Let the ground scans and the GTAO settle.
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${dir}/${view}.png` });
    info.building = lab;
    info.views[view] = `/?${query}`;
  }
  writeFileSync(`${dir}/info.json`, `${JSON.stringify(info, null, 2)}\n`);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
});
