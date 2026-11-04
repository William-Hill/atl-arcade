import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
for (const [name, q] of [["storm", "date=07-15&time=13&weather=storm"], ["night", "date=01-15&time=22&weather=rain"], ["dusk", "date=10-10&time=18.2&weather=clouds"]]) {
  await page.goto(`http://localhost:5203/?level=beltline-eastside&mute=1&quality=high&view=fixed&skater=capsule&cam=-20,18,760,-72,4,850&${q}`);
  await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 8, null, { timeout: 120000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `/tmp/fix2-${name}.png` });
  console.log(name, "done");
}
await browser.close();
