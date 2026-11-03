import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

// #90: photo mode. P or the PHOTO button opens it, the simulation stops, a
// free camera moves, the tilt-shift blur shows on the high tier only, and
// the player saves a PNG with no player data in the file name.

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function open(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
  if (!query.includes("props=0")) {
    await page.waitForFunction(() => window.__atl.level.props && (window.__atl.level.props.loaded || window.__atl.level.props.error), null, { timeout: 90000 });
  }
}

async function waitFrames(page, n) {
  const start = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames >= f, start + n, { timeout: 60000 });
}

// Mean absolute luminance step between neighbor pixels in two strips of
// the frame: UV height 0.5 to 0.6 (the far buildings, blurred in photo mode
// with the band low) and the band center (sharp). It reads the WebGL canvas in a frame callback after the game
// draws, while the drawing buffer still holds the frame.
function sharpness(page, center) {
  return page.evaluate(
    (c) =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById("stage");
          // Full resolution: a smaller copy smooths the frame by itself.
          const w = src.width;
          const h = src.height;
          const cv = document.createElement("canvas");
          cv.width = w;
          cv.height = h;
          const ctx = cv.getContext("2d");
          ctx.drawImage(src, 0, 0, w, h);
          const px = ctx.getImageData(0, 0, w, h).data;
          const lum = (x, y) => {
            const i = (y * w + x) * 4;
            return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          };
          const strip = (y0, y1) => {
            let sum = 0;
            let n = 0;
            for (let y = y0; y < y1; y += 1) {
              for (let x = 0; x < w - 1; x += 1) {
                sum += Math.abs(lum(x + 1, y) - lum(x, y));
                n += 1;
              }
            }
            return sum / n;
          };
          // UV y is 0 at the bottom; image rows start at the top.
          const bandRow = Math.round((1 - c) * h);
          resolve({ far: strip(Math.round(h * 0.4), Math.round(h * 0.5)), band: strip(bandRow - 4, bandRow + 4) });
        });
      }),
    center,
  );
}

test("photo mode on the high tier: stops the sim, flies, blurs, and saves a PNG", async ({ page }, testInfo) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  // A fixed camera high over Fourth Ward Park, as in e2e/beltline.spec.js.
  await open(page, "quality=high&landmarks=0&view=fixed&cam=380,40,120,200,0,-150");
  expect(await page.evaluate(() => window.__atl.quality)).toBe("high");

  // Normal play: the blur pass is off.
  const play = await page.evaluate(() => ({ open: window.__atl.photo.isOpen, blur: window.__atl.photo.blur, camera: window.__atl.cameraPosition }));
  expect(play.open).toBe(false);
  expect(play.blur.enabled).toBe(false);
  await expect(page.locator("#photo-panel")).toBeHidden();

  // Let the skater move a little, then open photo mode with the key.
  await page.keyboard.down("KeyW");
  await waitFrames(page, 10);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("KeyP");
  await waitFrames(page, 2);
  const opened = await page.evaluate(() => ({ open: window.__atl.photo.isOpen, blur: window.__atl.photo.blur, ticks: window.__atl.ticks, skater: [...window.__atl.skater.position] }));
  expect(opened.open).toBe(true);
  expect(opened.blur.enabled).toBe(true);
  await expect(page.locator("#photo-panel")).toBeVisible();
  await expect(page.locator("#hud")).toBeHidden();

  // The simulation stops while photo mode is open.
  await waitFrames(page, 10);
  const still = await page.evaluate(() => ({ ticks: window.__atl.ticks, skater: [...window.__atl.skater.position] }));
  expect(still.ticks).toBe(opened.ticks);
  expect(still.skater).toEqual(opened.skater);

  // The band and the strength move with the sliders and the keys.
  await page.locator("#photo-band").fill("23");
  await page.keyboard.press("BracketRight");
  let st = await page.evaluate(() => ({ state: window.__atl.photo.state, blur: window.__atl.photo.blur }));
  expect(st.state.center).toBeCloseTo(0.25, 5);
  expect(st.blur.center).toBeCloseTo(0.25, 5);
  await page.locator("#photo-strength").fill("0");
  await waitFrames(page, 3);
  const sharp = await sharpness(page, 0.25);
  await page.locator("#photo-strength").fill("90");
  await page.keyboard.press("Equal");
  st = await page.evaluate(() => ({ state: window.__atl.photo.state, blur: window.__atl.photo.blur }));
  expect(st.state.strength).toBeCloseTo(0.95, 5);
  expect(st.blur.strength).toBeCloseTo(0.95, 5);
  await waitFrames(page, 3);
  const blurred = await sharpness(page, 0.25);
  await testInfo.attach("sharpness", { body: JSON.stringify({ sharp, blurred }), contentType: "application/json" });
  // The blur smooths the far buildings, and the band stays sharp.
  expect(blurred.far).toBeLessThan(sharp.far * 0.75);
  expect(blurred.band).toBeGreaterThan(sharp.band * 0.8);
  await page.screenshot({ path: "e2e/__screenshots__/photo-mode-high.png" });

  // Save a PNG. The file name holds the date and time only.
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#photo-save").click()]);
  expect(download.suggestedFilename()).toMatch(/^skate-atl-\d{8}-\d{6}\.png$/);
  const file = "e2e/__screenshots__/photo-mode-saved.png";
  await download.saveAs(file);
  const bytes = readFileSync(file);
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(bytes.length).toBeGreaterThan(20000);
  await testInfo.attach("saved photo", { path: file, contentType: "image/png" });

  // The free camera flies back and up (S and E) and turns with a drag.
  const cam0 = await page.evaluate(() => window.__atl.cameraPosition);
  await page.keyboard.down("KeyS");
  await page.keyboard.down("KeyE");
  await waitFrames(page, 8);
  await page.keyboard.up("KeyS");
  await page.keyboard.up("KeyE");
  await waitFrames(page, 2);
  const cam1 = await page.evaluate(() => window.__atl.cameraPosition);
  expect(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1], cam1[2] - cam0[2])).toBeGreaterThan(0.5);
  expect(cam1[1]).toBeGreaterThan(cam0[1]);
  const yaw0 = await page.evaluate(() => window.__atl.photo.state.camera.yaw);
  const box = await page.locator("#stage").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await waitFrames(page, 3);
  expect(await page.evaluate(() => window.__atl.photo.state.camera.yaw)).not.toBeCloseTo(yaw0, 3);

  // Close with the button: the blur goes off and the simulation runs again.
  await page.locator("#photo-close").click();
  await waitFrames(page, 10);
  const closed = await page.evaluate(() => ({ open: window.__atl.photo.isOpen, blur: window.__atl.photo.blur, ticks: window.__atl.ticks }));
  expect(closed.open).toBe(false);
  expect(closed.blur.enabled).toBe(false);
  expect(closed.ticks).toBeGreaterThan(opened.ticks);
  await expect(page.locator("#hud")).toBeVisible();
  // The fixed camera gets its old place back.
  const back = await page.evaluate(() => window.__atl.cameraPosition);
  for (let i = 0; i < 3; i += 1) expect(back[i]).toBeCloseTo(play.camera[i], 5);

  // P opens it again and Escape closes it.
  await page.keyboard.press("KeyP");
  await waitFrames(page, 2);
  expect(await page.evaluate(() => window.__atl.photo.isOpen)).toBe(true);
  await page.keyboard.press("Escape");
  await waitFrames(page, 2);
  expect(await page.evaluate(() => window.__atl.photo.blur.enabled)).toBe(false);
  expect(errors).toEqual([]);
});

