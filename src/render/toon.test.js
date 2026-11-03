import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { HALFTONE, halftoneRadius } from "./post.js";
import { KEPT, TOON, outlineWidth, rampData, toonMaterial, toonSkater } from "./toon.js";

// A small skinned box on a skeleton, with a GLB-like material.
function skinnedBox(size, material, skeleton) {
  const geometry = new THREE.BoxGeometry(...size);
  const n = geometry.attributes.position.count;
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(Array.from({ length: n * 4 }, (_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geometry, material);
  if (skeleton) mesh.bind(skeleton);
  return mesh;
}

// A small skinned box with two bones, in the shape of loadSkaterModel().
function fakeSkater() {
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  const map = new THREE.Texture();
  const mesh = skinnedBox([0.4, 1.7, 0.3], new THREE.MeshStandardMaterial({ name: "body", color: 0x884422, map }));
  mesh.add(bones[0]);
  mesh.bind(new THREE.Skeleton(bones));
  const scene = new THREE.Group();
  scene.add(mesh);
  const root = new THREE.Group();
  root.add(scene);
  return { root, skinnedMesh: mesh, map };
}

// A two-mesh GLB stand-in: a body and separate skates on one skeleton, and a
// rigid (not skinned) badge. The skates material uses every KEPT property.
function twoMeshSkater() {
  const s = fakeSkater();
  const skeleton = s.skinnedMesh.skeleton;
  const textures = { emissiveMap: new THREE.Texture(), normalMap: new THREE.Texture() };
  const skatesMaterial = new THREE.MeshStandardMaterial({
    name: "skates",
    color: 0x2266aa,
    opacity: 0.8,
    transparent: true,
    vertexColors: true,
    emissive: 0x331100,
    emissiveIntensity: 2,
    emissiveMap: textures.emissiveMap,
    normalMap: textures.normalMap,
    normalScale: new THREE.Vector2(0.5, -0.5),
    side: THREE.DoubleSide,
  });
  const skates = skinnedBox([0.3, 0.1, 0.4], skatesMaterial, skeleton);
  skates.name = "skates";
  skates.position.set(0, -0.8, 0.05);
  s.skinnedMesh.parent.add(skates);
  const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.1), new THREE.MeshStandardMaterial({ name: "badge" }));
  s.skinnedMesh.parent.add(badge);
  return { ...s, skates, skatesMaterial, badge, textures };
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
    const hulls = toonSkater(s);
    expect(hulls.length).toBe(1);
    const hull = hulls[0];
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

describe("the toon skater with two skinned meshes", () => {
  it("keeps opacity, vertex colors, emissive, emissive map and normal map", () => {
    const s = twoMeshSkater();
    toonSkater(s);
    const m = s.skates.material;
    expect(m.isMeshToonMaterial).toBe(true);
    expect(m.color.getHex()).toBe(0x2266aa);
    expect(m.opacity).toBeCloseTo(0.8);
    expect(m.transparent).toBe(true);
    expect(m.vertexColors).toBe(true);
    expect(m.emissive.getHex()).toBe(0x331100);
    expect(m.emissiveIntensity).toBe(2);
    expect(m.emissiveMap).toBe(s.textures.emissiveMap);
    expect(m.normalMap).toBe(s.textures.normalMap);
    expect(m.normalScale.toArray()).toEqual([0.5, -0.5]);
    expect(m.side).toBe(THREE.DoubleSide);
    // The colors and vectors are copies: a change to the GLB material does not change the toon material.
    expect(m.emissive).not.toBe(s.skatesMaterial.emissive);
    expect(m.normalScale).not.toBe(s.skatesMaterial.normalScale);
  });

  it("keeps the toon defaults when the source material does not have a property", () => {
    const m = toonMaterial({ name: "bare" });
    expect(m.opacity).toBe(1);
    expect(m.vertexColors).toBe(false);
    expect(m.emissive.getHex()).toBe(0x000000);
    expect(m.emissiveMap).toBeNull();
    expect(m.normalMap).toBeNull();
    expect(m.side).toBe(THREE.FrontSide);
    for (const key of KEPT) expect(key in m, key).toBe(true);
  });

  it("builds one outline hull for each skinned mesh, on its geometry and skeleton", () => {
    const s = twoMeshSkater();
    const hulls = toonSkater(s);
    expect(hulls.length).toBe(2);
    const sources = [s.skinnedMesh, s.skates];
    for (const [i, hull] of hulls.entries()) {
      const src = sources[i];
      expect(hull.userData.outlineOf).toBe(src);
      expect(hull.isSkinnedMesh).toBe(true);
      expect(hull.parent).toBe(src.parent);
      expect(hull.geometry).toBe(src.geometry);
      expect(hull.skeleton).toBe(src.skeleton);
      expect(hull.position.toArray()).toEqual(src.position.toArray());
      expect(hull.material.side).toBe(THREE.BackSide);
      expect(hull.castShadow).toBe(false);
    }
    // The rigid badge gets a toon material and no hull.
    expect(s.badge.material.isMeshToonMaterial).toBe(true);
    expect(hulls.some((h) => h.geometry === s.badge.geometry)).toBe(false);
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
