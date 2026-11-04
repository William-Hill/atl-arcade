import { chromium } from "@playwright/test";
const views = [
  ["krog-street-market", [-20, 18, 760, -72, 4, 850], ""],
  ["overview", [900, 900, 1100, 0, 0, 0], "fog=0"],
  ["forth-hotel", [90, 30, -300, -44, 28, -435], ""],
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERR:", m.text()); });
for (const look of ["toon", "pbr"]) {
  for (const [name, cam, extra] of views) {
    const q = `?level=beltline-eastside&mute=1&quality=high&view=fixed&skater=capsule&cam=${cam.join(",")}&look=${look}${extra ? "&" + extra : ""}`;
    await page.goto(`http://localhost:5199/${q}`);
    await page.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 120000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `/tmp/lookhi-${look}-${name}.png` });
    console.log("shot", look, name);
  }
}
await browser.close();
