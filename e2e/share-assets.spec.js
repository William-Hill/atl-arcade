// Issue #303: the link preview tags, the favicon set, and the load screen art.
// The game script is blocked in the art tests, so the load screen stays up for
// the screenshot (the game removes it after its first frame).
import { devices, expect, test } from "@playwright/test";

const OG_IMAGE = /^https:\/\/[^/]+\/share\/skate-atl-card-1200x630\.jpg$/;

async function holdLoader(page) {
  await page.route("**/src/main.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
}

test("the page sets the link preview tags and serves the files", async ({ page, request }) => {
  await page.goto("/?level=greybox&mute=1");
  const tags = await page.evaluate(() => {
    const get = (sel) => document.querySelector(sel)?.getAttribute("content") ?? null;
    return {
      ogTitle: get('meta[property="og:title"]'),
      ogDescription: get('meta[property="og:description"]'),
      ogImage: get('meta[property="og:image"]'),
      twitterCard: get('meta[name="twitter:card"]'),
      twitterImage: get('meta[name="twitter:image"]'),
      icons: [...document.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')].map((l) => l.getAttribute("href")),
    };
  });
  expect(tags.ogTitle).toBe("Skate ATL");
  expect(tags.ogDescription.length).toBeGreaterThan(40);
  expect(tags.ogImage).toMatch(OG_IMAGE);
  expect(tags.twitterCard).toBe("summary_large_image");
  expect(tags.twitterImage).toBe(tags.ogImage);
  expect(tags.icons).toEqual(["/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png"]);

  // The local server serves each file at the same path as the absolute URL.
  const paths = [new URL(tags.ogImage).pathname, ...tags.icons, "/brand/loader-art.svg"];
  for (const p of paths) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(200);
    expect((await res.body()).length, p).toBeGreaterThan(500);
  }
});

for (const [name, opts] of [
  ["desktop", { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 }],
  ["phone", { ...devices["Pixel 7"] }],
]) {
  test(`the load screen shows the new art (${name})`, async ({ browser }) => {
    const context = await browser.newContext(opts);
    const page = await context.newPage();
    await holdLoader(page);
    await page.goto("/?level=greybox&mute=1");
    const art = page.locator("#loader img.loader-art");
    await expect(art).toBeVisible();
    await page.waitForFunction(() => {
      const img = document.querySelector("#loader img.loader-art");
      return img && img.complete && img.naturalWidth > 0;
    });
    const box = await art.boundingBox();
    const vw = page.viewportSize().width;
    // The art fits the screen with a margin, and it is big enough to read.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(vw);
    expect(box.width).toBeGreaterThan(Math.min(300, vw * 0.7));
    await expect(page.locator("#loader [role=progressbar]")).toBeVisible();
    // Move the bar to 60 % for the picture, as src/ui/loader.js does.
    await page.evaluate(() => { document.querySelector("#loader .loader-fill").style.width = "60%"; });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/__screenshots__/loader-${name}.png` });
    await context.close();
  });
}

test("the game still removes the load screen after the first frame", async ({ page }) => {
  await page.goto("/?level=greybox&mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.frames > 0, null, { timeout: 30000 });
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 5000 });
});
