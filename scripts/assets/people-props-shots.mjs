// BEFORE / AFTER screenshots of the pedestrians and props in the real game
// renderer (pbr look), at identical cameras: BEFORE is the game as it is
// (index.html), AFTER is scripts/assets/people-props-preview.html. Logs
// window.__atl.rendererInfo per shot. Extra shots (AFTER only) with ?clip= or
// ?lod= are given as name:query, for example "people:clip=idle".
//   node scripts/assets/people-props-shots.mjs --out DIR [--only after] [--plaza x,z,yaw] [name ...]
import { writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const take = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args.splice(i, 2)[1] : d;
};
const out = take("--out", "/tmp/people-props");
const onlyTag = take("--only", null);
const plaza = take("--plaza", "311.5,-85.2,-1.403");
const [px, pz, pyaw = 0] = plaza.split(",").map(Number);
const cy = Math.cos(pyaw);
const sy = Math.sin(pyaw);
const wx = (dx, dz) => px + dx * cy + dz * sy;
const wz = (dx, dz) => pz - dx * sy + dz * cy;
// [name, cam in plaza space: eye dx, eye height, eye dz, target dx, target height, target dz, extra query]
const SHOTS = [
  ["plaza-wide", [0, 9, 22, 0, 0.5, 0]],
  ["people", [0, 2.2, 10.5, 0, 0.9, 5]],
  ["people-left", [-6, 1.8, 8.5, -6, 0.9, 5]],
  ["people-right", [6, 1.8, 8.5, 6, 0.9, 5]],
  ["street", [0, 2.0, 4.5, 0, 0.5, 0]],
  ["beltline", [0, 3.5, 3, 0, 1.0, -5]],
  ["beltline-left", [-6, 2.4, 0.5, -6, 0.8, -5]],
  ["beltline-right", [6, 3, 0.5, 6, 1.5, -5]],
  ["people-idle", [0, 2.2, 10.5, 0, 0.9, 5], "clip=idle"],
  ["people-sit", [0, 2.2, 10.5, 0, 0.9, 5], "clip=sit"],
  ["people-cheer", [0, 2.2, 10.5, 0, 0.9, 5], "clip=cheer"],
  ["people-lod1", [0, 2.2, 10.5, 0, 0.9, 5], "lod=1"],
  ["far", [0, 6, 45, 0, 1, 0]],
  // Close-ups at a held clip time (t=): the cyclist and the bike side on, the
  // stroller, the dog walker and the dog.
  ["cyclist", [11.4, 1.3, 5.3, 8.21, 0.6, 5], "t=0"],
  ["stroller", [6.5, 1.8, 8.3, 4.9, 0.7, 5.3], "t=0"],
  ["dog-leash", [3.2, 1.6, 8.1, 2.0, 0.7, 5.1], "t=0"],
];
const want = args.length
  ? args.flatMap((a) => {
      const [n, q] = a.split(":");
      const shot = SHOTS.find(([m]) => m === n);
      if (!shot) return [];
      return q ? [[`${n}-${q.replace(/[=&]/g, "")}`, shot[1], q]] : [shot];
    })
  : SHOTS;
const BASE =
  "level=beltline-eastside&quality=high&look=pbr&date=06-21&time=13.5&weather=clear&governor=0&view=fixed&mute=1&skater=capsule&npcs=0&cars=0&peds=0";
mkdirSync(out, { recursive: true });
const server = await createServer({ server: { port: 5196, strictPort: true }, logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const log = [];
try {
  for (const [name, c, extra] of want) {
    const cam = [wx(c[0], c[2]), c[1], wz(c[0], c[2]), wx(c[3], c[5]), c[4], wz(c[3], c[5])].map((v) => +v.toFixed(2));
    const tags = [
      ["before", "/"],
      ["after", "/scripts/assets/people-props-preview.html"],
    ].filter(([t]) => (!onlyTag || t === onlyTag) && (!extra || t === "after"));
    for (const [tag, path] of tags) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      page.setDefaultTimeout(300000);
      page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
      await page.goto(`http://localhost:5196${path}?${BASE}&plaza=${plaza}&cam=${cam.join(",")}${extra ? `&${extra}` : ""}`, { waitUntil: "commit" });
      await page.waitForFunction(() => window.__atl?.ready && window.__atl.frames > 8, null, { timeout: 300000 });
      if (tag === "after") await page.waitForFunction(() => window.__peopleProps?.ready, null, { timeout: 300000 });
      const f = await page.evaluate(() => window.__atl.frames);
      await page.waitForFunction((f0) => window.__atl.frames > f0 + 12, f, { timeout: 300000 });
      await page.screenshot({ path: `${out}/${name}-${tag.toUpperCase()}.png` });
      const r = await page.evaluate(() => ({
        renderer: window.__atl.rendererInfo,
        peopleProps: window.__peopleProps ? { models: window.__peopleProps.models, errors: window.__peopleProps.errors, lodShown: window.__peopleProps.lodShown } : null,
      }));
      log.push({ name, tag, cam, extra: extra ?? null, ...r });
      console.log(name, tag, JSON.stringify(r.renderer), r.peopleProps?.errors?.length ? r.peopleProps.errors : "");
      await page.close();
    }
  }
} finally {
  writeFileSync(`${out}/shots-${onlyTag ?? "all"}.json`, JSON.stringify(log, null, 2) + "\n");
  await browser.close();
  await server.close();
}
