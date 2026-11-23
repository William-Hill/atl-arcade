import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
for (const [name, q] of [
  ["alb-day", "look=pbr&date=06-21&time=13.5&weather=clear"],
  ["alb-morn", "look=pbr&date=06-21&time=9.5&weather=clear"],
  ["alb-toon", "look=toon&date=06-21&time=13.5&weather=clear"],
]) {
  await page.goto(`http://localhost:5203/?level=beltline-eastside&mute=1&quality=high&view=fixed&skater=capsule&cam=-20,18,760,-72,4,850&${q}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/${name}.png` });
  console.log(name, "done");
}
await browser.close();
