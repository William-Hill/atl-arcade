import { expect, test } from "@playwright/test";

// Issue #279: a timed dither fade at the LOD switch of the props and the
// cars. The fixed camera moves across the switch distances in small steps.
// The traffic is off (traffic=0), so only the camera moves a car across a
// switch distance.
// Some instances fade, and the fade count goes back to 0 after the fade time.

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

const CAM = "-125,9.5,-706,20,16.5,-700";

async function open(page, extra = "") {
  await page.goto(`/?level=beltline-eastside&mute=1&view=fixed&cam=${CAM}&traffic=0${extra}`);
  await page.waitForFunction(() => window.__atl?.ready && window.__atl.level.props?.loaded && window.__atl.frames > 5, null, { timeout: 120000 });
}

// Moves the camera 40 m east in 1 m steps, one frame per step (no step is a
// teleport). Returns the largest fade counts seen.
async function sweep(page) {
  return page.evaluate(async () => {
    const atl = window.__atl;
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    let props = 0;
    let cars = 0;
    for (let k = 1; k <= 40; k += 1) {
      atl.setFixedCamera(-125 + k, 9.5, -706, 20 + k, 16.5, -700);
      await frame();
      props = Math.max(props, atl.level.propFade.fading);
      cars = Math.max(cars, atl.cars?.fade.fading ?? 0);
    }
    return { props, cars, propsStarted: atl.level.propFade.started, carsStarted: atl.cars?.fade.started ?? 0 };
  });
}

test("props and cars fade at the LOD switch, and the fade count goes back to 0", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page);
  const before = await page.evaluate(() => ({ props: window.__atl.level.propFade, cars: window.__atl.cars.fade, calls: window.__atl.rendererInfo.calls }));
  expect(before.props.enabled).toBe(true);
  expect(before.props.copies).toBeGreaterThan(0);
  // No fade on the first frames of the level.
  expect(before.props.started).toBe(0);
  expect(before.cars.started).toBe(0);
  const seen = await sweep(page);
  console.log(`lod-fade sweep: ${JSON.stringify(seen)}`);
  expect(seen.propsStarted).toBeGreaterThan(0);
  expect(seen.props).toBeGreaterThan(0);
  // The fade is short: few instances draw twice at one time.
  expect(seen.props).toBeLessThan(60);
  await page.waitForTimeout(800);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const after = await page.evaluate(() => ({ props: window.__atl.level.propFade, cars: window.__atl.cars.fade }));
  expect(after.props.fading).toBe(0);
  expect(after.props.copiesUsed).toBe(0);
  expect(after.cars.fading).toBe(0);
  expect(after.cars.copiesUsed).toBe(0);
  expect(errors).toEqual([]);
});

test("a fast travel makes a hard switch with no fade", async ({ page }) => {
  await open(page);
  const started = await page.evaluate(async () => {
    const atl = window.__atl;
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const s0 = atl.level.propFade.started;
    // A 300 m jump: a teleport.
    atl.setFixedCamera(175, 9.5, -706, 320, 16.5, -700);
    await frame();
    return { s0, s1: atl.level.propFade.started, fading: atl.level.propFade.fading };
  });
  expect(started.s1).toBe(started.s0);
  expect(started.fading).toBe(0);
});

test("?lodfade=0 turns the fade off", async ({ page }) => {
  const errors = collectErrors(page);
  await open(page, "&lodfade=0");
  const seen = await sweep(page);
  expect(seen).toEqual({ props: 0, cars: 0, propsStarted: 0, carsStarted: 0 });
  const info = await page.evaluate(() => window.__atl.level.propFade);
  expect(info.copies).toBe(0);
  expect(errors).toEqual([]);
});
