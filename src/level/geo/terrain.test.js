import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIDGE_CLEARANCE, PLINTH_DEPTH, bridgeDeck, buildingSpan, bridgeMiddle, createTerrain, decodeHeights, drapeMesh, encodeHeights, gradeTrail, raiseEmbankments, terrainOf } from "./terrain.js";
import { flatPolygon, stripMesh } from "./extrude.js";
import { createGeoGroundSampler } from "./geo-ground.js";
import { createSkateState, stepSkate } from "../../sim/skate/controller.js";

const LEVEL = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));

// A 5 x 5 grid of 10 m cells: a bowl, so no terrain triangle is flat.
function bowl() {
  const heights = [];
  for (let j = 0; j < 5; j += 1) for (let i = 0; i < 5; i += 1) heights.push(0.2 * ((i - 2) ** 2 + (j - 1.5) ** 2));
  return createTerrain({ cell: 10, x0: 0, z0: 0, cols: 5, rows: 5, heights });
}

describe("terrain", () => {
  it("packs and unpacks the heights to the cm", () => {
    const h = [0, 1.23, 50.51, 12.34, -3.5];
    const back = Array.from(decodeHeights(encodeHeights(h), h.length));
    back.forEach((v, i) => expect(v).toBeCloseTo(h[i], 2));
  });

  it("matches the grid at the nodes and is linear inside each triangle", () => {
    const t = bowl();
    expect(t.height(20, 10)).toBeCloseTo(0.2 * 0.25);
    // The mid point of the diagonal of a cell is the mean of its two ends.
    expect(t.height(15, 15)).toBeCloseTo((t.height(20, 10) + t.height(10, 20)) / 2, 6);
    const n = t.normal(3, 3);
    expect(Math.hypot(...n)).toBeCloseTo(1);
    expect(n[1]).toBeGreaterThan(0);
  });

  it("drapes a flat polygon so every point keeps its offset over the terrain", () => {
    const t = bowl();
    const flat = flatPolygon([[2, 3], [37, 5], [33, 36], [4, 31]], [], 0.05, { color: [1, 0, 0] });
    const d = drapeMesh(flat, t);
    expect(d.indices.length).toBeGreaterThan(flat.indices.length);
    expect(d.colors.length).toBe(d.positions.length);
    // The mid point of each triangle edge (not only the vertices) is on the terrain plus 5 cm.
    for (let k = 0; k < d.indices.length; k += 3) {
      for (let e = 0; e < 3; e += 1) {
        const a = d.indices[k + e];
        const b = d.indices[k + ((e + 1) % 3)];
        const x = (d.positions[a * 3] + d.positions[b * 3]) / 2;
        const y = (d.positions[a * 3 + 1] + d.positions[b * 3 + 1]) / 2;
        const z = (d.positions[a * 3 + 2] + d.positions[b * 3 + 2]) / 2;
        expect(y).toBeCloseTo(t.height(x, z) + 0.05, 4);
      }
    }
  });

  it("drapes the curb walls of a sidewalk with no gap under the top", () => {
    const t = bowl();
    const d = drapeMesh(stripMesh([[3, 5], [36, 31]], 3, 0.15, { curb: true, color: [1, 1, 1] }), t);
    for (let i = 0; i < d.positions.length; i += 3) {
      const g = t.height(d.positions[i], d.positions[i + 2]);
      const dy = d.positions[i + 1] - g;
      // Each vertex is between the curb foot (on the ground) and the top (15 cm over it).
      expect(dy).toBeGreaterThan(-1e-4);
      expect(dy).toBeLessThan(0.15 + 1e-4);
    }
  });

  it("raises an embankment so a bridge clears the way under it", () => {
    const heights = new Array(21 * 21).fill(0);
    const grid = { cell: 4, x0: -40, z0: -40, cols: 21, rows: 21, heights };
    const strips = [
      { id: "b", kind: "trail", width: 4, bridge: true, points: [[-10, 0], [10, 0]] },
      { id: "road", kind: "street", width: 10, points: [[0, -40], [0, 40]] },
    ];
    const r = raiseEmbankments(grid, strips);
    expect(r.changes.map((c) => c.id)).toEqual(["b", "b"]);
    const t = createTerrain({ ...grid, heights: r.heights });
    expect(t.height(-10, 0)).toBeCloseTo(BRIDGE_CLEARANCE, 1);
    expect(t.height(10, 0)).toBeCloseTo(BRIDGE_CLEARANCE, 1);
    // The road under the span keeps its grade.
    expect(t.height(0, 0)).toBeCloseTo(0, 6);
    expect(t.height(0, 20)).toBeCloseTo(0, 6);
    // The embankment falls back toward the terrain.
    expect(t.height(-38, 0)).toBeLessThan(t.height(-24, 0));
    expect(t.height(-24, 0)).toBeLessThan(t.height(-12, 0));
  });
});

