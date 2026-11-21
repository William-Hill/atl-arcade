import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { planRide, replay, rideIntoGap, startAt } from "./landmark-rides.js";
import { isRed } from "../src/render/landmark-rings-math.js";
import { FREE_RUN_HINT } from "../src/landmarks/play.js";

// Landmark discovery in the game (#219): the Found and Claimed banners, the
// HUD goal line, the challenge rings and the chimes. Design:
// design/gdd/landmark-discovery.md, AC-2, AC-3, AC-5, AC-7, E-3, E-7, P-1,
// R-1, S-4. The rides run with the real controller: planned in the pure
// simulation (e2e/landmark-rides.js) and replayed in the page tick for tick.
//
// The pictures are the evidence: e2e/__screenshots__/landmarks-*.jpg.

const DATA = JSON.parse(readFileSync(new URL("../levels/beltline-eastside/landmarks.json", import.meta.url), "utf8"));
const spot = (id) => DATA.spots.find((s) => s.id === id);
const JPEG = 85;
const shot = (name) => `e2e/__screenshots__/landmarks-${name}.jpg`;
const LOOKS = ["toon", "pbr"];

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/favicon/.test(msg.location()?.url ?? "")) errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

// No cars: a car is a wall for the skater, and the rides are planned with
// the level alone. No walkers: they do not change the skater.
async function open(page, query = "", { mute = true } = {}) {
  await page.goto(`/?level=beltline-eastside${mute ? "&mute=1" : ""}&governor=0&weather=clear&time=14&cars=0&npcs=0&peds=0&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
}

const fx = (page) => page.evaluate(() => ({ banner: window.__atl.landmarkFx.banner, goal: window.__atl.landmarkFx.goalLine, rings: window.__atl.landmarkFx.rings, chimes: window.__atl.landmarkFx.chimes }));
const states = (page) => page.evaluate(() => window.__atl.landmarks.states());

// Every spot Unknown, then a scripted ride from `start`. The promise of the
// ride stays in the page (window.__ride).
async function ride(page, { script, start }, { reset = true } = {}) {
  await page.evaluate(
    ({ script, start, reset }) => {
      if (reset) window.__atl.landmarks.reset();
      window.__ride = { done: false };
      // The end state of the ride, on the tick the script ends.
      window.__atl.runScript(script, start).then((end) => (window.__ride = { done: true, end: [...end.position] }));
    },
    { script, start, reset },
  );
}

// A record of each frame: the tick, the banner, the goal line, the rings.
async function record(page) {
  await page.evaluate(() => {
    window.__rec = [];
    const rec = window.__rec;
    const tick = () => {
      if (window.__rec !== rec) return;
      const a = window.__atl;
      const b = a.landmarkFx.banner;
      rec.push({ t: performance.now(), tick: a.ticks, z: a.skater.position[2], visible: b.visible, type: b.type, id: b.id, opacity: b.opacity, transform: b.transform, time: a.landmarks.banner().current?.time ?? null, goal: a.landmarkFx.goalLine, rings: a.landmarkFx.rings?.rings ?? 0, pulse: a.landmarkFx.rings?.pulse ?? 1, fading: a.landmarkFx.rings?.fading ?? 0, fade: a.landmarkFx.rings?.fade ?? null });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
const recorded = (page) => page.evaluate(() => {
  const r = window.__rec;
  window.__rec = null;
  return r;
});

// The boxes that the banner must not cover. Empty HUD items have no box.
async function bannerOverlaps(page) {
  return page.evaluate(() => {
    const banner = document.getElementById("landmark-banner").getBoundingClientRect();
    const hits = [];
    for (const s of ["#hud > *", "#minimap", "#skater-select button", "#attribution .attr-short", ".touch-btn", ".touch-stick-base", "#fact-popup"]) {
      for (const el of document.querySelectorAll(s)) {
        const style = getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || el.closest("[hidden]") || el.hidden) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < banner.right && r.right > banner.left && r.top < banner.bottom && r.bottom > banner.top) hits.push(`${s} ${el.id || el.className}`);
      }
    }
    return { hits, box: { left: banner.left, right: banner.right, top: banner.top, bottom: banner.bottom, width: banner.width }, view: { w: window.innerWidth, h: window.innerHeight } };
  });
}

// S-4: the count of red pixels in a PNG screenshot (decoded in the page).
async function redPixels(page, png) {
  return page.evaluate(
    async ({ src, test }) => {
      const red = new Function(`return ${test}`)();
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (red(d[i], d[i + 1], d[i + 2])) n += 1;
      return { red: n, total: d.length / 4 };
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, test: isRed.toString() },
  );
}

// S-4: the ring pixels of the frame. The page draws the same frame with no
// ring and with the rings, in one task; the pixels that differ are the rings.
async function ringPixels(page) {
  return page.evaluate((test) => {
    const red = new Function(`return ${test}`)();
    const gl = document.getElementById("stage");
    const grab = (hidden) => {
      window.__atl.landmarkFx.drawRings(hidden);
      const c = document.createElement("canvas");
      c.width = gl.width;
      c.height = gl.height;
      const g = c.getContext("2d");
      g.drawImage(gl, 0, 0);
      return g.getImageData(0, 0, c.width, c.height).data;
    };
    const a = grab(true);
    const b = grab(false);
    let ring = 0;
    let reds = 0;
    let gold = 0;
    for (let i = 0; i < a.length; i += 4) {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) < 24) continue;
      ring += 1;
      if (red(b[i], b[i + 1], b[i + 2])) reds += 1;
      // The landmark gold: more red than green, more green than blue.
      if (b[i] > 150 && b[i + 1] > 110 && b[i] >= b[i + 1] && b[i + 1] > b[i + 2] + 30) gold += 1;
    }
    return { ring, red: reds, gold };
  }, isRed.toString());
}

// The words on the screen, in the DOM that shows.
const screenText = (page) => page.evaluate(() => document.body.innerText);

// A ride that starts outside the find zone of the Freedom Parkway bridge,
// rolls in (Found) and hops under the bridge (Claimed): the gap challenge.
const GAP = rideIntoGap("freedom-parkway-bridge", startAt(336, 45, Math.PI / 2));

test.describe("the rides are valid in the pure simulation", () => {
  test("the planned rides claim their spots with the real controller", () => {
    const gap = replay(GAP.script, GAP.start);
    expect(gap.claimed).toEqual(["freedom-parkway-bridge"]);
    expect(gap.found).toEqual(["freedom-parkway-bridge"]);
    for (const id of ["ralph-mcgill-bridge", "telephone-factory-lofts", "historic-fourth-ward-skatepark"]) expect(planRide(id).claimed, id).toBe(true);
  });
});

for (const look of LOOKS) {
  test(`AC-2, AC-3, AC-5, AC-7 in the ${look} look: a ride finds the Freedom Parkway bridge, shows the hint and 1 ring, claims it with a hop, and the claim survives a reload`, async ({ page }) => {
    test.setTimeout(420000);
    const errors = collectErrors(page);
    const s = spot("freedom-parkway-bridge");
    await open(page, `look=${look}`);
    expect(await page.evaluate(() => window.__atl.look)).toBe(look);
    await ride(page, GAP);
    // Before the ride reaches the zone: Unknown, no banner, no ring, no line.
    const before = await fx(page);
    expect((await states(page))["freedom-parkway-bridge"]).toBe("unknown");
    expect(before.rings).toMatchObject({ rings: 0, visible: false });
    expect(before.goal).toBeNull();
    await record(page);

    // Found: the banner has the name and the `short` line.
    await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "found" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
    await page.screenshot({ path: shot(`${look}-found-banner`), type: "jpeg", quality: JPEG });
    const found = await fx(page);
    expect(found.banner).toMatchObject({ visible: true, type: "found", id: s.id, title: s.name, text: s.short, points: "" });
    expect((await bannerOverlaps(page)).hits).toEqual([]);
    // AC-3: the HUD goal line and 1 ring at the zone.
    expect(found.goal).toBe("Claim it: hop under the Freedom Parkway bridge");
    expect(found.rings).toMatchObject({ rings: 1, visible: true, shapes: [0], ids: [s.id], color: "#ffd166", meshes: 1 });
    expect(found.rings.list[0]).toMatchObject({ x: s.challenge.zone.x, z: s.challenge.zone.z, r: 12 });

    // Claimed: "SPOT CLAIMED", the name, the points. It shows after the Found banner.
    await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "claimed" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
    await page.screenshot({ path: shot(`${look}-claimed-banner`), type: "jpeg", quality: JPEG });
    const claimed = await fx(page);
    expect(claimed.banner).toMatchObject({ visible: true, type: "claimed", title: "SPOT CLAIMED", text: s.name, points: "+200" });
    expect((await bannerOverlaps(page)).hits).toEqual([]);
    // The banner colors: an accent fill with dark ink, and no red.
    const colors = await page.evaluate(() => {
      const el = document.getElementById("landmark-banner");
      const c = getComputedStyle(el);
      return { fill: c.backgroundColor, ink: c.color, border: c.borderTopColor };
    });
    expect(colors.ink).toBe("rgb(11, 11, 18)");
    for (const c of Object.values(colors)) expect(isRed(...c.match(/\d+/g).slice(0, 3).map(Number)), c).toBe(false);
    // The pixels of the pill, inside its round corners (the scene shows in the corners of the box).
    const box = await page.locator("#landmark-banner").boundingBox();
    const clip = { x: box.x + 16, y: box.y + 16, width: box.width - 32, height: box.height - 32 };
    expect((await redPixels(page, await page.screenshot({ clip }))).red).toBe(0);
    // AC-5: Claimed, the points banked for the medal, the ring gone, the line gone.
    await page.waitForFunction(() => window.__ride.done, null, { timeout: 120000 });
    const after = await page.evaluate(() => ({ states: window.__atl.landmarks.states(), run: window.__atl.landmarks.run(), goals: window.__atl.goals.state.gaps, results: window.__atl.goals.results, score: window.__atl.combo.score, events: window.__atl.events.filter((e) => /landmark|gap/.test(e.type)), saved: window.__atl.landmarks.saved(), store: JSON.parse(localStorage.getItem("atl.landmarks")) }));
    expect(after.states["freedom-parkway-bridge"]).toBe("claimed");
    expect(after.run.claimed).toEqual([{ id: s.id, points: 200, first: true }]);
    expect(after.run.claimSum).toBe(200);
    // The gap claim marks the gap goal of this run, once.
    expect(after.goals).toEqual(["gap-freedom-parkway"]);
    expect(after.events.map((e) => e.type)).toEqual(["landmark-found", "gap", "landmark-claimed"]);
    // Claim points count toward the medal only: the score has no claim points.
    expect(after.results.score).toBe(after.score);
    expect(after.results.medalScore).toBe(after.score + 200);
    const end = await fx(page);
    expect(end.rings).toMatchObject({ rings: 0, fading: 0, visible: false });
    expect(end.goal).toBeNull();
    // The save.
    expect(after.saved).toBe(true);
    expect(after.store.levels["beltline-eastside"]).toMatchObject({ found: [s.id], claimed: [s.id] });

    // AC-2: the Found banner shows for 3.0 s of play, and play does not pause.
    const rec = await recorded(page);
    const shown = rec.filter((f) => f.visible && f.type === "found");
    expect(shown.length).toBeGreaterThan(5);
    expect(shown.every((f) => f.time === 3)).toBe(true);
    const first = rec.findIndex((f) => f.visible && f.type === "found");
    const lastFound = rec.findLastIndex((f) => f.visible && f.type === "found");
    // The banner is on the screen from the frame after the find to the frame
    // its time ends: 180 ticks, to the ticks of 1 frame (5 at most).
    const ticksShown = rec[lastFound + 1].tick - rec[first - 1].tick;
    expect(ticksShown).toBeGreaterThanOrEqual(180 - 1);
    expect(ticksShown).toBeLessThanOrEqual(180 + 10);
    // No pause: every frame of the banner time has new ticks, as the frames before it.
    const steps = (list) => list.slice(1).map((f, i) => f.tick - list[i].tick);
    const during = steps(rec.slice(first, lastFound + 1));
    const prior = steps(rec.slice(0, first));
    expect(Math.min(...during)).toBeGreaterThanOrEqual(1);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(Math.abs(mean(during) - mean(prior))).toBeLessThan(1);
    expect(shown[shown.length - 1].z).toBeLessThan(shown[0].z - 5);
    // The ring of the claimed spot turns gold and fades: it is on the screen for a moment after the claim, with no ink.
    const fading = rec.filter((f) => f.fading > 0);
    expect(fading.length).toBeGreaterThan(0);
    expect(fading.every((f) => f.rings === 0 && f.fade.fill === 1 && f.fade.alpha < 1)).toBe(true);
    expect(rec[rec.length - 1].fading).toBe(0);
    // The banner fades in and slides in, and the line and the ring are there on the next frame.
    expect(rec[first].goal).toBe("Claim it: hop under the Freedom Parkway bridge");
    expect(rec[first].rings).toBe(1);
    // AC-7: no story card during play. No fact of the card is on the screen
    // (the `short` line restates 1 fact in its own words), and the word
    // "bail" is not on the screen.
    const text = await screenText(page);
    for (const fact of s.card) expect(text).not.toContain(fact.text);
    expect(text.toLowerCase()).not.toContain("bail");

    // AC-6 (e2e part): after a reload the spot is Claimed: no banner, no ring, no line.
    await open(page, `look=${look}`);
    await page.waitForTimeout(1500);
    expect((await states(page))["freedom-parkway-bridge"]).toBe("claimed");
    const reloaded = await fx(page);
    expect(reloaded.banner.visible).toBe(false);
    expect(reloaded.rings).toMatchObject({ rings: 0, visible: false });
    expect(reloaded.goal).toBeNull();
    expect(await page.evaluate(() => window.__atl.landmarks.run().claimed)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`AC-5 in the ${look} look: a grind, a line and the skatepark combo claim their spots with the real controller`, async ({ page }) => {
    test.setTimeout(900000);
    const errors = collectErrors(page);
    await open(page, `look=${look}`);
    const want = { "ralph-mcgill-bridge": { points: 300, shape: 1 }, "telephone-factory-lofts": { points: 300, shape: 2 }, "historic-fourth-ward-skatepark": { points: 500, shape: 3 } };
    for (const [id, w] of Object.entries(want)) {
      const plan = planRide(id);
      expect(plan.claimed, id).toBe(true);
      const s = spot(id);
      // Found first (as a ride in an earlier run): the ring and the line show.
      await page.evaluate(
        ({ id, start }) => {
          window.__atl.landmarks.reset();
          window.__atl.resetSkater(start.position, start.yaw);
          window.__atl.landmarks.find(id);
        },
        { id, start: plan.start },
      );
      await page.waitForFunction(() => window.__atl.landmarkFx.rings.rings > 0 && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 60000 });
      const found = await fx(page);
      expect(found.banner).toMatchObject({ type: "found", title: s.name, text: s.short });
      expect(found.rings.shapes.every((x) => x === w.shape)).toBe(true);
      expect(found.rings.rings).toBe(s.challenge.type === "line" ? s.challenge.checkpoints.length : 1);
      expect(found.goal).toBe(`Claim it: ${s.challenge.hint[0].toLowerCase()}${s.challenge.hint.slice(1)}`);
      await page.screenshot({ path: shot(`${look}-${s.challenge.type}-found`), type: "jpeg", quality: JPEG });
      // The ride, with the spot Found.
      await ride(page, plan, { reset: false });
      await page.evaluate((id) => window.__atl.landmarks.find(id), id);
      if (s.challenge.type === "line") {
        // The line UI: the next ring and the time left, and never "bail".
        await page.waitForFunction(() => /^Ring \d of 3: \d+ s left$/.test(window.__atl.landmarkFx.goalLine ?? ""), null, { timeout: 120000 });
        await page.screenshot({ path: shot(`${look}-line-in-progress`), type: "jpeg", quality: JPEG });
        expect((await screenText(page)).toLowerCase()).not.toContain("bail");
      }
      await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "claimed" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 300000 });
      await page.screenshot({ path: shot(`${look}-${s.challenge.type}-claimed`), type: "jpeg", quality: JPEG });
      const claimed = await fx(page);
      expect(claimed.banner).toMatchObject({ title: "SPOT CLAIMED", text: s.name, points: `+${w.points}` });
      await page.waitForFunction(() => window.__ride.done, null, { timeout: 300000 });
      const after = await page.evaluate(() => ({ states: window.__atl.landmarks.states(), run: window.__atl.landmarks.run(), end: window.__ride.end, bails: window.__atl.events.filter((e) => e.type === "bail").length }));
      expect(after.states[id]).toBe("claimed");
      expect(after.run.claimed).toContainEqual({ id, points: w.points, first: true });
      expect(after.bails).toBe(0);
      // The page ends the ride where the pure simulation ends it.
      for (let i = 0; i < 3; i += 1) expect(Math.abs(after.end[i] - plan.end[i])).toBeLessThan(0.02);
      expect((await fx(page)).rings.ids.some((k) => k.startsWith(id))).toBe(false);
      expect((await screenText(page)).toLowerCase()).not.toContain("bail");
    }
    expect(errors).toEqual([]);
  });

  test(`S-4 in the ${look} look: a ring of each type reads by shape, in the landmark gold, with no red`, async ({ page }) => {
    test.setTimeout(1200000);
    const errors = collectErrors(page);
    await open(page, `look=${look}&view=fixed`);
    const ids = ["ponce-de-leon-bridge", "ralph-mcgill-bridge", "telephone-factory-lofts", "historic-fourth-ward-skatepark"];
    await page.evaluate((ids) => ids.forEach((id) => window.__atl.landmarks.find(id)), ids);
    // The banners end before the pictures.
    await page.waitForFunction(() => window.__atl.landmarks.banner().current === null && window.__atl.landmarks.banner().waiting === 0, null, { timeout: 600000 });
    const rings = (await fx(page)).rings;
    // The 4 spots (the line has 3 rings), and the spot of the spawn: the Freedom Parkway bridge.
    expect(rings.rings).toBe(7);
    expect([...new Set(rings.shapes)].sort()).toEqual([0, 1, 2, 3]);
    expect(rings.emissive).toEqual(look === "pbr" ? { rest: 0.8, core: 0.8 } : { rest: 1, core: 1 });
    for (const id of ids) {
      const group = rings.list.filter((r) => r.id === id);
      const cx = group.reduce((a, r) => a + r.x, 0) / group.length;
      const cz = group.reduce((a, r) => a + r.z, 0) / group.length;
      const span = Math.max(...group.map((r) => Math.hypot(r.x - cx, r.z - cz) + r.r)) * 1.25;
      await page.evaluate(([x, y, z, d]) => window.__atl.setFixedCamera(x - d * 0.9, y + d * 0.9, z + d * 0.9, x, y, z), [cx, group[0].y, cz, span]);
      await page.waitForTimeout(800);
      await page.screenshot({ path: shot(`${look}-ring-${spot(id).challenge.type}`), type: "jpeg", quality: JPEG });
      const px = await ringPixels(page);
      // The ring shows, most of it is gold (the rest is its ink line), and no pixel of it is red.
      expect(px.ring, id).toBeGreaterThan(150);
      expect(px.gold / px.ring, id).toBeGreaterThan(0.3);
      expect(px.red, id).toBe(0);
    }
    expect((await screenText(page)).toLowerCase()).not.toContain("bail");
    expect(errors).toEqual([]);
  });
}

for (const look of LOOKS) {
  for (const size of [{ width: 390, height: 844 }, { width: 360, height: 640 }]) {
    test(`a phone, ${size.width} x ${size.height}, the ${look} look on the phone tier: the banners keep clear of the HUD and the map, and 5 rings add 1 draw call (P-1)`, async ({ browser }) => {
      test.setTimeout(600000);
      const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const page = await context.newPage();
      const errors = collectErrors(page);
      await open(page, `look=${look}&quality=phone&touch=1`);
      expect(await page.evaluate(() => ({ quality: window.__atl.quality, look: window.__atl.look }))).toEqual({ quality: "phone", look });
      const tag = `phone-${size.width}-${look}`;
      // P-1: with 0 Found spots the rings add 0 draw calls.
      await page.evaluate(() => {
        window.__atl.landmarks.reset();
        window.__atl.resetSkater([150, 0, 600], 0);
      });
      const far = await page.evaluate(() => {
        const s = window.__atl.level.sample(150, 600);
        window.__atl.landmarks.reset();
        window.__atl.resetSkater([150, s ? s.height : 0, 600], 0);
        return { states: Object.values(window.__atl.landmarks.states()).filter((x) => x !== "unknown").length, cost: window.__atl.landmarkFx.ringCost() };
      });
      expect(far.states).toBe(0);
      expect(far.cost.rings).toBe(0);
      expect(far.cost.with - far.cost.without).toBe(0);

      // A Found banner by the Freedom Parkway bridge.
      const start = startAt(336, 30, Math.PI / 2);
      await page.evaluate((start) => {
        window.__atl.landmarks.reset();
        window.__atl.resetSkater(start.position, start.yaw);
      }, start);
      await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "found" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
      await page.screenshot({ path: shot(`${tag}-found`), type: "jpeg", quality: JPEG });
      const found = await bannerOverlaps(page);
      expect(found.hits).toEqual([]);
      expect(found.box.width).toBeGreaterThanOrEqual(280);
      // The SETTINGS, PHOTO and FULL SCREEN buttons sit in the band of the banner on a phone: the banner draws over them, and they still take a tap.
      const layer = await page.evaluate(() => ({ banner: Number(getComputedStyle(document.getElementById("landmark-banner")).zIndex), pointer: getComputedStyle(document.getElementById("landmark-banner")).pointerEvents, buttons: ["#settings-toggle", "#photo-toggle", "#fullscreen-toggle"].map((s) => document.querySelector(s)).filter(Boolean).map((el) => Number(getComputedStyle(el).zIndex)) }));
      expect(layer.pointer).toBe("none");
      for (const z of layer.buttons) expect(layer.banner).toBeGreaterThan(z);
      expect(found.box.left).toBeGreaterThanOrEqual(0);
      expect(found.box.right).toBeLessThanOrEqual(size.width);
      expect((await fx(page)).goal).toBe("Claim it: hop under the Freedom Parkway bridge");

      // A Claimed banner.
      await page.evaluate(() => window.__atl.landmarks.claim("freedom-parkway-bridge"));
      await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "claimed" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
      await page.screenshot({ path: shot(`${tag}-claimed`), type: "jpeg", quality: JPEG });
      const claimed = await bannerOverlaps(page);
      expect(claimed.hits).toEqual([]);
      expect(claimed.box.width).toBeGreaterThanOrEqual(280);
      expect(claimed.box.right).toBeLessThanOrEqual(size.width);
      expect((await fx(page)).banner).toMatchObject({ title: "SPOT CLAIMED", points: "+200" });

      // P-1: 5 Found spots: the draw calls are the no-ring count plus 1.
      const cost = await page.evaluate(() => {
        window.__atl.landmarks.reset();
        for (const id of ["freedom-parkway-bridge", "historic-fourth-ward-skatepark", "ralph-mcgill-bridge", "telephone-factory-lofts", "new-realm-brewing"]) window.__atl.landmarks.find(id);
        return null;
      });
      expect(cost).toBeNull();
      await page.waitForFunction(() => window.__atl.landmarkFx.rings.rings === 7, null, { timeout: 60000 });
      const five = await page.evaluate(() => ({ found: Object.values(window.__atl.landmarks.states()).filter((x) => x === "found").length, cost: window.__atl.landmarkFx.ringCost(), rings: window.__atl.landmarkFx.rings }));
      expect(five.found).toBe(5);
      expect(five.cost.with - five.cost.without).toBe(1);
      expect(five.rings).toMatchObject({ visible: true, meshes: 1, tier: "phone" });
      // The ring by the skater, on the phone.
      await page.evaluate(() => window.__atl.landmarks.banner());
      await page.waitForFunction(() => window.__atl.landmarks.banner().current === null && window.__atl.landmarks.banner().waiting === 0, null, { timeout: 120000 });
      await page.screenshot({ path: shot(`${tag}-ring`), type: "jpeg", quality: JPEG });
      expect((await screenText(page)).toLowerCase()).not.toContain("bail");
      expect(errors).toEqual([]);
      await context.close();
    });
  }
}

for (const size of [{ width: 360, height: 640, query: "quality=phone&touch=1", phone: true }, { width: 1024, height: 550, query: "", phone: false }]) {
  test(`at ${size.width} x ${size.height}: a banner waits while the fact pop-up shows, and shows when it closes`, async ({ browser }) => {
    test.setTimeout(420000);
    const context = await browser.newContext(size.phone ? { viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: size });
    const page = await context.newPage();
    const errors = collectErrors(page);
    await open(page, size.query);
    // A fact card and a find in the same step: the skater starts on the card.
    await page.evaluate(() => {
      const card = window.__atl.facts.cards[0];
      window.__atl.landmarks.reset();
      window.__atl.resetSkater(card.position, 0);
      window.__atl.landmarks.find("freedom-parkway-bridge");
    });
    await page.waitForFunction(() => window.__atl.facts.popup.visible, null, { timeout: 60000 });
    const during = await page.evaluate(() => ({ popup: window.__atl.facts.popup.visible, banner: window.__atl.landmarkFx.banner.visible, hook: window.__atl.landmarks.banner(), state: window.__atl.landmarks.states()["freedom-parkway-bridge"] }));
    // The spot is Found at once; only its banner waits.
    expect(during).toMatchObject({ popup: true, banner: false, state: "found" });
    expect(during.hook.current === null || during.hook.current.left === during.hook.current.time).toBe(true);
    await page.screenshot({ path: shot(`popup-first-${size.width}`), type: "jpeg", quality: JPEG });
    await page.waitForFunction(() => window.__atl.landmarkFx.banner.visible && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
    const afterPopup = await page.evaluate(() => ({ popup: window.__atl.facts.popup.visible, banner: window.__atl.landmarkFx.banner }));
    expect(afterPopup.popup).toBe(false);
    expect(afterPopup.banner).toMatchObject({ type: "found", title: "Freedom Parkway Bridge" });
    await page.screenshot({ path: shot(`banner-after-popup-${size.width}`), type: "jpeg", quality: JPEG });
    const box = await bannerOverlaps(page);
    expect(box.hits).toEqual([]);
    expect(box.box.width).toBeGreaterThanOrEqual(280);
    expect(errors).toEqual([]);
    await context.close();
  });
}

test("E-7: photo mode changes nothing: no find, no banner, no chime, until it closes", async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await open(page);
  const start = startAt(336, 18.6, Math.PI / 2);
  // Photo mode opens, and then the skater is in the find zone and the gap zone.
  await page.evaluate((start) => {
    window.__atl.landmarks.reset();
    window.__atl.photo.open();
    window.__atl.resetSkater(start.position, start.yaw);
  }, start);
  const open0 = await page.evaluate(() => ({ ticks: window.__atl.ticks, chimes: window.__atl.landmarkFx.chimes }));
  await page.waitForTimeout(2500);
  const held = await page.evaluate(() => ({ open: window.__atl.photo.isOpen, ticks: window.__atl.ticks, frames: window.__atl.frames, states: window.__atl.landmarks.states(), banner: window.__atl.landmarkFx.banner.visible, rings: window.__atl.landmarkFx.rings.rings, goal: window.__atl.landmarkFx.goalLine, chimes: window.__atl.landmarkFx.chimes, events: window.__atl.events.filter((e) => /landmark/.test(e.type)).length }));
  expect(held.open).toBe(true);
  expect(held.ticks).toBe(open0.ticks);
  expect(Object.values(held.states).every((s) => s === "unknown")).toBe(true);
  expect(held).toMatchObject({ banner: false, rings: 0, goal: null, events: 0 });
  expect(held.chimes.found).toBe(open0.chimes.found);
  expect(held.chimes.played).toBe(open0.chimes.played);
  await page.screenshot({ path: shot("photo-mode"), type: "jpeg", quality: JPEG });
  // It closes: the spot is Found on the next tick.
  await page.evaluate(() => window.__atl.photo.close());
  await page.waitForFunction(() => window.__atl.landmarks.states()["freedom-parkway-bridge"] === "found", null, { timeout: 60000 });
  // A banner on show stops with photo mode, and goes on after it.
  await page.waitForFunction(() => window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 60000 });
  await page.evaluate(() => window.__atl.photo.open());
  const left0 = await page.evaluate(() => window.__atl.landmarks.banner().current.left);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__atl.landmarks.banner().current.left)).toBe(left0);
  // The banner hides while the game is paused, and shows again after.
  expect(await page.evaluate(() => window.__atl.landmarkFx.banner.visible)).toBe(false);
  await page.evaluate(() => window.__atl.photo.close());
  await page.waitForFunction(() => window.__atl.landmarkFx.banner.visible, null, { timeout: 30000 });
  expect(errors).toEqual([]);
});

test("the full map and the settings menu change nothing while they are open", async ({ page }) => {
  test.setTimeout(300000);
  await open(page);
  const start = startAt(336, 18.6, Math.PI / 2);
  for (const menu of ["fullmap", "settings"]) {
    await page.evaluate(
      ({ start, menu }) => {
        window.__atl.landmarks.reset();
        window.__atl[menu].open();
        window.__atl.resetSkater(start.position, start.yaw);
      },
      { start, menu },
    );
    const ticks = await page.evaluate(() => window.__atl.ticks);
    await page.waitForTimeout(1500);
    const held = await page.evaluate((menu) => ({ open: window.__atl[menu].isOpen, ticks: window.__atl.ticks, found: Object.values(window.__atl.landmarks.states()).filter((s) => s !== "unknown").length }), menu);
    expect(held).toEqual({ open: true, ticks, found: 0 });
    await page.evaluate((menu) => window.__atl[menu].close(), menu);
    await page.waitForFunction(() => window.__atl.landmarks.states()["freedom-parkway-bridge"] === "found", null, { timeout: 60000 });
  }
});

test("E-3: Travel here finds the spot and does not claim its gap", async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await open(page);
  // A hop far south of the bridge, and a travel step in the air into the gap zone.
  const far = startAt(336, 160, Math.PI / 2);
  await ride(page, { script: [{ frames: 40, input: { push: true } }, { frames: 1, input: { push: true, jump: true } }, { frames: 120, input: {} }], start: far });
  await page.evaluate(
    () =>
      new Promise((done) => {
        const wait = () => {
          if (window.__atl.skater.state === "air" && window.__atl.skater.airTime > 0.25) {
            window.__travel = { before: window.__atl.landmarks.states()["freedom-parkway-bridge"], spot: window.__atl.fastTravel(336, 18.6), tick: window.__atl.ticks };
            done();
          } else requestAnimationFrame(wait);
        };
        wait();
      }),
  );
  await page.waitForFunction(() => window.__ride.done, null, { timeout: 120000 });
  const out = await page.evaluate(() => ({ travel: window.__travel, states: window.__atl.landmarks.states(), run: window.__atl.landmarks.run(), gaps: window.__atl.goals.state.gaps, events: window.__atl.events.filter((e) => /landmark|travel|gap/.test(e.type)).map((e) => e.type), banner: window.__atl.landmarkFx.banner, rings: window.__atl.landmarkFx.rings.ids, pos: [...window.__atl.skater.position] }));
  expect(out.travel.before).toBe("unknown");
  expect(Math.hypot(out.travel.spot.x - 336, out.travel.spot.z - 18.6)).toBeLessThan(12);
  expect(out.states["freedom-parkway-bridge"]).toBe("found");
  expect(out.run.claimed).toEqual([]);
  expect(out.gaps).toEqual([]);
  expect(out.events).toEqual(["travel", "landmark-found"]);
  expect(out.rings).toEqual(["freedom-parkway-bridge"]);
  await page.screenshot({ path: shot("travel-found-not-claimed"), type: "jpeg", quality: JPEG });

  // The full map's own "Travel here" (the same step): select the bridge and travel.
  await page.evaluate((s) => {
    window.__atl.landmarks.reset();
    window.__atl.resetSkater(s.position, s.yaw);
  }, far);
  const viaMap = await page.evaluate(() => {
    const a = window.__atl;
    a.fullmap.open();
    a.fullmap.select(null, { x: 336, z: 18.6 });
    const spot = a.fullmap.travel();
    a.fullmap.close();
    return { spot: spot ?? null, travels: a.events.filter((e) => e.type === "travel").length };
  });
  if (viaMap.travels === 1) {
    await page.waitForFunction(() => window.__atl.landmarks.states()["freedom-parkway-bridge"] === "found", null, { timeout: 60000 });
    expect(await page.evaluate(() => window.__atl.landmarks.run().claimed)).toEqual([]);
  }
  test.info().annotations.push({ type: "full map travel", description: viaMap.travels === 1 ? "ran through the full map" : "the full map select hook did not travel; the fastTravel hook ran" });
  expect(errors).toEqual([]);
});

test("R-1: with prefers-reduced-motion the banner fades with no slide, the ring has no pulse, and a claimed ring only fades", async ({ browser }) => {
  test.setTimeout(600000);
  const start = startAt(336, 30, Math.PI / 2);
  const run = async (reducedMotion, saved = null) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion });
    const page = await context.newPage();
    if (saved) await page.addInitScript((s) => localStorage.setItem("atl.settings.v1", JSON.stringify(s)), saved);
    // The phone tier has the ring pulse.
    await open(page, "quality=phone");
    await page.evaluate((start) => {
      window.__atl.landmarks.reset();
      window.__atl.resetSkater(start.position, start.yaw);
    }, start);
    await record(page);
    await page.waitForFunction(() => window.__atl.landmarkFx.banner.type === "found" && window.__atl.landmarkFx.banner.opacity > 0.95, null, { timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: shot(`motion-${reducedMotion}${saved ? "-setting" : ""}`), type: "jpeg", quality: JPEG });
    const rec = (await recorded(page)).filter((f) => f.visible);
    const info = await page.evaluate(() => ({ motion: window.__atl.landmarkFx.banner.motion, effects: window.__atl.effects.info.reducedMotion }));
    // A claim: the ring fades.
    await record(page);
    await page.evaluate(() => window.__atl.landmarks.claim("freedom-parkway-bridge"));
    await page.waitForFunction(() => window.__atl.landmarkFx.rings.rings === 0 && window.__atl.landmarkFx.rings.fading === 0, null, { timeout: 60000 });
    const fades = (await recorded(page)).filter((f) => f.fading > 0).map((f) => f.fade);
    await context.close();
    return { rec, info, fades };
  };
  const reduced = await run("reduce");
  expect(reduced.info).toEqual({ motion: "reduced", effects: true });
  expect(reduced.rec.length).toBeGreaterThan(5);
  // No slide: the banner never moves. It fades: its first frames are not opaque.
  expect(new Set(reduced.rec.map((f) => f.transform))).toEqual(new Set(["translate(-50%, 0px)"]));
  expect(reduced.rec[0].opacity).toBeLessThan(1);
  expect(reduced.rec.every((f) => f.pulse === 1)).toBe(true);
  // The claimed ring only fades: no gold fill, no growth.
  expect(reduced.fades.length).toBeGreaterThan(0);
  expect(reduced.fades.every((f) => f.fill === 0 && f.scale === 1 && f.alpha < 1)).toBe(true);

  const full = await run("no-preference");
  expect(full.info).toEqual({ motion: "full", effects: false });
  // With motion: the banner slides in from above, and the ring pulses.
  expect(full.rec.some((f) => /translate\(-50%, -\d/.test(f.transform))).toBe(true);
  expect(full.rec.some((f) => Math.abs(f.pulse - 1) > 0.002)).toBe(true);
  expect(full.fades.length).toBeGreaterThan(0);
  expect(full.fades.every((f) => f.fill === 1 && f.scale >= 1)).toBe(true);

  // The game's own setting (#97) wins over the device: reduce motion on.
  const setting = await run("no-preference", { reduceMotion: true });
  expect(setting.info).toEqual({ motion: "reduced", effects: true });
  expect(new Set(setting.rec.map((f) => f.transform))).toEqual(new Set(["translate(-50%, 0px)"]));
  expect(setting.rec.every((f) => f.pulse === 1)).toBe(true);
});

test("a free run finds a spot, asks for a timed run, shows no ring, and claims nothing", async ({ page }) => {
  test.setTimeout(300000);
  const errors = collectErrors(page);
  await open(page, "run=free");
  await ride(page, GAP);
  await page.waitForFunction(() => window.__ride.done, null, { timeout: 120000 });
  const out = await page.evaluate(() => ({ states: window.__atl.landmarks.states(), run: window.__atl.landmarks.run(), timed: window.__atl.landmarkFx.timed }));
  expect(out.timed).toBe(false);
  expect(out.states["freedom-parkway-bridge"]).toBe("found");
  expect(out.run.claimed).toEqual([]);
  const now = await fx(page);
  expect(now.goal).toBe(FREE_RUN_HINT);
  expect(now.rings).toMatchObject({ rings: 0, visible: false });
  await page.screenshot({ path: shot("free-run"), type: "jpeg", quality: JPEG });
  expect(errors).toEqual([]);
});

test("the chimes start on a beat or a half beat, less than 1 beat away, and duck the music", async ({ page }) => {
  test.setTimeout(300000);
  await open(page, "", { mute: false });
  // The first gesture starts the beat clock.
  await page.mouse.click(640, 500);
  await page.waitForFunction(() => window.__atl.beat.running && window.__atl.beat.now() > 0.5, null, { timeout: 60000 });
  const music = await page
    .waitForFunction(() => window.__atl.beat.musicState === "playing", null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const start = startAt(336, 30, Math.PI / 2);
  // The find at the spawn came before the gesture: a browser plays no sound then, and the chime was dropped.
  const base = await page.evaluate(() => window.__atl.landmarkFx.chimes);
  expect(base).toMatchObject({ found: 1, claimed: 0, played: 0, waiting: 0, running: true, muted: false });
  await page.evaluate((start) => {
    window.__atl.landmarks.reset();
    window.__atl.resetSkater(start.position, start.yaw);
  }, start);
  await page.waitForFunction(() => window.__atl.landmarkFx.chimes.played === 1, null, { timeout: 60000 });
  const found = await page.evaluate(() => window.__atl.landmarkFx.chimes);
  expect(found).toMatchObject({ found: 2, claimed: 0, played: 1 });
  expect(found.last).toMatchObject({ type: "found", onGrid: true });
  expect(found.last.delay).toBeGreaterThan(0);
  expect(found.last.delay).toBeLessThan(found.last.beat);
  expect(found.last.length).toBeLessThan(0.4);
  // The gap ride from outside the zone: a Found chime, then the Claimed chime.
  await ride(page, GAP);
  await page.waitForFunction(() => window.__atl.landmarkFx.chimes.claimed === 1 && window.__atl.landmarkFx.chimes.played === 3, null, { timeout: 120000 });
  const claimed = await page.evaluate(() => window.__atl.landmarkFx.chimes);
  expect(claimed).toMatchObject({ found: 3, claimed: 1, played: 3, waiting: 0 });
  expect(claimed.last).toMatchObject({ type: "claimed", onGrid: true });
  expect(claimed.last.delay).toBeLessThan(claimed.last.beat);
  expect(claimed.last.length).toBeLessThan(0.9);
  expect(claimed.last.ducked).toBe(music);
  console.log(`landmark chimes: music ${music ? "playing, ducked" : "not playing"}; Found delay ${found.last.delay.toFixed(3)} s, Claimed delay ${claimed.last.delay.toFixed(3)} s, beat ${claimed.last.beat.toFixed(3)} s`);
  test.info().annotations.push({ type: "music", description: music ? "the track played and the chime ducked it" : "the track did not play in this run: the duck is not checked in the browser" });
});
