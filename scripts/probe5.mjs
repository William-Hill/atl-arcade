import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:5203/?level=beltline-eastside&mute=1&quality=high&look=pbr&view=fixed&skater=capsule&cam=-20,18,760,-72,4,850&date=06-21&time=13.5&weather=clear");
await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 4, null, { timeout: 120000 });
const info = await page.evaluate(() => {
  const m = window.__atl.scene?.getObjectByName("shop-names");
  const cam = window.__atl.camera?.position;
  return { names: m ? { verts: m.geometry.attributes.position.count, quads: m.geometry.index.count / 6 } : null, cam };
});
console.log(JSON.stringify(info));
await browser.close();
