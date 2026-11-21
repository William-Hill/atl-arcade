import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
for (const [name, cam] of [["street", "336,26,-8"], ["down", "336,32,-8"]]) {
  await page.goto(`http://localhost:5203/?level=beltline-eastside&mute=1&quality=high&look=pbr&view=fixed&skater=capsule&cam=${cam}&date=06-21&time=13.5&weather=clear`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 120000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `/tmp/names-${name}.png` });
  console.log(name, "done");
}
await browser.close();
