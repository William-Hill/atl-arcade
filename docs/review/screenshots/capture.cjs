const { chromium } = require("playwright");
// Content review capture (#22). Start the dev server, for example
// `npx vite --port 5402 --strictPort`, then run
// PORT=5402 node docs/review/screenshots/capture.cjs <out-dir> [query]
// The default query is empty: the first load of a player (a clear
// afternoon in Atlanta since #353). A query such as "&weather=rain&time=22"
// changes the clock or the weather. The pictures are 1280 x 720; scale
// them to 960 x 540 before you commit them.
const OUT = process.argv[2];
const QUERY = process.argv[3] ?? "";
const PORT = process.env.PORT ?? "5191";
const BASE = `http://localhost:${PORT}/?level=beltline-eastside&mute=1`;
const spots = [
  ["01-spawn", null],
  ["02-fact-neighborhoods", [335.93, 62.15]],
  ["03-fact-freedom-park", [280.69, 227.13]],
  ["04-fact-marta", [-99.25, 639.35]],
  ["05-skatepark", [272.3, -1.5]],
  ["06-ponce-city-market", [-111.5, -895.5]],
  ["07-krog-street-market", [-98.3, 890]],
  ["08-new-realm", [95.8, -455]],
  ["09-fourth-ward-park", [-130.1, -456.6]],
  ["10-north-ave-bridge", [-63.1, -708.9]],
];
const ARGS = ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"];
const ready = (page) => page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE + QUERY);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/00-loader.jpg`, quality: 80 });
  console.log("LOADER TEXT:", JSON.stringify(await page.evaluate(() => document.body.innerText)));
  await ready(page);
  await page.waitForTimeout(4000);
  // The clock and the weather of this load.
  console.log("WEATHER:", JSON.stringify(await page.evaluate(() => window.__atl.weather)));
  for (const [name, at] of spots) {
    if (at) { await page.evaluate(([x, z]) => window.__atl.fastTravel(x, z), at); await page.waitForTimeout(6000); }
    await page.screenshot({ path: `${OUT}/${name}.jpg`, quality: 80 });
    console.log(name, "ok");
  }
  console.log("HUD TEXT:", JSON.stringify(await page.evaluate(() => document.body.innerText)));
  // A moving car
  const car = await page.evaluate(async () => {
    const cars = window.__atl.cars; if (!cars) return null;
    const c = cars.list.find((c) => c.kind !== "bus") ?? cars.list[0];
    const fx = Math.cos(c.yaw), fz = -Math.sin(c.yaw);
    window.__atl.setFixedCamera(c.x - fx * 16 - fz * 4, c.y + 6, c.z - fz * 16 + fx * 4, c.x + fx * 6, c.y + 0.5, c.z + fz * 6);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { kind: c.kind, speed: c.speed, moving: cars.list.length, parked: cars.parkedList.length };
  });
  console.log("CAR:", JSON.stringify(car));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/11-traffic.jpg`, quality: 80 });

  // The story cards and the results row (#220). The spot states come from
  // the dev test hook (window.__atl.landmarks), as in e2e/story-cards.spec.js.
  await page.goto(BASE + QUERY);
  await ready(page);
  await page.waitForFunction(() => window.__atl.fullmap && window.__atl.landmarks, null, { timeout: 120000 });
  await page.evaluate(() => {
    const [x, z] = [150, 600];
    window.__atl.resetSkater([x, window.__atl.level.sample(x, z)?.height ?? 0, z], 1.5);
    window.__atl.landmarks.reset();
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.__atl.goals.replay());
  await page.waitForFunction(() => window.__atl.goals.phase === "play", null, { timeout: 10000 });
  await page.evaluate(() => {
    for (const id of ["new-realm-brewing", "historic-fourth-ward-skatepark", "ponce-city-market"]) window.__atl.landmarks.claim(id);
    window.__atl.goals.setTimeLeft(0);
  });
  await page.waitForFunction(() => window.__atl.goals.shown, null, { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#results-spots .results-spot img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/12-results-row.jpg`, quality: 80 });
  console.log("RESULTS TEXT:", JSON.stringify(await page.locator("#results").innerText()));
  await page.locator('#results-spots .results-spot[data-spot="new-realm-brewing"]').click();
  await page.waitForFunction(() => { const i = document.querySelector("#story-view .story-card-art img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/13-story-card-new-realm.jpg`, quality: 80 });
  console.log("STORY CARD TEXT:", JSON.stringify(await page.locator("#story-view").innerText()));
  await page.keyboard.press("Escape");
  await page.locator("#results-replay").click();
  await page.waitForTimeout(1000);
  await page.evaluate(() => { window.__atl.fullmap.open(); window.__atl.fullmap.openSpot("historic-fourth-ward-skatepark"); });
  await page.waitForFunction(() => { const i = document.querySelector("#fullmap .story-card-art img"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/14-story-card-skatepark.jpg`, quality: 80 });
  console.log("SKATEPARK CARD TEXT:", JSON.stringify(await page.locator("#fullmap .fullmap-card").innerText()));
  await page.evaluate(() => window.__atl.landmarks.reset());

  // Tour mode (#260): the HUD reads TOUR and names the next spot.
  await page.goto(BASE + "&run=tour" + QUERY);
  await ready(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/15-tour.jpg`, quality: 80 });
  console.log("TOUR TEXT:", JSON.stringify(await page.evaluate(() => document.body.innerText)));

  // The title screen (#301). A WebDriver browser goes to the game unless
  // ?intro=title asks for the title screen.
  await page.goto(BASE + "&intro=title" + QUERY);
  await ready(page);
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${OUT}/16-title.jpg`, quality: 80 });
  console.log("TITLE TEXT:", JSON.stringify(await page.evaluate(() => document.body.innerText)));

  console.log("ERRORS:", JSON.stringify(errors));
  await browser.close();
})();
