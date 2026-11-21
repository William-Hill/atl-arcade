import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIDGE_CLEARANCE, FOOTPRINT_GRADE, GRADE_LIMIT, PLINTH_DEPTH, WAY_GRADE, bridgeDeck, bridgeNodes, buildingSpan, bridgeMiddle, createTerrain, decodeHeights, drapeMesh, encodeHeights, gradeFootprints, gradeTrail, gradeWays, limitGrade, raiseEmbankments, terrainOf, wayGrades } from "./terrain.js";
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

// Issue #135: a pad under each building on a slope, so the plinths stay low.
describe("gradeFootprints", () => {
  // A 2 m grid that rises 0.2 m per meter along +x (a steep lot).
  const cols = 41;
  const rows = 21;
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights[j * cols + i] = i * 2 * 0.2;
  const grid = { cell: 2, x0: 0, z0: 0, cols, rows, heights };
  const house = { id: "h", outer: [[36, 16], [44, 16], [44, 24], [36, 24]] };
  const span = (h) => {
    const t = createTerrain({ ...grid, heights: h });
    let lo = Infinity;
    let hi = -Infinity;
    for (const [x, z] of [[36, 16], [44, 16], [44, 24], [36, 24], [40, 16], [40, 24]]) {
      lo = Math.min(lo, t.height(x, z));
      hi = Math.max(hi, t.height(x, z));
    }
    return hi - lo;
  };

  it("levels the ground under a building on a slope", () => {
    expect(span(heights)).toBeCloseTo(1.6, 3);
    const { heights: out, graded } = gradeFootprints(grid, [house]);
    expect(graded).toBe(1);
    expect(span(out)).toBeLessThan(0.05);
    // No node moves more than the cap, and the far ground keeps its height.
    for (let k = 0; k < out.length; k += 1) expect(Math.abs(out[k] - heights[k])).toBeLessThanOrEqual(FOOTPRINT_GRADE.cap + 1e-6);
    expect(out[10 * cols + 0]).toBe(heights[10 * cols + 0]);
  });

  it("does not move a node on a way, and skips a flat lot", () => {
    const street = { id: "s", kind: "street", width: 6, points: [[46, 0], [46, 40]] };
    const { heights: out } = gradeFootprints(grid, [house], [street]);
    for (let j = 0; j < rows; j += 1) expect(out[j * cols + 23]).toBe(heights[j * cols + 23]);
    const flat = new Float32Array(cols * rows).fill(3);
    expect(gradeFootprints({ ...grid, heights: flat }, [house]).graded).toBe(0);
  });

  it("keeps the BeltLine plinths low", () => {
    const level = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
    const plinths = level.buildings.map((b) => {
      const s = buildingSpan(level, b);
      return s.base - s.foot;
    });
    plinths.sort((a, b) => a - b);
    // Before the grade: a median of 1.8 m, and 146 plinths over 3 m. The
    // ways win over the lots (gradeWays cuts and fills the ground near the
    // streets), so a few more plinths than the 49 before it go over 3 m.
    expect(plinths[Math.floor(plinths.length / 2)]).toBeLessThan(1.4);
    expect(plinths.filter((p) => p > 3).length).toBeLessThan(65);
  });
});


describe("gradeWays: the playable ways at a skating grade", () => {
  // A 2 m grid with a 47% hump across a street along x (footway w1118177210
  // had ~47% before), and a lawn on the far side.
  const cols = 40;
  const rows = 30;
  const raw = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1) {
      const x = i * 2;
      raw.push(x < 30 ? 0 : x < 40 ? (x - 30) * 0.47 : 4.7);
    }
  }
  const grid = { cell: 2, x0: 0, z0: 0, cols, rows, heights: Float32Array.from(raw) };
  const street = { id: "s", kind: "street", width: 8, points: [[0, 20], [78, 20]] };
  const lawn = { id: "g", kind: "grass", width: 8, points: [[0, 50], [78, 50]] };
  const worst = (heights, strips) => Math.max(...wayGrades(createTerrain({ ...grid, heights }), strips).map((w) => w.grade));

  it("grades a 47% ramp under a street to WAY_GRADE.max", () => {
    expect(worst(grid.heights, [street])).toBeGreaterThan(0.4);
    const out = gradeWays(grid, [street, lawn]);
    expect(worst(out.heights, [street])).toBeLessThanOrEqual(WAY_GRADE.max + 1e-4);
    expect(out.nodes).toBeGreaterThan(0);
  });

  it("cuts and fills inside the old range, and leaves the ground far off the ways", () => {
    const out = gradeWays(grid, [street]);
    for (const h of out.heights) {
      expect(h).toBeGreaterThanOrEqual(-1e-4);
      expect(h).toBeLessThanOrEqual(4.7 + 1e-4);
    }
    // Rows past the network (one cell diagonal) and the blend band are as before.
    const far = Math.ceil((20 + 4 + 2 * Math.SQRT2 + WAY_GRADE.blend) / 2) + 1;
    for (let j = far; j < rows; j += 1) for (let i = 0; i < cols; i += 1) expect(out.heights[j * cols + i]).toBe(grid.heights[j * cols + i]);
  });

  it("is deterministic and does not depend on the order of the strips", () => {
    const side = { id: "w", kind: "sidewalk", width: 3, points: [[40, 0], [40, 58]] };
    const a = gradeWays(grid, [street, side]);
    const b = gradeWays(grid, [side, street]);
    const c = gradeWays(grid, [street, side]);
    expect(Array.from(b.heights)).toEqual(Array.from(a.heights));
    expect(Array.from(c.heights)).toEqual(Array.from(a.heights));
  });

  it("keeps a pinned node (a bridge joint) at its height and grades the way to it", () => {
    const pinned = new Uint8Array(cols * rows);
    const at = 10 * cols + 18;
    pinned[at] = 1;
    const out = gradeWays(grid, [street], { pinned });
    expect(out.heights[at]).toBe(grid.heights[at]);
    expect(worst(out.heights, [street])).toBeLessThanOrEqual(WAY_GRADE.max + 1e-4);
  });

  it("leaves a bridge strip out of the network", () => {
    const deck = { ...street, bridge: true };
    expect(gradeWays(grid, [deck]).nodes).toBe(0);
  });
});

