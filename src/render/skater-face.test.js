import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { FACE_DECALS, attachFace, coversRect } from "./skater-face.js";

// A box at a center (bind-pose meters) with a standard material.
function box(center, size = 0.2) {
  const geometry = new THREE.BoxGeometry(size, size, size).translate(...center);
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

describe("coversRect", () => {
  const rect = [-0.1, 0.1, 1.4, 1.5];
  it("is true for a front vertex in the rect", () => {
    expect(coversRect(box([0, 1.45, 0.05], 0.1).geometry.attributes.position, [rect])).toBe(true);
  });
  it("is false for a vertex outside the rect or behind the face plane", () => {
    expect(coversRect(box([0, 0.5, 0.05], 0.1).geometry.attributes.position, [rect])).toBe(false);
    expect(coversRect(box([0, 1.45, -0.2], 0.1).geometry.attributes.position, [rect])).toBe(false);
  });
});

describe("attachFace on a model with one mesh per material (#167)", () => {
  it("puts the decal on the head mesh, not on the first mesh", async () => {
    const load = vi.spyOn(THREE.TextureLoader.prototype, "loadAsync").mockImplementation(async () => new THREE.Texture());
    const [x0, x1, y0, y1] = FACE_DECALS.nia.eyes.rect;
    const legs = box([0, 0.5, 0]);
    // Small enough that its corners fall inside the eye rect.
    const head = box([(x0 + x1) / 2, (y0 + y1) / 2, 0.05], 0.04);
    const legsMaterial = legs.material;
    const face = await attachFace([legs, head], "nia");
    load.mockRestore();
    expect(face.meshes.length).toBe(1);
    expect(face.meshes[0]).toBe(head);
    expect(head.material.customProgramCacheKey()).toBe("skater-face");
    expect(legs.material).toBe(legsMaterial);
  });
});
