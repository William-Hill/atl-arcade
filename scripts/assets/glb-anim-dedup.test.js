import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dedupAnimationAccessors, dedupGlbAnimations, parseGlb, writeGlb } from "./glb-anim-dedup.js";

// A small GLB: one mesh (POSITION and indices), a skin, and one clip with
// three channels. Two channels have the same key times; two have the same
// values.
function sample() {
  const f32 = (...v) => new Uint8Array(new Float32Array(v).buffer);
  const parts = [
    f32(0, 0, 0, 1, 0, 0, 0, 1, 0), // 0 POSITION
    new Uint8Array(new Uint16Array([0, 1, 2, 0]).buffer), // 1 indices (padded to 8 bytes)
    f32(...new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0))), // 2 inverse bind
    f32(0, 1), // 3 times A
    f32(0, 1), // 4 times A again
    f32(0, 0.5), // 5 times B
    f32(1, 2, 3, 4, 5, 6), // 6 translation values
    f32(1, 2, 3, 4, 5, 6), // 7 same values
    f32(1, 1, 1, 2, 2, 2), // 8 scale values
  ];
  const views = [];
  let offset = 0;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength });
    offset += p.byteLength;
  }
  const bin = new Uint8Array(offset);
  offset = 0;
  for (const p of parts) {
    bin.set(p, offset);
    offset += p.byteLength;
  }
  const acc = (bufferView, type, count, componentType = 5126) => ({ bufferView, type, count, componentType });
  const json = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: views,
    accessors: [
      acc(0, "VEC3", 3),
      { ...acc(1, "SCALAR", 3, 5123) },
      acc(2, "MAT4", 1),
      { ...acc(3, "SCALAR", 2), min: [0], max: [1] },
      { ...acc(4, "SCALAR", 2), min: [0], max: [1] },
      { ...acc(5, "SCALAR", 2), min: [0], max: [0.5] },
      acc(6, "VEC3", 2),
      acc(7, "VEC3", 2),
      acc(8, "VEC3", 2),
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0, skin: 0 }, { name: "j" }],
    skins: [{ joints: [1], inverseBindMatrices: 2 }],
    animations: [
      {
        name: "clip",
        samplers: [
          { input: 3, output: 6, interpolation: "LINEAR" },
          { input: 4, output: 7, interpolation: "LINEAR" },
          { input: 5, output: 8, interpolation: "LINEAR" },
        ],
        channels: [
          { sampler: 0, target: { node: 1, path: "translation" } },
          { sampler: 1, target: { node: 1, path: "translation" } },
          { sampler: 2, target: { node: 1, path: "scale" } },
        ],
      },
    ],
  };
  return { json, bin };
}

// The key times and values of every sampler, as numbers.
function samplerData(json, bin) {
  const read = (i) => {
    const a = json.accessors[i];
    const bv = json.bufferViews[a.bufferView];
    return [...new Float32Array(bin.slice(bv.byteOffset + (a.byteOffset ?? 0), bv.byteOffset + (a.byteOffset ?? 0) + a.count * 4 * { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]).buffer)];
  };
  return json.animations.flatMap((an) => an.samplers.map((s) => [read(s.input), read(s.output)]));
}

describe("dedupAnimationAccessors (#413)", () => {
  it("merges the accessors with the same bytes and keeps every key", () => {
    const { json, bin } = sample();
    const { json: out, before, after } = dedupAnimationAccessors(json, bin);
    expect(before).toBe(9);
    expect(after).toBe(7);
    expect(out.animations[0].samplers[0].input).toBe(out.animations[0].samplers[1].input);
    expect(out.animations[0].samplers[0].output).toBe(out.animations[0].samplers[1].output);
    expect(out.animations[0].samplers[2].input).not.toBe(out.animations[0].samplers[0].input);
    expect(samplerData(out, bin)).toEqual(samplerData(json, bin));
  });

  it("renumbers the mesh and skin references and does not change the input", () => {
    const { json, bin } = sample();
    const copy = structuredClone(json);
    const { json: out } = dedupAnimationAccessors(json, bin);
    expect(json).toEqual(copy);
    const prim = out.meshes[0].primitives[0];
    expect(out.accessors[prim.attributes.POSITION]).toEqual(json.accessors[0]);
    expect(out.accessors[prim.indices]).toEqual(json.accessors[1]);
    expect(out.accessors[out.skins[0].inverseBindMatrices]).toEqual(json.accessors[2]);
  });

  it("refuses a GLB with an extension that can point at an accessor", () => {
    const { json, bin } = sample();
    json.extensionsUsed = ["EXT_mesh_gpu_instancing"];
    expect(() => dedupAnimationAccessors(json, bin)).toThrow(/EXT_mesh_gpu_instancing/);
  });

  it("writes a GLB that reads back with the same binary chunk", () => {
    const { json, bin } = sample();
    const glb = writeGlb({ json, bin });
    const { bytes } = dedupGlbAnimations(glb);
    const back = parseGlb(bytes);
    expect([...back.bin]).toEqual([...bin]);
    expect(back.json.accessors).toHaveLength(7);
    expect(bytes.byteLength % 4).toBe(0);
  });
});

describe("the shipped skater GLBs (#413)", () => {
  for (const path of ["nia/skater.glb", "nia/skater-1024.glb", "marcus/skater.glb", "marcus/skater-1024.glb"]) {
    it(`${path}: no two animation accessors hold the same bytes`, () => {
      const bytes = new Uint8Array(readFileSync(new URL(`../../assets/skaters/${path}`, import.meta.url)));
      const { before, after } = dedupGlbAnimations(bytes);
      expect(after).toBe(before);
    });
  }
});
