// Issue #23: the smoke test of a deployed build. It runs against SMOKE_URL
// (default: the production URL), see playwright.smoke.config.js.
// The deploy workflow runs it after each deploy.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SHOTS = "e2e-smoke/.output/shots";
mkdirSync(SHOTS, { recursive: true });

function tag(html, attr, name) {
  const m = html.match(new RegExp(`<meta\\s+${attr}="${name.replace(/[:.]/g, "\\$&")}"\\s+content="([^"]*)"`));
  return m ? m[1] : null;
}

test("the page and its hashed files are served with the correct headers", async ({ request }) => {
  const res = await request.get("/");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  // The HTML must revalidate, so a new deploy is seen at once.
  expect(res.headers()["cache-control"]).not.toContain("immutable");
  const html = await res.text();
  expect(html).toContain("<title>Skate ATL");

  const asset = html.match(/\/assets\/[^"]+\.js/);
  expect(asset, "a hashed script in index.html").not.toBeNull();
  const a = await request.get(asset[0]);
  expect(a.status()).toBe(200);
  expect(a.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
});

test("the Open Graph share card renders", async ({ page, request }) => {
  const html = await (await request.get("/")).text();
  const og = {
    title: tag(html, "property", "og:title"),
    description: tag(html, "property", "og:description"),
    url: tag(html, "property", "og:url"),
    image: tag(html, "property", "og:image"),
    width: tag(html, "property", "og:image:width"),
    height: tag(html, "property", "og:image:height"),
    alt: tag(html, "property", "og:image:alt"),
    twitterCard: tag(html, "name", "twitter:card"),
  };
  expect(og.title).toBe("Skate ATL");
  expect(og.description.length).toBeGreaterThan(40);
  expect(og.url).toBe("https://skate-atl.vercel.app/");
  expect(og.image).toMatch(/^https:\/\/skate-atl\.vercel\.app\/share\/skate-atl-card-1200x630\.jpg$/);
  expect([og.width, og.height]).toEqual(["1200", "630"]);
  expect(og.alt.length).toBeGreaterThan(10);
  expect(og.twitterCard).toBe("summary_large_image");

  // A link preview fetches og:image with no cookies, so it must be public.
  const img = await request.get(og.image);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/jpeg");

  // Draw the card as a chat app shows it: the image, the title, the text.
  await page.setContent(`<!doctype html><body style="margin:0;padding:24px;background:#e9ecef;font-family:sans-serif">
    <div id="card" style="width:600px;border-radius:12px;overflow:hidden;background:#fff;box-shadow:0 1px 4px #0003">
      <img id="og" src="${og.image}" alt="${og.alt}" style="display:block;width:600px;height:315px;object-fit:cover">
      <div style="padding:12px 16px"><div style="color:#667;font-size:13px">${new URL(og.url).host}</div>
      <div style="font-weight:700;font-size:17px;margin:4px 0">${og.title}</div>
      <div style="color:#333;font-size:14px">${og.description}</div></div></div></body>`);
  await page.waitForFunction(() => document.getElementById("og").complete);
  const size = await page.evaluate(() => {
    const i = document.getElementById("og");
    return [i.naturalWidth, i.naturalHeight];
  });
  expect(size).toEqual([1200, 630]);
  await page.locator("#card").screenshot({ path: `${SHOTS}/share-card.png` });
});

test("the game starts and draws frames with no page error", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("/?mute=1");
  await page.waitForFunction(() => window.__atl && window.__atl.frames > 30, null, { timeout: 90000 });
  await expect(page.locator("#loader")).toHaveCount(0, { timeout: 10000 });
  const phase = await page.evaluate(() => window.__atl.front?.phase ?? null);
  expect(["intro", "title", "play"]).toContain(phase);
  await page.screenshot({ path: `${SHOTS}/game.png` });
  expect(errors).toEqual([]);
});
