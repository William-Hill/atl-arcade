import { describe, expect, it, vi } from "vitest";
import { addExtraTemplates, EXTRA_PROP_FALLBACK, glbTreeTemplates, withTimeout } from "./geo-view.js";
import { PROP_SOLID } from "../level/geo/props.js";

const t = (n) => ({ positions: new Float32Array(n * 3) });

describe("extra prop templates", () => {
  it("adds the one mesh of an extra GLB under its kind name", () => {
    const kit = { bench: t(1) };
    const mesh = t(2);
    const problems = addExtraTemplates(kit, ["bench_painted"], [{ status: "fulfilled", value: { painted_wooden_bench_toon: mesh } }]);
    expect(problems).toEqual([]);
    expect(kit.bench_painted).toBe(mesh);
  });

  it("uses the fallback kit template when the GLB does not load", () => {
    const kit = { bench: t(1) };
    const problems = addExtraTemplates(kit, ["bench_painted"], [{ status: "rejected", reason: new Error("404") }]);
    expect(problems).toHaveLength(1);
    expect(kit.bench_painted).toBe(kit.bench);
  });

  it("refuses a GLB with more than one mesh, and uses the fallback", () => {
    const kit = { bench: t(1) };
    const problems = addExtraTemplates(kit, ["bench_painted"], [{ status: "fulfilled", value: { a: t(2), b: t(3) } }]);
    expect(problems[0]).toMatch(/2 meshes/);
    expect(kit.bench_painted).toBe(kit.bench);
  });

  it("rejects a load that does not settle in time, and keeps a fast load", async () => {
    vi.useFakeTimers();
    try {
      const stalled = withTimeout(new Promise(() => {}), 1000, "bench_painted");
      const check = expect(stalled).rejects.toThrow(/bench_painted: no answer in 1000 ms/);
      await vi.advanceTimersByTimeAsync(1000);
      await check;
      await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives each extra prop with a solid obstacle a fallback kit prop", () => {
    for (const [kind, kitKind] of Object.entries(EXTRA_PROP_FALLBACK)) {
      expect(PROP_SOLID[kind], kind).toBeDefined();
      expect(PROP_SOLID[kitKind], kitKind).toBeDefined();
    }
  });
});

describe("glb tree templates", () => {
  it("names the loaded GLB trees as treeKindFor() does, and skips the LOD1 copies and the kit trees", () => {
    const a = t(1);
    const b = t(2);
    const out = glbTreeTemplates({ tree_oak_0: a, treepine1: b, treepine1_lod1: t(6), tree_round: t(3), tree_tall_lod1: t(4), bench: t(5) });
    expect(out).toEqual({ "tree:oak:0": a, "tree:pine:1": b });
  });
});
