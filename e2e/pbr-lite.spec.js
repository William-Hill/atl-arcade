import { expect, test, devices } from "@playwright/test";

// Pbr lite (#246): the pbr look on the phone tier, the governor step from
// pbr lite down to the toon look, and the frame-time readout (?fps=1).
// Headless Chromium renders with SwiftShader, which auto-selects the low
// tier, so these tests ask for the tier with ?quality.

const { defaultBrowserType, ...iphone } = devices["iPhone 15"]; // eslint-disable-line no-unused-vars

// The same cameras as scripts/phone-look-lib.mjs PHONE_CAMS.
const CAMS = {
  spawn: "312,2,-175,334,3,-80",
  krog: "-150,2,780,-70,5,850",
};

function collectErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  return errors;
}

async function settled(page, query) {
  await page.goto(`/?level=beltline-eastside&mute=1&npcseed=1&${query}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 2, null, { timeout: 240000 });
  // The late loads: the prop batch (trees), the murals, the ground maps.
  await page.waitForFunction(() => window.__atl.level.props?.loaded || window.__atl.level.props?.error, null, { timeout: 240000 });
  await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
  const frames = await page.evaluate(() => window.__atl.frames);
  await page.waitForFunction((f) => window.__atl.frames >= f + 3, frames, { timeout: 240000 });
}

test.describe("pbr lite", () => {
  test.use(iphone);
  test.setTimeout(900000);

  for (const [name, cam] of Object.entries(CAMS)) {
    test(`toon, full pbr and pbr lite at the ${name} camera`, async ({ page }) => {
      const errors = collectErrors(page);
      const fixed = `view=fixed&cam=${cam}&wind=0&time=14&weather=clear&governor=0`;

      await settled(page, `quality=phone&look=toon&${fixed}`);
      expect(await page.evaluate(() => window.__atl.render)).toMatchObject({ look: "toon", lite: false });
      await page.screenshot({ path: `e2e/__screenshots__/pbr-lite-${name}-toon-phone.jpg`, type: "jpeg", quality: 80 });

      await settled(page, `quality=high&look=pbr&${fixed}`);
      const full = await page.evaluate(() => ({ render: window.__atl.render, lite: window.__atl.pbrLite }));
      // The high tier's pbr look is not pbr lite.
      expect(full.render).toMatchObject({ quality: "high", look: "pbr", lite: false, post: "full" });
      expect(full.lite).toBe(null);
      await page.screenshot({ path: `e2e/__screenshots__/pbr-lite-${name}-pbr-high.jpg`, type: "jpeg", quality: 80 });

      await settled(page, `quality=phone&look=pbr&${fixed}`);
      const lite = await page.evaluate(() => {
        const a = window.__atl;
        const mural = a.textureMemory.top.concat([]).find((t) => /mural/.test(t.name));
        return { render: a.render, lite: a.pbrLite, grade: Boolean(a.post?.grade), ink: Boolean(a.post?.ink), env: Boolean(a.scene.environment), trees: a.trees, mural, kinds: a.level.props.kinds };
      });
      expect(lite.render).toMatchObject({ quality: "phone", look: "pbr", lite: true, post: "lite", pixelRatio: 1.5 });
      expect(lite.lite).toMatchObject({ leafCards: 6, muralSize: 1024 });
      // What makes it read as pbr stays: the grade pass (no toon ink), the sky light.
      expect(lite.grade).toBe(true);
      expect(lite.ink).toBe(false);
      expect(lite.env).toBe(true);
      // The cuts: no Blender trees (so no impostor bake), the baked leaf cut
      // on the thin card shell, and the 1024 px mural atlas.
      expect(lite.trees.impostorKinds).toBe(0);
      expect(lite.trees.leafCut).toBe("baked");
      if (lite.mural) expect(lite.mural.width).toBeLessThanOrEqual(1024);
      await page.screenshot({ path: `e2e/__screenshots__/pbr-lite-${name}-pbr-lite-phone.jpg`, type: "jpeg", quality: 80 });
      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });
  }

  test("the governor steps from pbr lite down to toon and tells the player once", async ({ page }) => {
    const errors = collectErrors(page);
    // A 1 ms budget: every frame is over it, and no pixel ratio can reach
    // it, so the governor must go to the last rung, the toon look.
    // ?noticems: the line stays 8 s in the game; a screenshot takes longer than
    // that with the software GPU, so the test keeps the line for 40 s.
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&look=pbr&govbudget=1&noticems=40000");
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    const before = await page.evaluate(() => window.__atl.render);
    expect(before).toMatchObject({ look: "pbr", lite: true, rung: 0 });
    expect(before.ladder.at(-1)).toMatchObject({ look: "toon" });
    expect(before.ladder.slice(0, -1).every((r) => r.look === "pbr" && r.post === "lite")).toBe(true);

    // The step is a reload into the toon look.
    await page.waitForURL(/look=toon/, { timeout: 300000 });
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 240000 });
    const after = await page.evaluate(() => window.__atl.render);
    expect(after).toMatchObject({ quality: "phone", look: "toon", lite: false });
    // One short, plain HUD line.
    const notice = page.locator("#hud-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText("Switched to the toon look to keep the game smooth.");
    await page.screenshot({ path: "e2e/__screenshots__/pbr-lite-step-down-notice.jpg", type: "jpeg", quality: 80 });
    // The line goes away by itself.
    await expect(notice).toBeHidden({ timeout: 60000 });
    // The flag is gone from the address, so a refresh does not tell it again.
    expect(new URL(page.url()).searchParams.has("lookdown")).toBe(false);
    expect(new URL(page.url()).searchParams.get("look")).toBe("toon");
    await page.reload();
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 240000 });
    await expect(page.locator("#hud-notice")).toBeHidden();
    expect(await page.evaluate(() => window.__atl.look)).toBe("toon");
    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("a saved pbr choice goes to toon on the step, so the next visit starts in toon", async ({ page }) => {
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&governor=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    await page.evaluate(() => localStorage.setItem("atl.settings.v1", JSON.stringify({ look: "pbr" })));
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&govbudget=1");
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    expect(await page.evaluate(() => window.__atl.render)).toMatchObject({ look: "pbr", lite: true });
    await page.waitForURL(/lookdown=1/, { timeout: 300000 });
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    expect(await page.evaluate(() => window.__atl.look)).toBe("toon");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("atl.settings.v1")).look)).toBe("toon");
    await expect(page.locator("#hud-notice")).toBeVisible();
    // A later visit with no flag: toon, and no line.
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&governor=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 240000 });
    expect(await page.evaluate(() => window.__atl.look)).toBe("toon");
    await expect(page.locator("#hud-notice")).toBeHidden();
  });

  test("pbr lite stays when the frames are inside the budget", async ({ page }) => {
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&look=pbr&govbudget=100000");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 0, null, { timeout: 240000 });
    const f = await page.evaluate(() => window.__atl.frames);
    await page.waitForFunction((n) => window.__atl.frames >= n + 20, f, { timeout: 300000 });
    expect(await page.evaluate(() => window.__atl.render)).toMatchObject({ look: "pbr", lite: true, rung: 0, pixelRatio: 1.5, lookDown: null });
    expect(page.url()).toContain("look=pbr");
  });

  test("?fps=1 shows the median frame time on the screen", async ({ page }) => {
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&look=toon&fps=1&governor=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 20, null, { timeout: 240000 });
    const readout = page.locator("#fps-readout");
    await expect(readout).toBeVisible();
    await expect(readout).toContainText(/median \d+\.\d ms · \d+ fps\s+p95 \d+\.\d ms · \d+ s of 120/, { timeout: 30000 });
    await expect(readout).toContainText("toon · phone · x1.5");
    const stats = await page.evaluate(() => window.__atl.frameReadout);
    expect(stats.medianMs).toBeGreaterThan(0);
    await page.screenshot({ path: "e2e/__screenshots__/pbr-lite-fps-readout.jpg", type: "jpeg", quality: 80 });
    // Without the flag there is no readout.
    await page.goto("/?level=beltline-eastside&mute=1&quality=phone&look=toon&governor=0");
    await page.waitForFunction(() => window.__atl && window.__atl.ready, null, { timeout: 240000 });
    await expect(page.locator("#fps-readout")).toHaveCount(0);
  });
});
