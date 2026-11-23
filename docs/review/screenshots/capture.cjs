const { chromium } = require("playwright");
// Content review capture (#22). Start `npx vite --port 5191`, then run
// node docs/review/screenshots/capture.cjs <out-dir> [query]
// with a query such as "&weather=clear&time=14".
const OUT = process.argv[2];
const QUERY = process.argv[3] ?? "";
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
(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:5191/?level=beltline-eastside&mute=1" + QUERY);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/00-loader.jpg`, quality: 80 });
  const loaderText = await page.evaluate(() => document.body.innerText);
  console.log("LOADER TEXT:", JSON.stringify(loaderText));
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 240000 });
  await page.waitForTimeout(4000);
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
  console.log("ERRORS:", JSON.stringify(errors));
  await browser.close();
})();