describe("gradeTrail under a bridge with more than two points (#59)", () => {
  const bridge = { id: "b", kind: "trail", width: 4, bridge: true, points: [[-8, 0], [0, 0], [8, 0]] };

  it("finds the middle half along the full bridge length, not each segment", () => {
    const cum = [0, 8, 16];
    // The inner joint is at the middle of the bridge.
    expect(bridgeMiddle(bridge, cum, 16, 0, 0)).toBe(true);
    expect(bridgeMiddle(bridge, cum, 16, -3, 1)).toBe(true);
    // The ends sit on the approach grade.
    expect(bridgeMiddle(bridge, cum, 16, -7, 0)).toBe(false);
    expect(bridgeMiddle(bridge, cum, 16, 7, 0)).toBe(false);
    // Too far to the side.
    expect(bridgeMiddle(bridge, cum, 16, 0, 5)).toBe(false);
  });

  it("keeps the ground under the inner joint of the deck", () => {
    // Flat ground at 10 m, with a road cut to 0 m along x = 0 under the bridge.
    const cols = 41;
    const rows = 21;
    const heights = [];
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights.push(Math.abs(-80 + i * 4) <= 4 ? 0 : 10);
    const grid = { cell: 4, x0: -80, z0: -40, cols, rows, heights };
    const strips = [
      { id: "west", kind: "trail", width: 4, points: [[-80, 0], [-8, 0]] },
      bridge,
      { id: "east", kind: "trail", width: 4, points: [[8, 0], [80, 0]] },
    ];
    const graded = gradeTrail(grid, strips).heights;
    const at = (x, z) => graded[((z + 40) / 4) * cols + (x + 80) / 4];
    expect(at(0, 0)).toBe(0);
    // Far from the trail and on the at-grade trail, the ground stays.
    expect(at(0, -36)).toBe(0);
    expect(at(-60, 0)).toBeCloseTo(10, 6);
  });
});

