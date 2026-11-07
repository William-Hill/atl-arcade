import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SHADOW_STAND_INS, canMerge, enableShadowStandIns, mergeGeometries, mergeShadow, mergeableParts, plainDepth, sameSkeleton } from "./skin-merge.js";

function partGeometry(offset, { indexed = true } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0].map((v) => v + offset)), 3));
  g.setAttribute("normal", new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint8Array([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0]), 4));
  g.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array([0.5, 0.5, 0, 0, 1, 0, 0, 0, 0.25, 0.75, 0, 0]), 4));
  if (indexed) g.setIndex([0, 1, 2]);
  return g;
}

// A skater of `n` parts on one set of bones; with `clone`, each part has its
// own skeleton over those bones, as SkeletonUtils.clone() makes.
function skater(n = 3, { clone = false, material = () => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }) } = {}) {
  const root = new THREE.Group();
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  root.add(bones[0]);
  const skeleton = new THREE.Skeleton(bones);
  const parts = [];
  for (let i = 0; i < n; i += 1) {
    const m = new THREE.SkinnedMesh(partGeometry(i, { indexed: i !== 1 }), material(i));
    m.castShadow = true;
    root.add(m);
    m.bind(clone ? new THREE.Skeleton(bones, skeleton.boneInverses) : skeleton, new THREE.Matrix4());
    parts.push(m);
  }
  return { root, parts };
}

describe("sameSkeleton", () => {
  it("is true for the per-part skeletons of a clone, false for other bones", () => {
    const { parts } = skater(2, { clone: true });
    expect(parts[0].skeleton).not.toBe(parts[1].skeleton);
    expect(sameSkeleton(parts[0].skeleton, parts[1].skeleton)).toBe(true);
    expect(sameSkeleton(parts[0].skeleton, skater(1).parts[0].skeleton)).toBe(false);
  });
});

describe("plainDepth and canMerge", () => {
  it("merges opaque parts on one skeleton and one side", () => {
    expect(canMerge(skater(3, { clone: true }).parts)).toBe(true);
    expect(canMerge(skater(1).parts)).toBe(false);
  });
  it("leaves out an alpha-tested part and a mix of sides", () => {
    const cut = skater(2, { material: (i) => new THREE.MeshStandardMaterial({ alphaTest: i ? 0.5 : 0 }) }).parts;
    expect(plainDepth(cut[0])).toBe(true);
    expect(plainDepth(cut[1])).toBe(false);
    const sides = skater(2, { material: (i) => new THREE.MeshStandardMaterial({ side: i ? THREE.FrontSide : THREE.DoubleSide }) }).parts;
    expect(canMerge(sides)).toBe(false);
  });
});

describe("mergeGeometries", () => {
  it("joins the vertices and offsets the index, indexed or not", () => {
    const g = mergeGeometries([partGeometry(0), partGeometry(1, { indexed: false }), partGeometry(2)]);
    expect(g.attributes.position.count).toBe(9);
    expect(Array.from(g.index.array)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(g.attributes.position.getX(3)).toBe(1);
    expect(g.attributes.skinIndex.array).toBeInstanceOf(Uint16Array);
    expect(g.attributes.skinWeight.getY(8)).toBe(0.75);
    expect(Object.keys(g.attributes).sort()).toEqual(["normal", "position", "skinIndex", "skinWeight"]);
  });
});

describe("mergeShadow", () => {
  beforeEach(() => enableShadowStandIns(true));
  afterEach(() => enableShadowStandIns(false));
  it("keeps the parts' own shadows when no shadow pass shows the stand-ins", () => {
    enableShadowStandIns(false);
    const { root, parts } = skater(3, { clone: true });
    expect(mergeShadow(root)).toBe(null);
    expect(parts.every((p) => p.castShadow)).toBe(true);
    expect(root.children.some((o) => o.name === "skater-shadow")).toBe(false);
  });
  it("adds one hidden stand-in that casts in place of the parts", () => {
    const { root, parts } = skater(3, { clone: true });
    const caster = mergeShadow(root);
    expect(caster.visible).toBe(false);
    expect(caster.castShadow).toBe(true);
    expect(caster.material.side).toBe(THREE.DoubleSide);
    expect(caster.geometry.index.count).toBe(9);
    expect(caster.skeleton.bones).toEqual(parts[0].skeleton.bones);
    expect(parts.every((p) => !p.castShadow)).toBe(true);
    expect(SHADOW_STAND_INS.has(caster)).toBe(true);
    // A second call finds no caster left to merge.
    expect(mergeShadow(root)).toBe(null);
    expect(mergeableParts(root)).toHaveLength(3);
  });
  it("shares the merged geometry between clones of one skater", () => {
    const a = skater(2);
    const b = { root: new THREE.Group(), parts: [] };
    const skeleton = new THREE.Skeleton([new THREE.Bone()]);
    for (const p of a.parts) {
      const m = new THREE.SkinnedMesh(p.geometry, p.material);
      m.castShadow = true;
      b.root.add(m);
      m.bind(skeleton, new THREE.Matrix4());
    }
    expect(mergeShadow(a.root).geometry).toBe(mergeShadow(b.root).geometry);
  });
});
