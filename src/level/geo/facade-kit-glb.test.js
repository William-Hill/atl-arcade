import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "../../../scripts/assets/facade-kit-placement.js";
import { DEPTH_TILE, facadeKit, frontEdges } from "./facade-kit.js";
import { GLB_SKIP, SIGN_BOARD, boardOf, facadeKitPlacements, kitCovers, underShopSign } from "./facade-kit-glb.js";
import { claimedIds } from "./landmarks.js";
import { shopSigns } from "./shop-signs.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
const FRONTS = frontEdges(LEVEL);
const SIGNS = shopSigns(LEVEL, FRONTS);
const GLB = facadeKitPlacements(LEVEL, FRONTS, { signs: SIGNS });

describe("the GLB facade kit on the BeltLine level", () => {
  it("places only kit modules, and none of the ones the procedural kit keeps", () => {
    expect(GLB.instances).toBeGreaterThan(10000);
    for (const t of GLB.tiles.values())
      for (const it of t.list) {
        expect(MODULES[it.module], it.module).toBeDefined();
        expect(GLB_SKIP.has(it.module), it.module).toBe(false);
      }
  });

  it("puts the modules of a building in the depth tile of its first ring point", () => {
    for (const [key, t] of GLB.tiles) {
      const [i, j] = key.split(",").map(Number);
      expect(t.center).toEqual([(i + 0.5) * DEPTH_TILE, (j + 0.5) * DEPTH_TILE]);
    }
    const count = [...GLB.tiles.values()].reduce((s, t) => s + t.list.length, 0);
    expect(count).toBe(GLB.instances);
    // Each tile carries the shop-name boards of its own GLB sign boards, so the names hide with the tile.
    for (const t of GLB.tiles.values()) expect(t.boards.length).toBe(t.list.filter((it) => it.module === "trim_sign_board").length);
    expect([...GLB.tiles.values()].some((t) => t.boards.length > 0)).toBe(true);
  });

  it("lists the same placements per building, with a center and radius covering its ring", () => {
    expect(GLB.buildings.reduce((s, b) => s + b.list.length, 0)).toBe(GLB.instances);
    expect(GLB.buildings.length).toBe(GLB.covers.size);
    const byId = new Map(LEVEL.buildings.map((b) => [b.id, b]));
    for (const b of GLB.buildings) {
      expect(b.boards.length).toBe(b.list.filter((it) => it.module === "trim_sign_board").length);
      const [x, z] = byId.get(b.id).outer[0];
      expect(b.tile).toEqual([(Math.floor(x / DEPTH_TILE) + 0.5) * DEPTH_TILE, (Math.floor(z / DEPTH_TILE) + 0.5) * DEPTH_TILE]);
      for (const p of byId.get(b.id).outer) expect(Math.hypot(p[0] - b.center[0], p[1] - b.center[1])).toBeLessThanOrEqual(b.radius + 1e-9);
    }
  });

  it("dresses no claimed landmark footprint", () => {
    const claimed = new Set(LEVEL.buildings.slice(0, 50).map((b) => b.id));
    const g = facadeKitPlacements(LEVEL, FRONTS, { signs: SIGNS, claimed });
    for (const id of claimed) expect(g.covers.has(id)).toBe(false);
    for (const id of claimedIds(LEVEL)) expect(GLB.covers.has(id)).toBe(false);
  });

  it("puts no GLB sign board under a shop sign", () => {
    const byId = new Map(SIGNS.map((s) => [s.id, s]));
    let checked = 0;
    for (const b of LEVEL.buildings) {
      const s = byId.get(b.id);
      if (!s || !GLB.covers.has(b.id)) continue;
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
    const sign = { x: 0, z: 0, normal: [0, 1], maxWidth: 4 };
    expect(underShopSign({ position: [2, 3, 0.07] }, sign)).toBe(true);
    expect(underShopSign({ position: [4, 3, 0.07] }, sign)).toBe(false);
    expect(underShopSign({ position: [0, 3, 2] }, sign)).toBe(false);
  });

  it("turns off the procedural sills, lintels, sign bands, and doors it replaces, and keeps the awnings and roof line", () => {
    const all = facadeKit(LEVEL, FRONTS, []).counts;
    const glb = facadeKit(LEVEL, FRONTS, [], undefined, GLB.covers).counts;
    expect(glb.sill).toBeLessThan(all.sill / 3);
    expect(glb.head + glb.lintel).toBeLessThan((all.head + all.lintel) / 3);
    expect(glb.sign).toBeLessThan(all.sign);
    expect(glb.door).toBeLessThan(all.door);
    expect(glb.pier).toBeLessThan(all.pier);
    for (const k of ["awning", "cornice", "coping", "belt", "roof", "crown", "step", "sconce"]) expect(glb[k], k).toBe(all[k]);
  });
});

describe("kitCovers", () => {
  it("lists the window slots, shop bays, pilaster lines, and the door", () => {
    const c = kitCovers([
      { module: "window_brick_loft", wallIndex: 2, floor: 3, bay: 1 },
      { module: "storefront_glass_32", wallIndex: 0, floor: 0, bay: 4 },
      { module: "storefront_door_26", wallIndex: 0, floor: 0, bay: 2 },
      { module: "trim_pilaster", wallIndex: 0, line: 3 },
      { module: "ac_unit_wall", wallIndex: 1 },
    ]);
    expect([...c.sill]).toEqual(["2:3:1"]);
    expect([...c.sign]).toEqual(["0:4", "0:2"]);
    expect([...c.pier]).toEqual(["0:3"]);
    expect(c.door).toBe(true);
    expect(kitCovers([]).door).toBe(false);
  });
});

describe("boardOf", () => {
  it("puts the shop-name panel on the face of the sign board, facing out of the wall", () => {
    const b = boardOf({ position: [10, 4, 5], rotationY: 0 });
    expect(b.nx).toBeCloseTo(0);
    expect(b.nz).toBeCloseTo(1);
    expect(b.z).toBeCloseTo(5 + SIGN_BOARD.depth + 0.004);
    expect(b.y).toBeCloseTo(4 + SIGN_BOARD.center);
    expect(b.w).toBe(SIGN_BOARD.width);
  });
});
