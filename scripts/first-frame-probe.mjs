// Prints the atl: marks up to the first frame, and where the main thread was
// busy (long tasks), for one tier and look (#190). Uses a built dist/.
//   node scripts/first-frame-probe.mjs --quality high --look pbr [--extra "&carglb=0"] [--repeat 2]
import { chromium } from "playwright";
import { preview } from "vite";

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const quality = arg("quality", "high");
const look = arg("look", "pbr");
const extra = arg("extra", "");
const repeat = Number(arg("repeat", "1"));
const server = await preview({ preview: { port: 4179, strictPort: false }, logLevel: "silent" });
const base = server.resolvedUrls.local[0].replace(/\/$/, "");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
for (let n = 0; n < repeat; n += 1) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__long = [];
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push([Math.round(e.startTime), Math.round(e.duration)]))).observe({ type: "longtask", buffered: true });
  });
  await page.goto(`${base}/?level=beltline-eastside&quality=${quality}&look=${look}&mute=1&npcseed=1&governor=0&run=free${extra}`);
  await page.waitForFunction(() => performance.getEntriesByName("atl:first-frame").length > 0, null, { timeout: 120000, polling: 100 });
  const out = await page.evaluate(() => ({
    marks: performance.getEntriesByType("mark").filter((m) => m.name.startsWith("atl:")).map((m) => [m.name, Math.round(m.startTime)]),
    long: window.__long,
  }));
  console.log(`${quality}/${look}${extra} run ${n + 1}`);
  console.log("  marks:", out.marks.map(([k, v]) => `${k.slice(4)} ${v}`).join(", "));
  console.log("  long tasks (start+ms):", out.long.filter(([, d]) => d >= 150).map(([s, d]) => `${s}+${d}`).join(" "));
  await ctx.close();
}
await browser.close();
await new Promise((r) => server.httpServer.close(r));
