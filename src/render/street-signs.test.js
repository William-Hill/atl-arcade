import { describe, expect, it } from "vitest";
import { bladeGeometry, createStreetSigns } from "./street-signs.js";

describe("createStreetSigns", () => {
  it("gives an update() even with no signs, so the frame loop never throws", () => {
    const signs = createStreetSigns([]);
    expect(signs.count).toBe(0);
    expect(signs.names).toEqual([]);
    expect(() => signs.update({ x: 0, y: 0, z: 0 })).not.toThrow();
  });
});

describe("bladeGeometry (#405)", () => {
  // BoxGeometry faces: +x, -x, +y, -y, +z, -z, 4 vertices each.
  // A viewer in front of face 4 (+z) has +x on the right. A viewer in front
  // of face 5 (-z) has -x on the right.
  const RIGHT = { 4: 1, 5: -1 };

  for (const face of [4, 5]) {
    it(`face ${face}: u increases from the viewer's left to the viewer's right`, () => {
      const g = bladeGeometry(2, 0, 4, 512);
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      const verts = [0, 1, 2, 3].map((k) => {
        const i = face * 4 + k;
        return { right: pos.getX(i) * RIGHT[face], u: uv.getX(i) };
      });
      const left = verts.filter((v) => v.right < 0);
      const right = verts.filter((v) => v.right > 0);
      expect(left).toHaveLength(2);
      expect(right).toHaveLength(2);
      for (const l of left) for (const r of right) expect(r.u).toBeGreaterThan(l.u);
    });
  }
});
