import { expect, test, devices } from "@playwright/test";

// The phone render tier and the frame-time governor (#72). Headless
// Chromium renders with SwiftShader, which auto-selects the low tier, so
// these tests ask for the phone tier with ?quality=phone.

const { defaultBrowserType, ...iphone } = devices["iPhone 15"]; // eslint-disable-line no-unused-vars

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function ready(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 60000 });
}

test.describe("phone tier", () => {
  test.use(iphone);

  test("draws the lite ink pass at a pixel ratio of 1.5 with no errors", async ({ page }) => {
    const errors = collectErrors(page);
    await ready(page, "quality=phone&governor=0");
    const r = await page.evaluate(() => window.__atl.render);
    expect(r).toMatchObject({ quality: "phone", post: "lite", pixelRatio: 1.5, rung: null });
    const info = await page.evaluate(() => window.__atl.rendererInfo);
    expect(info.calls).toBeLessThan(80);
    await page.screenshot({ path: "e2e/__screenshots__/phone-tier.png" });
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the governor steps down when the frames are over the budget", async ({ page }) => {
    const errors = collectErrors(page);
    // A 1 ms budget: every frame is over it, so the governor must step down.
    await ready(page, "quality=phone&govbudget=1");
    await expect.poll(() => page.evaluate(() => window.__atl.render.rung), { timeout: 30000 }).toBeGreaterThanOrEqual(1);
    const r = await page.evaluate(() => window.__atl.render);
    expect(r.pixelRatio).toBeLessThan(1.5);
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the governor keeps the top rung on a fast enough device", async ({ page }) => {
    await ready(page, "quality=phone&govbudget=10000");
    await page.waitForTimeout(6000);
    expect(await page.evaluate(() => window.__atl.render)).toMatchObject({ rung: 0, pixelRatio: 1.5, post: "lite" });
  });
});
