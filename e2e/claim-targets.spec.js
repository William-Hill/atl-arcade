import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { planRide } from "./landmark-rides.js";
import { isRed } from "../src/render/landmark-rings-math.js";
import { padPoint } from "../src/level/skatepark.js";
import { yawFromHeading } from "../src/sim/skate/controller.js";
import { REFUSED_TEXT } from "../src/ui/hud.js";

// The claim targets of #264 and #365, in the game:
// - #264: near a Found grind claim, the rail or curb that counts shows as a
//   gold line with a post at each end. While the skater grinds it, the line
//   is brighter and the HUD goal line follows the grind ("Grind 6 of 15 m").
//   The Ralph McGill curb is the curb of the design audit.
// - #365: the skatepark combo zone is the whole pad plus 2 m (owner decision
//   2026-11-24), drawn as a gold double outline around the pad.
// - #264: a dance press in the air says why it does not count.
//
// Both looks, on a desktop and a phone. The pictures are the evidence:
// e2e/__screenshots__/claim-targets-*.jpg.

const DATA = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const PARK = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/skatepark.json", import.meta.url), "utf8"));
const spot = (id) => DATA.spots.find((s) => s.id === id);
const BRIDGE = "ralph-mcgill-bridge";
const SKATEPARK = "historic-fourth-ward-skatepark";
const JPEG = 85;

const SIZES = [
  { name: "desktop", viewport: { width: 1280, height: 720 }, query: "", phone: false },
  { name: "phone", viewport: { width: 844, height: 390 }, query: "quality=phone&touch=1", phone: true },
];

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/.test(msg.location()?.url ?? "")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// No cars and no walkers: the ride is planned with the level alone.
async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
}

// The pixels that a draw with the overlay hidden and shown changes:
// { changed, gold, red }. `what` is "rings" or "target".
async function overlayPixels(page, what) {
  return page.evaluate(
    ({ what, test }) => {
      const red = new Function(`return ${test}`)();
      const gl = document.getElementById("stage");
      const grab = (hidden) => {
        if (what === "rings") window.__atl.landmarkFx.drawRings(hidden);
        else window.__atl.landmarkFx.drawTarget(hidden);
        const c = document.createElement("canvas");
        c.width = gl.width;
        c.height = gl.height;
        const g = c.getContext("2d");
        g.drawImage(gl, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const a = grab(true);
      const b = grab(false);
      let changed = 0;
      let reds = 0;
      let gold = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 24) continue;
        changed += 1;
        if (red(b[i], b[i + 1], b[i + 2])) reds += 1;
        // The landmark gold: more red than green, more green than blue.
        if (b[i] > 150 && b[i + 1] > 110 && b[i] >= b[i + 1] && b[i + 1] > b[i + 2] + 30) gold += 1;
      }
      return { changed, gold, red: reds };
    },
    { what, test: isRed.toString() },
  );
}