test("photo mode on the low tier: the button opens it, with no blur", async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  await open(page, "quality=low&landmarks=0&props=0");
  expect(await page.evaluate(() => window.__atl.quality)).toBe("low");

  await waitFrames(page, 20);
  const followCam = await page.evaluate(() => window.__atl.cameraPosition);
  await page.locator("#photo-toggle").click();
  await waitFrames(page, 2);
  const opened = await page.evaluate(() => ({ open: window.__atl.photo.isOpen, blur: window.__atl.photo.blur, ticks: window.__atl.ticks }));
  expect(opened.open).toBe(true);
  expect(opened.blur).toBe(null);
  await expect(page.locator("#photo-band")).toBeDisabled();
  await expect(page.locator("#photo-strength")).toBeDisabled();
  await waitFrames(page, 10);
  expect(await page.evaluate(() => window.__atl.ticks)).toBe(opened.ticks);
  await page.screenshot({ path: "e2e/__screenshots__/photo-mode-low.png" });

  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#photo-save").click()]);
  expect(download.suggestedFilename()).toMatch(/^skate-atl-\d{8}-\d{6}\.png$/);

  // Fly away, then close: the follow camera comes back to the skater.
  await page.keyboard.down("KeyW");
  await waitFrames(page, 10);
  await page.keyboard.up("KeyW");
  const flown = await page.evaluate(() => window.__atl.cameraPosition);
  expect(Math.hypot(flown[0] - followCam[0], flown[2] - followCam[2])).toBeGreaterThan(1);
  await page.locator("#photo-toggle").click();
  await waitFrames(page, 10);
  expect(await page.evaluate(() => window.__atl.photo.isOpen)).toBe(false);
  const returned = await page.evaluate(() => window.__atl.cameraPosition);
  expect(Math.hypot(returned[0] - followCam[0], returned[1] - followCam[1], returned[2] - followCam[2])).toBeLessThan(1.5);
  expect(await page.evaluate(() => window.__atl.ticks)).toBeGreaterThan(opened.ticks);
  expect(errors).toEqual([]);
});

test("photo mode on a touch screen: the button clears the touch buttons", async ({ page }) => {
  test.setTimeout(180000);
  const errors = collectErrors(page);
  await open(page, "quality=low&landmarks=0&props=0&touch=1");
  const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const toggle = await page.locator("#photo-toggle").boundingBox();
  for (const sel of ["#attribution", ".touch-jump", ".touch-grind", ".touch-style1", ".touch-style2"]) {
    expect(overlap(toggle, await page.locator(sel).boundingBox())).toBe(false);
  }
  await page.locator("#photo-toggle").click();
  await waitFrames(page, 2);
  await expect(page.locator("#touch-controls")).toBeHidden();
  const panel = await page.locator("#photo-panel").boundingBox();
  expect(overlap(toggle, panel)).toBe(false);
  await page.screenshot({ path: "e2e/__screenshots__/photo-mode-touch.png" });
  await page.locator("#photo-toggle").click();
  await waitFrames(page, 2);
  await expect(page.locator("#touch-controls")).toBeVisible();
  expect(errors).toEqual([]);
});
