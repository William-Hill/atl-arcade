import { expect, test } from "@playwright/test";

// The window rooms keep their look when the camera turns. Before the fix the
// room hash used the view-space normal, so a small camera turn gave the rooms
// new colors, lights, and blinds, and the windows flickered.
//
// The test turns the fixed camera in place (a pure rotation) by 0.9 degrees.
// For a pure rotation every pixel of the second frame sees the same world
// ray as one pixel of the first frame, with no parallax. Thus the two frames
// must match after the pixels are mapped from one frame to the other.
const EYE = [215, 27, -20];
const LOOK_A = [175, 26, -50];
const LOOK_B = [175.6, 26, -50.6];

async function frameAt(page, look) {
  await page.evaluate(([eye, at]) => window.__atl.setFixedCamera(...eye, ...at), [EYE, look]);
  const start = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((n) => window.__atl.frames > n + 4, start, { timeout: 30000 });
  return (await page.locator("#stage").screenshot()).toString("base64");
}

test("the window rooms do not change when the camera turns", async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/?level=beltline-eastside&view=fixed&quality=high&mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
  await page.addStyleTag({ content: "body > :not(#stage) { display: none !important; }" });

  const a = await frameAt(page, LOOK_A);
  const b = await frameAt(page, LOOK_B);
  await page.screenshot({ path: "e2e/__screenshots__/window-rooms.png" });

  const result = await page.evaluate(
    async ({ a, b, eye, lookA, lookB }) => {
      const load = async (s) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext("2d");
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height);
      };
      const A = await load(a);
      const B = await load(b);
      const W = A.width;
      const H = A.height;
      const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
      const unit = (p) => {
        const l = Math.hypot(...p);
        return [p[0] / l, p[1] / l, p[2] / l];
      };
      const basis = (look) => {
        const f = unit(sub(look, eye));
        const r = unit(cross(f, [0, 1, 0]));
        return { f, r, u: cross(r, f) };
      };
      const ty = Math.tan(((window.__atl.fov ?? 60) * Math.PI) / 360);
      const tx = ty * (W / H);
      const ka = basis(lookA);
      const kb = basis(lookB);
      // Only the lower-left part of the frame: the green building with windows.
      let compared = 0;
      let changed = 0;
      for (let y = Math.floor(H * 0.55); y < Math.floor(H * 0.95); y += 2) {
        for (let x = Math.floor(W * 0.02); x < Math.floor(W * 0.6); x += 2) {
          const nx = ((x + 0.5) / W) * 2 - 1;
          const ny = 1 - ((y + 0.5) / H) * 2;
          const d = [0, 1, 2].map((i) => kb.f[i] + kb.r[i] * nx * tx + kb.u[i] * ny * ty);
          const fa = dot(d, ka.f);
          const ax = Math.round(((dot(d, ka.r) / fa / tx + 1) / 2) * W - 0.5);
          const ay = Math.round(((1 - dot(d, ka.u) / fa / ty) / 2) * H - 0.5);
          if (ax < 1 || ay < 1 || ax >= W - 1 || ay >= H - 1) continue;
          // The nearest of the 3x3 pixels around the mapped point, so one
          // pixel of rounding does not count as a change.
          const ib = (y * W + x) * 4;
          let best = Infinity;
          for (let oy = -1; oy <= 1; oy += 1) {
            for (let ox = -1; ox <= 1; ox += 1) {
              const ia = ((ay + oy) * W + ax + ox) * 4;
              const e = Math.max(Math.abs(A.data[ia] - B.data[ib]), Math.abs(A.data[ia + 1] - B.data[ib + 1]), Math.abs(A.data[ia + 2] - B.data[ib + 2]));
              best = Math.min(best, e);
            }
          }
          compared += 1;
          if (best > 48) changed += 1;
        }
      }
      return { W, H, compared, changed, ratio: changed / compared };
    },
    { a, b, eye: EYE, lookA: LOOK_A, lookB: LOOK_B },
  );

  console.log(`window rooms: ${result.changed} of ${result.compared} pixels changed (${(result.ratio * 100).toFixed(2)}%)`);
  expect(result.compared).toBeGreaterThan(10000);
  expect(result.ratio).toBeLessThan(0.005);
  expect(errors, `page errors: ${errors.join(" | ")}`).toEqual([]);
});
