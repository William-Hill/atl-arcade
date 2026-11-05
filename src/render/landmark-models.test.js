import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { bytesKey, LANDMARK_MODEL_KEYS, lodGroups, mergedPositions, windowLightPatch } from "./landmark-models.js";

describe("landmark models", () => {
  it("keys equal image bytes alike and different bytes apart", () => {
    const a = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(bytesKey(a)).toBe(bytesKey(new Uint8Array([1, 2, 3, 4]).buffer));
    expect(bytesKey(a)).not.toBe(bytesKey(new Uint8Array([1, 2, 3, 5]).buffer));
    expect(bytesKey(a)).not.toBe(
      bytesKey(new Uint8Array([1, 2, 3, 4, 0]).buffer),
    );
  });

  it("loads the four buildings and the four bridges", () => {
    expect(LANDMARK_MODEL_KEYS).toHaveLength(8);
  });

  it("groups the LOD nodes of a building and of each section, by level", () => {
    const names = ["pcm_s1_lod1", "pcm_s0_lod2", "pcm_s0_lod0", "pcm_s1_lod0", "pcm_s0_lod1", "other"];
    const g = lodGroups(names.map((name) => ({ name })));
    expect([...g.keys()].sort()).toEqual(["pcm_s0", "pcm_s1"]);
    expect(g.get("pcm_s0").map((l) => l.level)).toEqual([0, 1, 2]);
    expect(g.get("pcm_s1").map((l) => l.node.name)).toEqual(["pcm_s1_lod0", "pcm_s1_lod1"]);
  });

  it("merges the shadow proxy from moved meshes into one indexed geometry", () => {
    const a = new THREE.PlaneGeometry(1, 1);
    const b = new THREE.PlaneGeometry(1, 1).toNonIndexed();
    const g = mergedPositions([
      { geometry: a, matrix: null },
      { geometry: b, matrix: new THREE.Matrix4().makeTranslation(10, 0, 0) },
    ]);
    expect(g.attributes.position.count).toBe(4 + 6);
    expect(g.index.count).toBe(6 + 6);
    g.computeBoundingBox();
    expect(g.boundingBox.max.x).toBeCloseTo(10.5);
    expect(Math.max(...g.index.array)).toBe(9);
  });

  it("lights the windows from the shared uLit value", () => {
    const m = new THREE.MeshStandardMaterial();
    const lit = { value: 0.8 };
    windowLightPatch(m, lit);
    const shader = { uniforms: {}, vertexShader: "#include <common>\n#include <begin_vertex>", fragmentShader: "#include <common>\n#include <emissivemap_fragment>" };
    m.onBeforeCompile(shader);
    expect(shader.uniforms.uLit).toBe(lit);
    expect(shader.vertexShader).toContain("vLitKey = uv1.x");
    expect(shader.fragmentShader).toContain("step(vLitKey, uLit * 0.6)");
  });
});
