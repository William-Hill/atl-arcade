import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createFacadeKitView, farGeometry, withoutGlass } from "./facade-kit-view.js";

// A quad mesh node whose uvs sit at atlas row `v` (px from the top).
function quad(v) {
  const g = new THREE.PlaneGeometry(1, 1);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i += 1) uv.setY(i, 1 - v / 1024);
  return g;
}
function node(...rows) {
  const g = rows.length === 1 ? quad(rows[0]) : mergeQuads(rows.map(quad));
  return new THREE.Mesh(g, MATERIAL);
}
function mergeQuads(gs) {
  const out = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const nor = [];
  const idx = [];
  for (const g of gs) {
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    uv.push(...g.attributes.uv.array);
    nor.push(...g.attributes.normal.array);
    idx.push(...Array.from(g.index.array, (i) => i + base));
  }
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}
const MATERIAL = new THREE.MeshStandardMaterial();
const NODES = new Map([
  ["window_brick_loft", node(100, 800)], // a frame quad and a glass quad
  ["balcony_slab", node(100, 100)],
  ["balcony_slab_lod1", node(100)],
  ["trim_downspout", node(100)],
  ["trim_sign_board", new THREE.Mesh(mergeQuads([quad(100), quad(100).rotateY(Math.PI / 2), quad(100).rotateY(-Math.PI / 2)]), MATERIAL)],
]);
const at = (module) => ({ module, position: [0, 0, 0], rotationY: 0, scale: [1, 1, 1] });
const BUILDING = { center: [0, 0], radius: 5, list: [at("window_brick_loft"), at("balcony_slab"), at("trim_downspout")], boards: [] };

describe("facade kit view", () => {
  it("cuts the glass panes out of a window", () => {
    expect(withoutGlass(NODES.get("window_brick_loft").geometry).index.count / 3).toBe(2);
    expect(withoutGlass(NODES.get("balcony_slab").geometry).index.count / 3).toBe(4);
  });

  it("keeps the street faces of a module without a _lod1 node past the LOD1 distance", () => {
    expect(farGeometry(NODES.get("trim_sign_board").geometry).index.count / 3).toBe(2);
    const view = createFacadeKitView(NODES, [{ ...BUILDING, list: [at("trim_sign_board")] }], { lod1Distance: 30, trimDistance: 35 });
    view.update({ x: 15, z: 0 });
    expect(view.info.triangles).toBe(6);
    view.update({ x: 45, z: 0 });
    expect(view.info.triangles).toBe(2);
  });

  it("draws every module in one draw call, culled and LOD-switched by building distance", () => {
    const view = createFacadeKitView(NODES, [BUILDING], { depthDistance: 120, lod1Distance: 30, trimDistance: 35 });
    const batch = view.root.children[0];
    expect(batch.isBatchedMesh).toBe(true);
    const at = (d) => {
      view.update({ x: 5 + d, z: 0 });
      return { ...view.info };
    };
    // Near: window frame (2) + LOD0 balcony (4) + downspout (2).
    expect(at(10)).toMatchObject({ shown: 3, drawCalls: 1, triangles: 8, lod1: 0 });
    // LOD1 balcony, the trim still on.
    expect(at(32)).toMatchObject({ shown: 3, triangles: 6, lod1: 1 });
    expect(batch.getGeometryIdAt(1)).not.toBe(batch.getGeometryIdAt(0));
    // Past the trim distance the downspout goes.
    expect(at(60)).toMatchObject({ shown: 2, triangles: 4 });
    expect(batch.getVisibleAt(2)).toBe(false);
    // Past the depth distance, nothing.
    expect(at(130)).toMatchObject({ shown: 0, drawCalls: 0, triangles: 0, near: 0 });
    expect(at(10)).toMatchObject({ shown: 3, triangles: 8 });
  });

  it("shows and hides a building with its procedural depth tile", () => {
    const view = createFacadeKitView(NODES, [{ ...BUILDING, center: [2, 2], radius: 1, tile: [25, 25] }], { depthDistance: 120 });
    // 115 m from the tile center, past 120 m from the building: the depth tile is drawn, so the frames are too.
    view.update({ x: 140, z: 25 });
    expect(view.info.shown).toBeGreaterThan(0);
    view.update({ x: 150, z: 25 });
    expect(view.info.shown).toBe(0);
  });

  it("shows a long building near its far wall, its depth tile out of range", () => {
    const view = createFacadeKitView(NODES, [{ ...BUILDING, center: [0, 0], radius: 100, tile: [275, -175] }], { depthDistance: 120 });
    view.update({ x: -90, z: 0 });
    expect(view.info.shown).toBeGreaterThan(0);
    // Without a tile, by the building distance alone (115 m from its edge).
    const untiled = createFacadeKitView(NODES, [{ ...BUILDING, center: [0, 0], radius: 5 }], { depthDistance: 120 });
    untiled.update({ x: 120, z: 0 });
    expect(untiled.info.shown).toBeGreaterThan(0);
  });
});
