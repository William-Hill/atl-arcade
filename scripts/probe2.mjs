import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
for (const [name, q] of [["pbr-day", "look=pbr&date=06-21&time=13.5&weather=clear"], ["toon-day", "look=toon&date=06-21&time=13.5&weather=clear"], ["pbr-night", "look=pbr&date=01-15&time=22&weather=rain"]]) {
  await page.goto(`http://localhost:5203/?level=beltline-eastside&mute=1&quality=high&view=fixed&skater=capsule&cam=-20,18,760,-72,4,850&${q}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/grade-${name}.png` });
  console.log(name, "done");
}
await browser.close();