describe("terrain on the BeltLine level", () => {
  const t = terrainOf(LEVEL);
  const bridges = LEVEL.strips.filter((s) => s.bridge);
  const sample = createGeoGroundSampler(LEVEL);

  it("has the USGS terrain, with real relief", () => {
    expect(t.flat).toBe(false);
    let lo = Infinity;
    let hi = -Infinity;
    for (let x = -480; x <= 480; x += 40) {
      for (let z = -960; z <= 960; z += 40) {
        lo = Math.min(lo, t.height(x, z));
        hi = Math.max(hi, t.height(x, z));
      }
    }
    expect(hi - lo).toBeGreaterThan(30);
  });

  it("puts the trail over Ponce de Leon, North Ave, and Ralph McGill on bridges with headroom", () => {
    const named = (re) => LEVEL.strips.filter((s) => !s.bridge && s.kind === "street" && re.test(s.name ?? ""));
    for (const [id, re] of [["w83291379", /Ponce de Leon/], ["w741961708", /North Avenue/], ["w83291376", /Ralph McGill/]]) {
      const b = bridges.find((s) => s.id === id);
      expect(b?.kind).toBe("trail");
      const deck = bridgeDeck(LEVEL, b);
      const [p, q] = [b.points[0], b.points[b.points.length - 1]];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      expect(deck(...mid) - t.height(...mid), id).toBeGreaterThan(4);
      expect(named(re).length).toBeGreaterThan(0);
    }
  });

  it("puts the skater on the deck from above and on the road from below", () => {
    const b = bridges.find((s) => s.id === "w83291379");
    const [p, q] = [b.points[0], b.points[b.points.length - 1]];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const deckY = bridgeDeck(LEVEL, b)(...mid);
    const over = sample(mid[0], mid[1], deckY + 0.1);
    expect(over.id).toBe(b.id);
    const under = sample(mid[0], mid[1], t.height(...mid) + 0.1);
    expect(under.id).not.toBe(b.id);
    expect(under.height).toBeLessThan(deckY - 3);
  });

  it("speeds the skater up downhill and slows her uphill", () => {
    // A long straight ramp of terrain: 5% grade along +x.
    const heights = [];
    for (let j = 0; j < 3; j += 1) for (let i = 0; i < 60; i += 1) heights.push(-0.05 * i * 4);
    const ramp = { terrain: { cell: 4, x0: 0, z0: -4, cols: 60, rows: 3, data: encodeHeights(heights) }, bounds: { minX: 0, maxX: 236, minZ: -4, maxZ: 4 }, surfaces: { ground: 0 } };
    const env = { sampleGround: createGeoGroundSampler(ramp) };
    const run = (yaw) => {
      let s = createSkateState({ position: [118, env.sampleGround(118, 0).height, 0], yaw });
      s.speed = 5;
      for (let i = 0; i < 60; i += 1) s = stepSkate(s, {}, 1 / 60, env);
      return s.speed;
    };
    // The same roll friction both ways; the grade (20 m/s^2 x 5%) makes 1 m/s^2 of difference each way.
    expect(run(0) - run(Math.PI)).toBeGreaterThan(1.5);
  });
});

describe("buildingSpan on a slope", () => {
  const level = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
  const t = terrainOf(level);
  const along = (ring, step = 1) => {
    const pts = [];
    for (let i = 0; i < ring.length; i += 1) {
      const [px, pz] = ring[i];
      const [qx, qz] = ring[(i + 1) % ring.length];
      const n = Math.max(1, Math.ceil(Math.hypot(qx - px, qz - pz) / step));
      for (let k = 0; k < n; k += 1) pts.push([px + ((qx - px) * k) / n, pz + ((qz - pz) * k) / n]);
    }
    return pts;
  };

  it("keeps the ground floor over the ground along every wall", () => {
    let worst = Infinity;
    for (const b of level.buildings) {
      const s = buildingSpan(level, b);
      for (const [x, z] of along(b.outer)) worst = Math.min(worst, s.base - t.height(x, z));
    }
    // The terrain is linear between the 2 m samples; 1 m samples see at
    // most a few cm more.
    expect(worst).toBeGreaterThan(-0.15);
  });

  it("puts the plinth foot under the ground along every wall", () => {
    for (const b of level.buildings) {
      const s = buildingSpan(level, b);
      for (const [x, z] of along(b.outer)) expect(s.foot).toBeLessThan(t.height(x, z) - PLINTH_DEPTH + 0.15);
      expect(s.top - s.base).toBeCloseTo(b.height, 6);
    }
  });

  it("is flat with no plinth on a level with no terrain", () => {
    const s = buildingSpan({ buildings: [] }, { id: "a", height: 9, outer: [[0, 0], [10, 0], [10, 10]] });
    expect(s).toEqual({ foot: 0, base: 0, ground: 0, top: 9 });
  });
});