describe("limitGrade", () => {
  it("keeps a gentle normal and bends a steep one to GRADE_LIMIT", () => {
    const gentle = [0.05, Math.sqrt(1 - 0.05 * 0.05), 0];
    expect(limitGrade(gentle)).toBe(gentle);
    const l = Math.hypot(0.47, 1);
    const n = limitGrade([-0.47 / l, 1 / l, 0]);
    expect(Math.hypot(...n)).toBeCloseTo(1, 9);
    expect(-n[0] / n[1]).toBeCloseTo(GRADE_LIMIT, 9);
    expect(n[2]).toBe(0);
    expect(limitGrade([1, 0, 0])).toEqual([1, 0, 0]);
  });

  it("lets the skater push up a 47% terrain ramp that she rolled back down before", () => {
    // 47% grade down along +x on a 4 m grid.
    const heights = [];
    for (let j = 0; j < 3; j += 1) for (let i = 0; i < 60; i += 1) heights.push(-0.47 * i * 4);
    const ramp = { terrain: { cell: 4, x0: 0, z0: -4, cols: 60, rows: 3, data: encodeHeights(heights) }, bounds: { minX: 0, maxX: 236, minZ: -4, maxZ: 4 }, surfaces: { ground: 0 } };
    const env = { sampleGround: createGeoGroundSampler(ramp) };
    expect(env.sampleGround(118, 0).normal[1]).toBeCloseTo(1 / Math.hypot(1, GRADE_LIMIT), 6);
    let s = createSkateState({ position: [118, env.sampleGround(118, 0).height, 0], yaw: Math.PI });
    s.speed = 3;
    const y0 = s.position[1];
    for (let i = 0; i < 180; i += 1) s = stepSkate(s, { push: true }, 1 / 60, env);
    expect(s.state).toBe("rolling");
    expect(Math.cos(s.yaw)).toBeLessThan(-0.99);
    expect(s.position[0]).toBeLessThan(118 - 3);
    expect(s.position[1]).toBeGreaterThan(y0 + 1.5);
  });
});

describe("the BeltLine level at skating grades", () => {
  const level = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../levels/beltline-eastside/level.json"), "utf8"));
  const t = terrainOf(level);
  const pins = bridgeNodes(level.terrain, level.strips);
  const { cell, x0, z0, cols } = level.terrain;
  // The nodes that gradeWays() keeps: the bridge nodes and the trail band.
  const trail = level.strips.filter((s) => s.kind === "trail" && !s.bridge);
  const reach = cell * Math.SQRT2 + 0.01;
  const nearTrail = (x, z) =>
    trail.some((s) =>
      s.points.slice(1).some(([bx, bz], k) => {
        const [ax, az] = s.points[k];
        const dx = bx - ax;
        const dz = bz - az;
        const u = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(x - ax - u * dx, z - az - u * dz) <= s.width / 2 + reach;
      }),
    );
  const nearPin = ([x, z]) => {
    const i = Math.floor((x - x0) / cell);
    const j = Math.floor((z - z0) / cell);
    return [0, 1].some((a) => [0, 1].some((b) => pins[(j + b) * cols + i + a] || nearTrail(x0 + (i + a) * cell, z0 + (j + b) * cell)));
  };

  it("holds every at-grade way off the bridge ends and the trail at WAY_GRADE.max", () => {
    const steep = wayGrades(t, level.strips).filter((w) => w.grade > WAY_GRADE.max + 0.005 && !nearPin(w.at));
    expect(steep.map((w) => `${w.id} ${w.grade.toFixed(3)}`)).toEqual([]);
  });

  it("pins the ground at the ends of each deck, footway w1118177210 among them", () => {
    const s = level.strips.find((q) => q.id === "w1118177210");
    expect(s.bridge).toBe(true);
    for (const [x, z] of s.points) expect(nearPin([x, z])).toBe(true);
  });

  it("lets the skater push up the stair deck w1118177210 onto its footbridge", () => {
    const env = { sampleGround: createGeoGroundSampler(level) };
    const [top, foot] = level.strips.find((q) => q.id === "w1118177210").points;
    const yaw = Math.atan2(-(top[1] - foot[1]), top[0] - foot[0]);
    // A little up the deck from its foot, facing up it.
    const l = Math.hypot(top[0] - foot[0], top[1] - foot[1]);
    const p = [foot[0] + ((top[0] - foot[0]) * 1.5) / l, foot[1] + ((top[1] - foot[1]) * 1.5) / l];
    const g = env.sampleGround(p[0], p[1], t.height(p[0], p[1]) + 1);
    expect(g.id).toBe("w1118177210");
    let s = createSkateState({ position: [p[0], g.height, p[1]], yaw });
    s.speed = 3;
    const y0 = s.position[1];
    // Up the spur and onto the footbridge it comes off, with no step at the joint.
    for (let i = 0; i < 120 && s.groundId !== "w431443668"; i += 1) {
      s = stepSkate(s, { push: true }, 1 / 60, env);
      expect(s.bonked).toBeFalsy();
    }
    expect(s.groundId).toBe("w431443668");
    expect(s.position[1]).toBeGreaterThan(y0 + 1);
  });
});
