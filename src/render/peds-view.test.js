import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HEAD_TOP, patchPedVertex, pedGeometry } from "./peds-view.js";

describe("peds view", () => {
  it("builds one figure with every part, about 1.77 m to the top of the head", () => {
    const g = pedGeometry();
    const n = g.attributes.position.count;
    for (const name of ["normal", "color", "pedPart", "pedInfo"]) expect(g.attributes[name].count, name).toBe(n);
    g.computeBoundingBox();
    expect(g.boundingBox.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(HEAD_TOP).toBeCloseTo(1.77, 2);
    // A low-poly figure: under 1500 triangles with every optional part.
    expect(n / 3).toBeLessThan(1500);
    // The vertex attributes, with the 10 instance slots (matrix 4, color,
    // skin, pants, hair, accent, anim), stay inside 16.
    expect(Object.keys(g.attributes).length + 10).toBeLessThanOrEqual(16);
  });

  it("patches the main and the override materials", () => {
    for (const lib of ["normal", "toon", "standard"]) {
      const shader = { vertexShader: THREE.ShaderLib[lib].vertexShader };
      patchPedVertex(shader);
      expect(shader.vertexShader, lib).toContain("bool pedIs");
      expect(shader.vertexShader, lib).toContain("if (!pedOn) transformed = vec3(0.0);");
      expect(shader.vertexShader, lib).not.toContain("#include <begin_vertex>");
    }
  });
});
