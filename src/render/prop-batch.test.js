import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { placeTemplate } from "../level/geo/extrude.js";
import { createPropBatch, fadeLodsFor, placementMatrix, propLodFor } from "./prop-batch.js";

const box = (size, color) => ({
  positions: [0, 0, 0, size, 0, 0, size, size, 0, 0, size, 1],
  indices: [0, 1, 2, 0, 2, 3],
  colors: Array(12).fill(color),
});

describe("propLodFor", () => {
  it("gives LOD0 near, LOD1 in the middle, and -1 past the draw distance", () => {
    expect(propLodFor(0, 60, 200)).toBe(0);
    expect(propLodFor(59.9, 60, 200)).toBe(0);
    expect(propLodFor(60, 60, 200)).toBe(1);
    expect(propLodFor(199.9, 60, 200)).toBe(1);
    expect(propLodFor(200, 60, 200)).toBe(-1);
    expect(propLodFor(Number.NaN, 60, 200)).toBe(-1);
  });
});

describe("placementMatrix", () => {
  it("moves a vertex to the same place as placeTemplate()", () => {
    const template = { positions: [1.5, 2, -0.7, -3, 0.4, 2.2], indices: [0, 1], colors: null };
    const p = { x: 10, y: 2, z: -5, yaw: 0.8, scale: 1.3 };
    const merged = placeTemplate({ positions: [], indices: [] }, template, p);
    const m = new THREE.Matrix4().fromArray(placementMatrix(p));
    for (let i = 0; i < 2; i += 1) {
      const v = new THREE.Vector3().fromArray(template.positions, i * 3).applyMatrix4(m);
      expect(v.x).toBeCloseTo(merged.positions[i * 3], 5);
      expect(v.y).toBeCloseTo(merged.positions[i * 3 + 1], 5);
      expect(v.z).toBeCloseTo(merged.positions[i * 3 + 2], 5);
    }
  });
});

describe("createPropBatch", () => {
  const templates = { bench: box(1, 0.5), bench_lod1: box(1, 0.4), lamp: box(2, 0.9) };
  const placements = [
    { kind: "bench", x: 0, y: 0, z: 0 },
    { kind: "bench", x: 100, y: 0, z: 0 },
    { kind: "lamp", x: 0, y: 0, z: 300 },
    { kind: "street_sign", x: 5, y: 0, z: 5 },
  ];
  const material = new THREE.MeshBasicMaterial();

  it("makes one instance per placement with a template, in one mesh", () => {
    const batch = createPropBatch(placements, templates, material, { lod0Distance: 60, drawDistance: 200 });
    expect(batch.mesh.isBatchedMesh).toBe(true);
    expect(batch.info).toMatchObject({ instances: 3, kinds: 2 });
    expect(batch.mesh.instanceCount).toBe(3);
  });

  it("picks the LOD of each prop by its own distance", () => {
    const batch = createPropBatch(placements, templates, material, { lod0Distance: 60, drawDistance: 200 });
    batch.update({ x: 0, z: 0 });
    expect(batch.info).toMatchObject({ drawn: 2, lod0: 1 });
    expect(batch.mesh.getVisibleAt(0)).toBe(true);
    expect(batch.mesh.getVisibleAt(1)).toBe(true);
    expect(batch.mesh.getVisibleAt(2)).toBe(false);
    // The near bench has the LOD0 shape, the far bench the LOD1 shape.
    expect(batch.mesh.getGeometryIdAt(0)).not.toBe(batch.mesh.getGeometryIdAt(1));
    batch.update({ x: 100, z: 0 });
    expect(batch.mesh.getGeometryIdAt(1)).toBe(0);
    expect(batch.mesh.getGeometryIdAt(0)).toBe(1);
    batch.update({ x: 0, z: 290 });
    expect(batch.info).toMatchObject({ drawn: 1, lod0: 1 });
    expect(batch.mesh.getVisibleAt(2)).toBe(true);
  });

  it("uses the LOD0 shape for both levels when a kind has no LOD1", () => {
    const batch = createPropBatch([{ kind: "lamp", x: 0, y: 0, z: 0 }], templates, material, { lod0Distance: 60, drawDistance: 200 });
    batch.update({ x: 0, z: 0 });
    const near = batch.mesh.getGeometryIdAt(0);
    batch.update({ x: 100, z: 0 });
    expect(batch.mesh.getGeometryIdAt(0)).toBe(near);
    expect(batch.mesh.getVisibleAt(0)).toBe(true);
  });

  it("gives a fading kind a near and a far instance, both shown over the fade band", () => {
    const fade = { band: 10, kinds: ["bench", "lamp"] };
    const batch = createPropBatch(placements, templates, material, { lod0Distance: 60, drawDistance: 200, fade });
    // The lamp has no LOD1, so it does not fade: 2 benches x 2 + 1 lamp.
    expect(batch.mesh.instanceCount).toBe(5);
    expect(batch.info.instances).toBe(3);
    batch.update({ x: -45, z: 0 });
    expect(batch.info).toMatchObject({ drawn: 2, lod0: 1, fading: 0 });
    batch.update({ x: -55, z: 0 });
    // The bench at x 0 is 55 m away: in the band, both shapes.
    expect(batch.info.fading).toBe(1);
    expect(batch.mesh.getVisibleAt(0)).toBe(true);
    expect(batch.mesh.getVisibleAt(1)).toBe(true);
    batch.update({ x: 150, z: 0 });
    expect(batch.mesh.getVisibleAt(0)).toBe(false);
    expect(batch.mesh.getVisibleAt(1)).toBe(true);
  });

  it("colors each placement by tint()", () => {
    const batch = createPropBatch(placements, templates, material, { lod0Distance: 60, drawDistance: 200, tint: (p) => (p.x === 100 ? [0.5, 1, 1] : null) });
    const c = new THREE.Color();
    expect(batch.mesh.getColorAt(1, c).r).toBeCloseTo(0.5);
    expect(batch.mesh.getColorAt(0, c).r).toBeCloseTo(1);
  });
});

describe("fadeLodsFor", () => {
  it("shows the near shape under the LOD distance and the far one from the band start", () => {
    expect(fadeLodsFor(10, 60, 200, 10)).toEqual([true, false]);
    expect(fadeLodsFor(55, 60, 200, 10)).toEqual([true, true]);
    expect(fadeLodsFor(60, 60, 200, 10)).toEqual([false, true]);
    expect(fadeLodsFor(200, 60, 200, 10)).toEqual([false, false]);
  });
});
