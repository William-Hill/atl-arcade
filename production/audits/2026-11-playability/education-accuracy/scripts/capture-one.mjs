import { chromium } from "@playwright/test";
const [cam, out] = process.argv.slice(2);
const b = await chromium.launch({ headless: true, args: ["--no-sandbox", "--use-angle=metal"] });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(`http://localhost:5183/?level=beltline-eastside&mute=1&view=fixed&quality=high&cam=${cam}`);
await p.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 5, null, { timeout: 90000 });
await p.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 90000 });
await p.waitForTimeout(2000);
// The first load in a fresh browser can show a black canvas; reload once and wait for more frames.
await p.reload();
await p.waitForFunction(() => window.__atl && window.__atl.ready && window.__atl.frames > 60, null, { timeout: 120000 });
await p.waitForFunction(() => window.__atl.level.landmarks && window.__atl.level.landmarks.towers >= 2, null, { timeout: 90000 });
await p.waitForTimeout(3000);
await p.screenshot({ path: out, type: "jpeg", quality: 78 });
console.log(JSON.stringify({ errs, info: await p.evaluate(() => window.__atl.rendererInfo ?? null) }));
await b.close();
