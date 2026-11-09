import { expect, test } from "@playwright/test";
import { downloadGroupOf } from "../scripts/perf-lib.mjs";

// #190: on the pbr look, the street kit, the GLB trees, the painted mural
// atlas and the pbr ground maps load after the first frame
// (src/render/late-load.js). The spec checks that the first frame comes
// before these files are asked for, and that they arrive and go into the
// scene later. ?lateload=0 is the control: the same files start before the
// first frame.

const LATE = new Set(["street kit", "GLB trees", "murals", "pbr ground"]);
const QUERY = "level=beltline-eastside&mute=1&quality=low&look=pbr&governor=0&npcseed=1&run=free&cars=0&peds=0&skaters=0";

function collectErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(String(err)));
  return errors;
}

async function open(page, extra = "") {
  // Keep a start time for every file (the default buffer keeps 250).
  await page.addInitScript(() => performance.setResourceTimingBufferSize(2000));
  await page.goto(`/?${QUERY}${extra}`);
  await page.waitForFunction(() => performance.getEntriesByName("atl:first-frame").length > 0, null, { timeout: 120000, polling: 50 });
}

// The late files that the page asked for, with their start and end (ms
// from the navigation), and the first frame.
async function lateFiles(page) {
  const { ff, files } = await page.evaluate(() => ({
    ff: performance.getEntriesByName("atl:first-frame")[0].startTime,
    files: performance.getEntriesByType("resource").map((e) => ({ url: new URL(e.name).pathname, start: e.startTime, end: e.responseEnd })),
  }));
  return { ff, files: files.filter((f) => LATE.has(downloadGroupOf(f.url))).map((f) => ({ ...f, group: downloadGroupOf(f.url) })) };
}

test("the pbr look asks for the late files only after the first frame, and they arrive", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  const warnings = [];
  page.on("console", (msg) => msg.type() === "warning" && warnings.push(msg.text()));
  await open(page);

  const plan = await page.evaluate(() => window.__atl.lateLoads.plan);
  expect(plan).toEqual({ props: true, murals: true, ground: true });

  // At the first frame: no late group has started.
  const atFirst = await lateFiles(page);
  const early = atFirst.files.filter((f) => f.start < atFirst.ff);
  expect(early, `late files asked for before the first frame (${Math.round(atFirst.ff)} ms)`).toEqual([]);

  // Later: every group has loaded, and the prop batch is in the scene.
  await page.waitForFunction(
    () => {
      const l = window.__atl.lateLoads;
      return ["props", "murals", "ground"].every((g) => l.done[g] != null || l.failed[g] != null) && window.__atl.level.props?.loaded;
    },
    null,
    { timeout: 180000, polling: 250 },
  );
  const info = await page.evaluate(() => window.__atl.lateLoads);
  expect(info.failed).toEqual({});
  for (const g of ["props", "murals", "ground"]) {
    expect(info.started[g], g).toBeGreaterThanOrEqual(info.firstFrameMs);
    expect(info.done[g], g).toBeGreaterThanOrEqual(info.started[g]);
  }
  const later = await lateFiles(page);
  // The tree, kit, mural and ground files came, all after the first frame.
  expect(new Set(later.files.map((f) => f.group))).toEqual(LATE);
  for (const f of later.files) expect(f.start, f.url).toBeGreaterThanOrEqual(later.ff);
  // The props went in: the batch has instances.
  const props = await page.evaluate(() => window.__atl.level.props);
  expect(props.loaded).toBe(true);
  // The GLB trees came, not the procedural fallback: their far impostors are baked.
  expect(await page.evaluate(() => window.__atl.trees.impostorKinds)).toBeGreaterThan(0);
  expect(warnings.filter((w) => /tree glb|extra prop/.test(w))).toEqual([]);
  expect(errors).toEqual([]);
});

test("with ?lateload=0 the same files start before the first frame", async ({ page }) => {
  test.setTimeout(240000);
  const errors = collectErrors(page);
  await open(page, "&lateload=0");
  expect(await page.evaluate(() => window.__atl.lateLoads.plan)).toEqual({ props: false, murals: false, ground: false });
  const { ff, files } = await lateFiles(page);
  const early = new Set(files.filter((f) => f.start < ff).map((f) => f.group));
  expect(early).toEqual(LATE);
  expect(errors).toEqual([]);
});
