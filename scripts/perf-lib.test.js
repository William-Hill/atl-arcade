import { describe, expect, it } from "vitest";
import { checkBudget, classifyUrl, downloadGroupOf, firstFrameMB, frameStats, mergeRuns, renderMarkdown, spliceMarkdown } from "./perf-lib.mjs";

const run = (over = {}) => ({
  quality: "low",
  look: "toon",
  load: 1,
  frame: { meanMs: 20, p95Ms: 30, medianFps: 50 },
  calls: 40,
  triangles: 500000,
  geometries: 300,
  textures: 50,
  heapMB: 120,
  firstFrameMs: 3000,
  downloadMB: { js: 1, glb: 5, textures: 2, wasm: 1, data: 3, other: 0, total: 12 },
  systems: { render: { meanMs: 10, p95Ms: 15 } },
  ...over,
});

describe("perf lib", () => {
  it("sorts the downloads by type", () => {
    expect(classifyUrl("http://x/assets/index-abc.js")).toBe("js");
    expect(classifyUrl("http://x/assets/nia.glb?v=1")).toBe("glb");
    expect(classifyUrl("http://x/a/brick.webp")).toBe("textures");
    expect(classifyUrl("http://x/a/k.ktx2")).toBe("textures");
    expect(classifyUrl("http://x/rapier_wasm.wasm")).toBe("wasm");
    expect(classifyUrl("http://x/levels/b/level.json")).toBe("data");
    expect(classifyUrl("http://x/", "text/html")).toBe("other");
    expect(classifyUrl("http://x/blob", "image/png")).toBe("textures");
  });

  it("gives the frame stats without the first 5 frames", () => {
    const s = frameStats([500, 500, 500, 500, 500, ...Array.from({ length: 100 }, (_, i) => (i < 90 ? 10 : 40))]);
    expect(s.frames).toBe(100);
    expect(s.meanMs).toBe(13);
    expect(s.p95Ms).toBe(40);
    expect(s.medianFps).toBe(100);
  });

  it("lists the metrics over the budget", () => {
    const budget = { tiers: { low: { calls: 30, downloadMB: 20, p95Ms: 25 }, high: { calls: 999 } } };
    expect(checkBudget([run(), run({ quality: "high" })], budget)).toEqual(["low/toon calls 40 > 30", "low/toon p95Ms 30 > 25"]);
  });

  it("lets a tier/look entry override its tier", () => {
    const budget = { tiers: { low: { calls: 30 }, "low/pbr": { calls: 50 } } };
    expect(checkBudget([run({ look: "pbr" }), run()], budget)).toEqual(["low/toon calls 40 > 30"]);
  });

  it("takes the median of the repeats", () => {
    const merged = mergeRuns([run({ calls: 10 }), run({ calls: 30 }), run({ calls: 20 })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].calls).toBe(20);
    expect(merged[0].runs).toBe(3);
    expect(mergeRuns([run({ calls: 10 }), run({ calls: 31 })])[0].calls).toBe(20.5);
  });

  it("writes the tables between the markers", () => {
    const tables = renderMarkdown({ date: "2026-11-06T12:00:00Z", gpu: "swiftshader", machine: { cpus: 4 }, viewport: "1280x720 @1", rideSeconds: 15, repeat: 1, runs: [run()] });
    expect(tables).toContain("| low | toon | 20 | 30 | 50 | 40 |");
    const doc = "# A\n<!-- perf:begin -->\nold\n<!-- perf:end -->\nB\n";
    const out = spliceMarkdown(doc, tables);
    expect(out).not.toContain("old");
    expect(out.startsWith("# A\n<!-- perf:begin -->\n")).toBe(true);
    expect(out.endsWith("<!-- perf:end -->\nB\n")).toBe(true);
  });
});

describe("perf lib: the download before the first frame (#190)", () => {
  const files = [
    { file: "/", kB: 1, startMs: null },
    { file: "/assets/skater-B_jE0GB_.glb", kB: 2048, startMs: 90 },
    { file: "/assets/oak-BqKxyhcO.glb", kB: 512, startMs: 3000 },
    { file: "/assets/vehicles_lod-BE1gXgF8.glb", kB: 512, startMs: 5000 },
  ];

  it("counts the files asked for before the first frame", () => {
    expect(firstFrameMB(files, 4000)).toBe(2.5);
    expect(firstFrameMB(files, 3000)).toBe(2);
    expect(firstFrameMB(files, null)).toBe(null);
    expect(firstFrameMB(null, 4000)).toBe(null);
  });

  it("checks the firstDownloadMB cap", () => {
    expect(checkBudget([run({ files, firstFrameMs: 4000 })], { tiers: { low: { firstDownloadMB: 2 } } })).toEqual(["low/toon firstDownloadMB 2.5 > 2"]);
    expect(checkBudget([run({ firstDownloadMB: 1.5 })], { tiers: { low: { firstDownloadMB: 2 } } })).toEqual([]);
  });

  it("puts the column in the download table", () => {
    const md = renderMarkdown({ date: "2026-11-09T00:00:00Z", gpu: "x", machine: { cpus: 4 }, viewport: "1280x720 @1", rideSeconds: 15, runs: [run({ firstDownloadMB: 4.2 })] });
    expect(md).toMatch(/\| Before first frame \|/);
    expect(md).toMatch(/\| 12 \| 4\.2 \|/);
  });

  it("puts each file in its group, built or not", () => {
    const cases = {
      "/assets/skater-1024-8j3oaqJY.glb": "skater",
      "/assets/rapier_wasm3d_bg-C6GCbKVJ.wasm": "physics",
      "/assets/vehicles_lod-BE1gXgF8.glb": "cars",
      "/assets/bus-9aEW4-OE.glb": "cars",
      "/assets/dog_walker-Bs0n0Vu_.glb": "people",
      "/assets/dog-QirLDCw1.glb": "people",
      "/assets/people/jogger.glb": "people",
      "/assets/elder_polo_v2-CQyQ2Uc_.jpg": "people",
      "/assets/bollard-CpV2BZKX.glb": "meshy props",
      "/assets/ponce-city-market-D093VQas.glb": "landmark GLBs",
      "/assets/bridge-north-ave-BgJsj2sY.glb": "landmark GLBs",
      "/assets/street-kit-CEVzTpPi.glb": "street kit",
      "/assets/street-DbOGjA0p.glb": "GLB trees",
      "/assets/trees/oak.glb": "GLB trees",
      "/assets/facade-kit-BPFEyRLI.glb": "facade kit",
      "/assets/mural-atlas-DNK9NS_Z.jpg": "murals",
      "/assets/normal-1024-B1R5BzzO.webp": "pbr ground",
      "/assets/orm-512-DdVlRKVR.webp": "pbr ground",
      "/assets/main-CCfys8ot.js": "js",
      "/assets/normal-D4GkI7qp.jpg": "other",
    };
    for (const [file, group] of Object.entries(cases)) expect(downloadGroupOf(file), file).toBe(group);
  });
});
