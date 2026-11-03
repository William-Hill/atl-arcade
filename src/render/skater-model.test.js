import * as THREE from "three";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_YAW } from "./skater-model.js";

const GLB = new URL("../../assets/skaters/nia/skater.glb", import.meta.url);

function readGlbJson(url) {
  const buf = readFileSync(url);
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.toString("utf8", 20, 20 + length));
}

describe("the Nia skater GLB", () => {
  const gltf = readGlbJson(GLB);

  it("is under 3 MB and uses Draco", () => {
    expect(statSync(GLB).size).toBeLessThan(3 * 1024 * 1024);
    expect(gltf.extensionsRequired).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("has one skinned mesh under 20,000 triangles", () => {
    expect(gltf.meshes).toHaveLength(1);
    const prim = gltf.meshes[0].primitives[0];
    expect(gltf.accessors[prim.indices].count / 3).toBeLessThan(20000);
    expect(prim.attributes).toHaveProperty("JOINTS_0");
    expect(prim.attributes).toHaveProperty("WEIGHTS_0");
    expect(gltf.skins[0].joints).toHaveLength(65);
  });

  it("keeps the Mixamo joint names", () => {
    const names = gltf.skins[0].joints.map((i) => gltf.nodes[i].name);
    expect(names).toContain("mixamorig:Hips");
    expect(names).toContain("mixamorig:LeftFoot");
  });

  it("is about 1.7 m tall with the wheels at y = 0", () => {
    const pos = gltf.accessors[gltf.meshes[0].primitives[0].attributes.POSITION];
    expect(pos.min[1]).toBeCloseTo(0, 2);
    expect(pos.max[1]).toBeGreaterThan(1.65);
    expect(pos.max[1]).toBeLessThan(1.75);
  });
});

describe("the model wrapper", () => {
  it("turns the glTF forward (+z) to the controller forward (+x)", () => {
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), MODEL_YAW);
    expect(forward.x).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);
  });
});
