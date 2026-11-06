import { describe, expect, it } from "vitest";
import { checkBudget, classifyUrl, frameStats, mergeRuns, renderMarkdown, spliceMarkdown } from "./perf-lib.mjs";

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
