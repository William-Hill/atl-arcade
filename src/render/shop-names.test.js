import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { decalMesh } from "./shop-names.js";

describe("shop-name decals", () => {
  it("writes every quad into the buffers, on its board", () => {
    const quads = [
      { c: [100, 5, 200], n: [0, 1], up: [0, 1, 0], w: 2, h: 0.5, row: 0 },
      { c: [140, 6, 260], n: [1, 0], up: [0, 1, 0], w: 2, h: 0.5, row: 3 },
      { c: [120, 1, 230], n: [0, -1], up: [1, 0, 0], w: 10, h: 1.9, row: 1 },
    ];
    const g = decalMesh(quads, 8, new THREE.MeshBasicMaterial()).geometry;
    const pos = g.attributes.position;
    expect(g.index.count).toBe(quads.length * 6);
    for (let k = 0; k < g.index.count; k += 1) expect(g.index.array[k]).toBeLessThan(pos.count);
    quads.forEach((q, i) => {
      for (let v = 0; v < 4; v += 1) expect(Math.hypot(pos.getX(i * 4 + v) - q.c[0], pos.getZ(i * 4 + v) - q.c[2])).toBeLessThan(q.w);
    });
    g.computeBoundingSphere();
    expect(g.boundingSphere.center.x).toBeGreaterThan(90);
  });
});
