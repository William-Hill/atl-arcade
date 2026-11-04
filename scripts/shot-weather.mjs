import { chromium } from "@playwright/test";
const shots = [
  ["night-rain", "date=01-15&time=22&weather=rain", [-20, 18, 760, -72, 4, 850]],
  ["storm-noon", "date=07-15&time=13&weather=storm", [-20, 18, 760, -72, 4, 850]],
  ["day-clear", "date=06-21&time=13.5&weather=clear", [-20, 18, 760, -72, 4, 850]],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
for (const [name, wq, cam] of shots) {
  const q = `?level=beltline-eastside&mute=1&quality=high&view=fixed&skater=capsule&cam=${cam.join(",")}&${wq}`;
  await page.goto(`http://localhost:5201/${q}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  console.log(name, JSON.stringify(await page.evaluate(() => window.__atl.weather)));
  await page.screenshot({ path: `e2e/__screenshots__/weather-${name}.png` });
}
await browser.close();