// Starts a scripted ride. The frame freezes (renderPaused) at the first stop
// that holds: "tick:N", "active" (the skater grinds the target), "refused"
// (a dance press did not count).
async function start(page, { script, start: from }, stops) {
  await page.evaluate(
    ({ script, from, stops }) => {
      const atl = window.__atl;
      const ride = { running: true, stopped: null, stops: [...stops], seen: [] };
      const watch = () => {
        const s = atl.skater;
        const t = atl.landmarkFx.target;
        const want = ride.stops[0];
        const hit =
          (typeof want === "string" && want.startsWith("tick:") && s.tick >= Number(want.slice(5))) ||
          (want === "active" && t?.active && /Grind (?:[4-9]|1[0-4]) of 15 m/.test(atl.landmarkFx.goalLine ?? "")) ||
          (want === "refused" && s.refused);
        if (t?.visible) ride.seen.push({ tick: s.tick, active: t.active });
        if (!ride.stopped && ride.stops.length && hit) {
          ride.stopped = ride.stops.shift();
          atl.renderPaused = true;
        }
        if (ride.running) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      ride.done = atl.runScript(script, from).then(() => {
        ride.running = false;
        return { states: atl.landmarks.states(), seen: ride.seen, missed: ride.stops };
      });
      window.__ride = ride;
    },
    { script, from, stops },
  );
}

// Waits for the stop, gives what the page shows, and the ride goes on after `act`.
async function at(page, stop, act) {
  await page.waitForFunction((want) => window.__ride.stopped === want, stop, { timeout: 900000 });
  const out = await act();
  await page.evaluate(() => {
    window.__ride.stopped = null;
    window.__atl.renderPaused = false;
  });
  return out;
}

const view = (page) =>
  page.evaluate(() => ({
    target: window.__atl.landmarkFx.target,
    goal: window.__atl.landmarkFx.goalLine,
    rings: window.__atl.landmarkFx.rings,
    tag: { text: document.getElementById("hud-tag").textContent, refused: document.getElementById("hud-tag").dataset.refused },
    skater: [...window.__atl.skater.position],
  }));

for (const look of ["toon", "pbr"]) {
  for (const size of SIZES) {
    test(`#264 and #365 in the ${look} look on the ${size.name}: the Ralph McGill curb and the skatepark pad show as claim targets`, async ({ browser }) => {
      test.setTimeout(1800000);
      const context = await browser.newContext(size.phone ? { viewport: size.viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size.viewport });
      const page = await context.newPage();
      const errors = collectErrors(page);
      await open(page, `look=${look}&${size.query}`);
      const shot = (name) => `e2e/__screenshots__/claim-targets-${look}-${size.name}-${name}.jpg`;

      // ------------------------------------------------ #264: the grind target
      const c = spot(BRIDGE).challenge;
      const ride = planRide(BRIDGE);
      expect(ride.claimed).toBe(true);
      await page.evaluate((id) => {
        window.__atl.landmarks.reset();
        window.__atl.landmarks.find(id);
      }, BRIDGE);
      await start(page, ride, ["tick:20", "active"]);

      // Near the zone, before the grind: the curb shows, at rest.
      const near = await at(page, "tick:20", async () => {
        const v = await view(page);
        await page.screenshot({ path: shot("curb-near"), type: "jpeg", quality: JPEG });
        return { ...v, px: await overlayPixels(page, "target") };
      });
      expect(near.target).toMatchObject({ shown: [BRIDGE], feature: c.feature, visible: true, active: false });
      expect(near.target.length).toBeGreaterThanOrEqual(c.meters);
      expect(near.px.changed).toBeGreaterThan(size.phone ? 40 : 80);
      expect(near.px.gold).toBeGreaterThan(size.phone ? 10 : 20);
      expect(near.px.red).toBe(0);
      expect(near.goal).toBe(`Claim it: ${c.hint[0].toLowerCase()}${c.hint.slice(1)}`);

      // On the curb: the line is brighter and the goal line follows the grind.
      const on = await at(page, "active", async () => {
        const v = await view(page);
        await page.screenshot({ path: shot("curb-grind"), type: "jpeg", quality: JPEG });
        return v;
      });
      expect(on.target).toMatchObject({ shown: [BRIDGE], active: true });
      expect(on.target.gain).toBeGreaterThan(near.target.gain);
      expect(on.goal).toMatch(/^Claim it: grind the curb below the bridge for 15 m\nGrind \d+ of 15 m$/);
      const done = await page.evaluate(() => window.__ride.done);
      expect(done.states[BRIDGE]).toBe("claimed");
      // After the claim, no target is left.
      await page.waitForFunction(() => !window.__atl.landmarkFx.target.visible, null, { timeout: 120000 });

      // ---------------------------------------------- #365: the skatepark pad
      // The skater at the west end of the rail lane, facing east along the
      // pad: the place where the combo of the Autopilot run ended.
      const [wx, wz] = padPoint(PARK, -16, -3.5);
      const yaw = yawFromHeading(PARK.axis[0], PARK.axis[1]);
      await page.evaluate(
        ({ id, x, z, yaw }) => {
          const s = window.__atl.level.sample(x, z);
          window.__atl.resetSkater([x, s ? s.height : 0, z], yaw);
          window.__atl.landmarks.find(id);
        },
        { id: SKATEPARK, x: wx, z: wz, yaw },
      );
      await page.waitForFunction(() => window.__atl.landmarks.banner().current === null && window.__atl.landmarks.banner().waiting === 0, null, { timeout: 600000 });
      await page.waitForTimeout(1500);
      const pad = await view(page);
      const ring = pad.rings.list.find((r) => r.id === SKATEPARK);
      expect(ring.rect.hu).toBeCloseTo(PARK.size[0] / 2 + 2, 1);
      expect(ring.rect.hv).toBeCloseTo(PARK.size[1] / 2 + 2, 1);
      expect(pad.goal).toBe("Claim it: land a 2,000 point combo in the skatepark");
      const padPx = await overlayPixels(page, "rings");
      await page.screenshot({ path: shot("skatepark-pad"), type: "jpeg", quality: JPEG });
      expect(padPx.changed).toBeGreaterThan(size.phone ? 150 : 300);
      expect(padPx.gold / padPx.changed).toBeGreaterThan(0.3);
      expect(padPx.red).toBe(0);

      // ------------------------- #264: a dance in the air says why it does not count
      if (!size.phone || look === "toon") {
        const air = [
          { frames: 40, input: { push: true } },
          { frames: 1, input: { push: true, jump: true } },
          { frames: 6, input: {} },
          { frames: 1, input: { style1: true } },
          { frames: 20, input: {} },
        ];
        await start(page, { script: air, start: { position: [...pad.skater], yaw } }, ["refused"]);
        const said = await at(page, "refused", async () => {
          // The HUD updates on the next frame.
          await page.evaluate(() => {
            window.__atl.renderPaused = false;
          });
          await page.waitForFunction(() => document.getElementById("hud-tag").dataset.refused === "1", null, { timeout: 120000 });
          await page.evaluate(() => {
            window.__atl.renderPaused = true;
          });
          const v = await view(page);
          await page.screenshot({ path: shot("dance-in-air"), type: "jpeg", quality: JPEG });
          return v;
        });
        expect(said.tag).toEqual({ text: REFUSED_TEXT.air, refused: "1" });
        await page.evaluate(() => window.__ride.done);
      }

      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
      await context.close();
    });
  }
}

// #365: the outline from above: a rounded rectangle 2 m around the pad.
for (const look of ["toon", "pbr"]) {
  test(`#365 in the ${look} look: from above, the skatepark outline lies 2 m around the pad`, async ({ page }) => {
    test.setTimeout(900000);
    const errors = collectErrors(page);
    await open(page, `look=${look}&view=fixed`);
    await page.evaluate((id) => {
      window.__atl.landmarks.reset();
      window.__atl.landmarks.find(id);
    }, SKATEPARK);
    await page.waitForFunction(() => window.__atl.landmarks.banner().current === null && window.__atl.landmarks.banner().waiting === 0, null, { timeout: 600000 });
    const [cx, cz] = PARK.center;
    const y = await page.evaluate(([x, z]) => window.__atl.level.sample(x, z).height, [cx, cz]);
    await page.evaluate(([x, y, z]) => window.__atl.setFixedCamera(x, y + 45, z + 0.01, x, y, z), [cx, y, cz]);
    await page.waitForTimeout(1500);
    const rings = await page.evaluate(() => window.__atl.landmarkFx.rings);
    const ring = rings.list.find((r) => r.id === SKATEPARK);
    expect(ring.x).toBeCloseTo(cx, 1);
    expect(ring.z).toBeCloseTo(cz, 1);
    const px = await overlayPixels(page, "rings");
    await page.screenshot({ path: `e2e/__screenshots__/claim-targets-${look}-skatepark-above.jpg`, type: "jpeg", quality: JPEG });
    expect(px.changed).toBeGreaterThan(1000);
    expect(px.gold / px.changed).toBeGreaterThan(0.3);
    expect(px.red).toBe(0);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
}
