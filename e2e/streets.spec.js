// Street screenshots for a before and after compare (issue #135).
//
// It runs only when STREETS_OUT is set, so the normal e2e run skips it:
//
//   STREETS_OUT=reports/streets/135-after npx playwright test e2e/streets.spec.js
//
// It saves one PNG for each street in STREETS below, in STREETS_OUT, with
// the HUD hidden. Each camera is `x,y,z,lx,ly,lz`; each height is over the
// terrain under that point (src/main.js `cam`).

import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

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
