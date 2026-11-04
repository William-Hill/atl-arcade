import { describe, expect, it } from "vitest";
import { addExtraTemplates, EXTRA_PROP_FALLBACK } from "./geo-view.js";
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

  it("gives each extra prop with a solid obstacle a fallback kit prop", () => {
    for (const [kind, kitKind] of Object.entries(EXTRA_PROP_FALLBACK)) {
      expect(PROP_SOLID[kind], kind).toBeDefined();
      expect(PROP_SOLID[kitKind], kitKind).toBeDefined();
    }
  });
});
