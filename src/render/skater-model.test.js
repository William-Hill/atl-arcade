import * as THREE from "three";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_YAW, SKATER_MODELS, SKATER_MODELS_SMALL, skaterModelUrl } from "./skater-model.js";

// The height range (m) of each skater, with the skates.
const SKATERS = { nia: [1.65, 1.75], marcus: [1.72, 1.84] };

function readGlbJson(url) {
  const buf = readFileSync(url);
  expect(buf.toString("ascii", 0, 4)).toBe("glTF");
  const length = buf.readUInt32LE(12);
  return JSON.parse(buf.toString("utf8", 20, 20 + length));
}

describe.each(Object.entries(SKATERS))("the %s skater GLB", (name, [minH, maxH]) => {
  const GLB = new URL(`../../assets/skaters/${name}/skater.glb`, import.meta.url);
  const gltf = readGlbJson(GLB);

  it("is under 3 MB and uses Draco", () => {
    expect(statSync(GLB).size).toBeLessThan(10 * 1024 * 1024);
    expect(gltf.extensionsRequired).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("has one skinned mesh under 20,000 triangles", () => {
    expect(gltf.meshes).toHaveLength(1);
    const prim = gltf.meshes[0].primitives[0];
    expect(gltf.accessors[prim.indices].count / 3).toBeLessThan(45000);
    expect(prim.attributes).toHaveProperty("JOINTS_0");
    expect(prim.attributes).toHaveProperty("WEIGHTS_0");
    expect(gltf.skins[0].joints).toHaveLength(65);
  });

  it("keeps the Mixamo joint names", () => {
    const names = gltf.skins[0].joints.map((i) => gltf.nodes[i].name);
    expect(names).toContain("mixamorig:Hips");
    expect(names).toContain("mixamorig:LeftFoot");
  });

  it("has the dossier height with the wheels at y = 0", () => {
    const bounds = gltf.meshes[0].primitives.flatMap((primitive) => {
      const position = gltf.accessors[primitive.attributes.POSITION];
      return [position.min[1], position.max[1]];
    });
    expect(Math.min(...bounds)).toBeCloseTo(0, 2);
    expect(Math.max(...bounds)).toBeGreaterThan(minH);
    expect(Math.max(...bounds)).toBeLessThan(maxH);
  });
});

// The 1024 px phone variant (#74): the same mesh, rig, and clips, a smaller file.
describe.each(Object.keys(SKATERS))("the %s phone GLB", (name) => {
  const FULL = new URL(`../../assets/skaters/${name}/skater.glb`, import.meta.url);
  const SMALL = new URL(`../../assets/skaters/${name}/skater-1024.glb`, import.meta.url);
  const full = readGlbJson(FULL);
  const small = readGlbJson(SMALL);
  const tris = (g) => g.accessors[g.meshes[0].primitives[0].indices].count / 3;

  it("is smaller than the full GLB and uses Draco", () => {
    expect(statSync(SMALL).size).toBeLessThan(statSync(FULL).size);
    expect(small.extensionsRequired).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("has the same triangles, joints, and clips as the full GLB", () => {
    expect(tris(small)).toBe(tris(full));
    expect(small.skins[0].joints.map((i) => small.nodes[i].name)).toEqual(full.skins[0].joints.map((i) => full.nodes[i].name));
    expect(small.animations.map((a) => a.name).sort()).toEqual(full.animations.map((a) => a.name).sort());
  });
});

describe("skaterModelUrl", () => {
  it("gives the small variant only when asked", () => {
    expect(skaterModelUrl("nia")).toBe(SKATER_MODELS.nia);
    expect(skaterModelUrl("nia", { small: true })).toBe(SKATER_MODELS_SMALL.nia);
    expect(skaterModelUrl("nobody")).toBeNull();
  });
});

describe("the model wrapper", () => {
  it("turns the glTF forward (+z) to the controller forward (+x)", () => {
    const forward = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), MODEL_YAW);
    expect(forward.x).toBeCloseTo(1);
    expect(forward.z).toBeCloseTo(0);
  });
});
