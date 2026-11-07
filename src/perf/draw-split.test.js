import { describe, expect, it } from "vitest";
import { baseName, createDrawSplit, kindOf, summarize } from "./draw-split.js";

describe("baseName", () => {
  it("drops the tile key and the index at the end", () => {
    expect(baseName("building-12,-3")).toBe("building");
    expect(baseName("surface-far-4,5")).toBe("surface-far");
    expect(baseName("kit-tile")).toBe("kit");
    expect(baseName("ped-7")).toBe("ped");
    expect(baseName("sky")).toBe("sky");
  });
});

describe("kindOf", () => {
  it("names a batched mesh, a skinned mesh, and an unnamed child by its parent", () => {
    expect(kindOf({ isBatchedMesh: true, name: "props" })).toBe("batched:props");
    expect(kindOf({ isSkinnedMesh: true, name: "nia-body" })).toBe("skinned:nia-body");
    expect(kindOf({ name: "", parent: { name: "car-3" } })).toBe("mesh:car");
    expect(kindOf({ name: "" })).toBe("mesh");
  });
});

describe("summarize", () => {
  it("sorts the rows and adds up each pass", () => {
    const rows = new Map([
      ["main|a", { pass: "main", kind: "a", calls: 2, triangles: 10 }],
      ["shadow|a", { pass: "shadow", kind: "a", calls: 5, triangles: 30 }],
      ["main|b", { pass: "main", kind: "b", calls: 1, triangles: 3 }],
    ]);
    const s = summarize(rows);
    expect(s.total).toEqual({ calls: 8, triangles: 43 });
    expect(s.byPass).toEqual({ main: { calls: 3, triangles: 13 }, shadow: { calls: 5, triangles: 30 } });
    expect(s.rows[0].kind).toBe("a");
    expect(s.rows[0].pass).toBe("shadow");
  });
});

describe("createDrawSplit", () => {
  it("counts each draw under its pass, and a shadow map under the pass that drew it", () => {
    const info = { render: { calls: 0, triangles: 0 } };
    const renderer = {
      info,
      renderBufferDirect(camera, scene, geometry, material, object) {
        info.render.calls += 1;
        info.render.triangles += object.tris;
      },
      shadowMap: {
        render() {
          renderer.renderBufferDirect(null, null, null, null, { name: "building-1", tris: 7 });
        },
      },
    };
    const split = createDrawSplit(renderer);
    const gtao = {
      render() {
        renderer.shadowMap.render();
        renderer.renderBufferDirect(null, null, null, null, { name: "building-2", tris: 7 });
      },
    };
    split.wrapPass(gtao, "gtao");
    split.begin();
    renderer.shadowMap.render();
    renderer.renderBufferDirect(null, null, null, null, { name: "building-1", tris: 7 });
    gtao.render();
    split.end();
    const r = split.report();
    expect(r.total).toEqual({ calls: 4, triangles: 28 });
    expect(Object.keys(r.byPass).sort()).toEqual(["gtao", "gtao>shadow", "main", "shadow"]);
  });
});
