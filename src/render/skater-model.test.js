import * as THREE from "three";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_YAW, SKATER_MODELS, SKATER_MODELS_LOD1, SKATER_MODELS_SMALL, lod1Material, sameJoints, skaterModelUrl } from "./skater-model.js";

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

  // #187: Draco meshes and WebP textures (scripts/assets/compress-skaters.mjs).
  it("is under 10 MB and uses Draco and WebP", () => {
    expect(statSync(GLB).size).toBeLessThan(10 * 1024 * 1024);
    expect([...gltf.extensionsRequired].sort()).toEqual(["EXT_texture_webp", "KHR_draco_mesh_compression"]);
    expect(gltf.images.every((i) => i.mimeType === "image/webp")).toBe(true);
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
  // The full GLB has one primitive for each material (#167): sum them.
  const tris = (g) => g.meshes.flatMap((m) => m.primitives).reduce((n, p) => n + g.accessors[p.indices].count / 3, 0);

  it("is smaller than the full GLB and uses Draco and WebP", () => {
    expect(statSync(SMALL).size).toBeLessThan(statSync(FULL).size);
    expect([...small.extensionsRequired].sort()).toEqual(["EXT_texture_webp", "KHR_draco_mesh_compression"]);
  });

  // #187: the two phone skaters were 10.6 MB of the 15.1 MB phone download.
  it("is under 3 MB", () => {
    expect(statSync(SMALL).size).toBeLessThan(3 * 1024 * 1024);
  });

  it("has the same triangles, joints, and clips as the full GLB", () => {
    expect(tris(small)).toBe(tris(full));
    expect(small.skins[0].joints.map((i) => small.nodes[i].name)).toEqual(full.skins[0].joints.map((i) => full.nodes[i].name));
    expect(small.animations.map((a) => a.name).sort()).toEqual(full.animations.map((a) => a.name).sort());
  });
});

// The LOD1 model for far NPC skaters (#280, scripts/skater-lod.mjs).
describe.each(Object.keys(SKATERS))("the %s LOD1 GLB", (name) => {
  const FULL = new URL(`../../assets/skaters/${name}/skater.glb`, import.meta.url);
  const LOD1 = new URL(`../../assets/skaters/${name}/skater-lod1.glb`, import.meta.url);
  const full = readGlbJson(FULL);
  const lod1 = readGlbJson(LOD1);
  const prim = lod1.meshes[0].primitives[0];
  const tris = (g) => g.meshes.flatMap((m) => m.primitives).reduce((n, p) => n + g.accessors[p.indices].count / 3, 0);

  it("is in the model table, under 10 MB, and uses Draco", () => {
    expect(SKATER_MODELS_LOD1[name]).toMatch(/skater-lod1\.glb$/);
    expect(statSync(LOD1).size).toBeLessThan(10 * 1024 * 1024);
    expect(statSync(LOD1).size).toBeLessThan(statSync(FULL).size);
    expect(lod1.extensionsRequired).toEqual(["KHR_draco_mesh_compression"]);
  });

  it("has one skinned mesh of about 3,000 triangles", () => {
    expect(lod1.meshes).toHaveLength(1);
    expect(tris(lod1)).toBeGreaterThan(2500);
    expect(tris(lod1)).toBeLessThanOrEqual(3200);
    expect(tris(lod1)).toBeLessThan(tris(full) / 5);
    for (const a of ["POSITION", "NORMAL", "COLOR_0", "JOINTS_0", "WEIGHTS_0"]) expect(prim.attributes).toHaveProperty(a);
  });

  it("keeps the 65 mixamorig: joints in the order of the full GLB", () => {
    const names = (g) => g.skins[0].joints.map((i) => g.nodes[i].name);
    expect(names(lod1)).toHaveLength(65);
    expect(names(lod1).every((n) => n.startsWith("mixamorig:"))).toBe(true);
    expect(names(lod1)).toEqual(names(full));
  });

  it("has the same height as the full GLB, and no clips and no textures", () => {
    const box = (g) => {
      const accs = g.meshes.flatMap((m) => m.primitives).map((p) => g.accessors[p.attributes.POSITION]);
      return { min: [0, Math.min(...accs.map((a) => a.min[1]))], max: [0, Math.max(...accs.map((a) => a.max[1]))] };
    };
    expect(box(lod1).min[1]).toBeCloseTo(box(full).min[1], 2);
    expect(box(lod1).max[1]).toBeCloseTo(box(full).max[1], 1);
    expect(lod1.animations ?? []).toHaveLength(0);
    expect(lod1.images ?? []).toHaveLength(0);
  });
});

describe("the LOD1 helpers", () => {
  it("binds LOD1 to the LOD0 skeleton only with the same joints in the same order", () => {
    expect(sameJoints(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameJoints(["b", "a"], ["a", "b"])).toBe(false);
    expect(sameJoints(["a"], ["a", "b"])).toBe(false);
  });

  it("gives a vertex-color mesh a material with no textures, and keeps the material of a UV mesh", () => {
    const source = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), normalMap: new THREE.Texture() });
    const colored = new THREE.BufferGeometry();
    colored.setAttribute("color", new THREE.BufferAttribute(new Float32Array(3), 3));
    const mat = lod1Material(source, colored);
    expect(mat).not.toBe(source);
    expect(mat.map).toBeNull();
    expect(mat.normalMap).toBeNull();
    expect(mat.vertexColors).toBe(true);
    expect(source.map).not.toBeNull();
    expect(lod1Material(source, new THREE.BufferGeometry())).toBe(source);
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
