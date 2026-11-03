import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HALFTONE, halftoneRadius } from "./post.js";
import { TOON, outlineWidth, rampData, toonSkater } from "./toon.js";

// A small skinned box with two bones, in the shape of loadSkaterModel().
function fakeSkater() {
  const geometry = new THREE.BoxGeometry(0.4, 1.7, 0.3);
  const n = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  const map = new THREE.Texture();
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ name: "body", color: 0x884422, map }));
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  const scene = new THREE.Group();
  scene.add(mesh);
  const root = new THREE.Group();
  root.add(scene);
  return { root, skinnedMesh: mesh, map };
}

describe("the toon skater", () => {
  it("builds a 3-step ramp, dark to light", () => {
    const d = rampData();
    expect(d.length).toBe(TOON.ramp.length * 4);
    for (let i = 1; i < TOON.ramp.length; i += 1) expect(d[i * 4]).toBeGreaterThan(d[(i - 1) * 4]);
    expect(d[(TOON.ramp.length - 1) * 4]).toBe(255);
  });

  it("keeps the outline about 2 px wide from 2 m to 60 m", () => {
    // Pixels for a 60 degree field of view at 720 px high.
    const px = (w, dist) => (w * 720) / (2 * dist * Math.tan(Math.PI / 6));
    expect(outlineWidth(1)).toBe(TOON.outline.min);
    for (const dist of [5, 10, 30, 60]) {
      const p = px(outlineWidth(dist), dist);
      expect(p).toBeGreaterThan(1.2);
      expect(p).toBeLessThan(3);
    }
  });

  it("swaps the GLB materials for toon materials and keeps the map and the color", () => {
    const s = fakeSkater();
    toonSkater(s);
    const m = s.skinnedMesh.material;
    expect(m.isMeshToonMaterial).toBe(true);
    expect(m.map).toBe(s.map);
    expect(m.color.getHex()).toBe(0x884422);
    expect(m.gradientMap.image.width).toBe(TOON.ramp.length);
    expect(m.userData.rim.strength).toBeCloseTo(TOON.rim.strength);
  });

  it("adds an outline hull on the same skeleton and geometry, with back faces and no shadow", () => {
    const s = fakeSkater();
    const hull = toonSkater(s);
    expect(hull.isSkinnedMesh).toBe(true);
    expect(hull.parent).toBe(s.skinnedMesh.parent);
    expect(hull.geometry).toBe(s.skinnedMesh.geometry);
    expect(hull.skeleton).toBe(s.skinnedMesh.skeleton);
    expect(hull.material.side).toBe(THREE.BackSide);
    expect(hull.castShadow).toBe(false);
    // The hull is not a toon mesh: only the source meshes change.
    expect(hull.material.isMeshBasicMaterial).toBe(true);
  });
});

describe("the halftone", () => {
  it("puts no dot on a lit pixel and grows the dot as the pixel gets darker", () => {
    expect(halftoneRadius(HALFTONE.start)).toBe(0);
    expect(halftoneRadius(1)).toBe(0);
    expect(halftoneRadius(0)).toBeCloseTo(0.5);
    expect(halftoneRadius(HALFTONE.start * 0.25)).toBeGreaterThan(halftoneRadius(HALFTONE.start * 0.75));
  });
});
