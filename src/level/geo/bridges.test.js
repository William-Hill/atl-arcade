// Bridge joints (issue #131): the deck meets its approach road with one
// edge, no terrain shows through a deck, the parapets end at wing walls,
// the center lines run on across each joint, and the skater rolls across.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { JOINT_SHIFT, approachTrims, bridgeLayouts, cumulative, parapetRuns, project, ribbonEdges, trimPolyline } from "./bridges.js";
import { BRIDGE, bridgeDeck, createTerrain, drapeMesh, gradeBridgeEnds, parapetBlocked, terrainOf } from "./terrain.js";
import { bridgeMeshes } from "./geo-mesh.js";
import { createGeoGroundSampler, surfaceTop } from "./geo-ground.js";
import { roadMarkings } from "./markings.js";
import { createSkateState, stepSkate, yawFromHeading } from "../../sim/skate/controller.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const layouts = bridgeLayouts(LEVEL.strips);
const terrain = terrainOf(LEVEL);

// Each end of each bridge with an approach road: { L, k, J, n, u }. u points
// from J in toward the span, and n across the road.
function joints() {
  const out = [];
  for (const L of layouts.values()) {
    for (const k of [0, 1]) {
      if (!L.ends[k].approach) continue;
      const P = L.points;
      const [J, next] = k ? [P[P.length - 1], P[P.length - 2]] : [P[0], P[1]];
      const l = Math.hypot(next[0] - J[0], next[1] - J[1]);
      const u = [(next[0] - J[0]) / l, (next[1] - J[1]) / l];
      out.push({ L, k, J, u, n: [-u[1], u[0]] });
    }
  }
  return out;
}

describe("the bridge layout", () => {
  it("puts each joint on the approach road, past the OSM end", () => {
    const named = { w156324725: "Parkway", w41545424: "Highland", w41545414: "Randolph" };
    for (const id of Object.keys(named)) {
      const L = layouts.get(id);
      for (const e of L.ends) {
        expect(e.approach, id).not.toBeNull();
        expect(e.shift).toBeGreaterThan(1);
        expect(e.shift).toBeLessThanOrEqual(JOINT_SHIFT);
      }
    }
    expect(joints().length).toBeGreaterThanOrEqual(40);
  });

  it("puts a sidewalk bridge and a second carriageway on the deck line of the wider bridge", () => {
    expect(layouts.get("w638312733").host).toBe("w41545424");
    expect(layouts.get("w638316223").host).toBe("w41545424");
    expect(layouts.get("w638312730").host).toBe("w41545414");
    expect(layouts.get("w29094065").host).toBe("w156324725");
    expect(layouts.get("w41545424").host).toBeNull();
  });

  it("measures the place along a polyline with no jump on the inside of a turn", () => {
    const pts = [
      [0, 0],
      [10, 0],
      [20, 5],
    ];
    const cum = cumulative(pts);
    // Walk across the turn 3 m inside it: s never jumps.
    let prev = null;
    for (let x = 6; x <= 14; x += 0.01) {
      const z = 3 + (x - 10) * 0.25;
      const { s } = project(pts, cum, x, z);
      if (prev !== null) expect(Math.abs(s - prev)).toBeLessThan(0.05);
      prev = s;
    }
    // Past the ends, s goes on in a straight line.
    expect(project(pts, cum, -4, 1).s).toBeCloseTo(-4, 6);
  });

  it("miters a ribbon so each edge stays the half width from each segment", () => {
    const pts = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const { left, right } = ribbonEdges(pts, 2);
    expect(left[1][0]).toBeCloseTo(8, 6);
    expect(left[1][1]).toBeCloseTo(2, 6);
    expect(right[1][0]).toBeCloseTo(12, 6);
    expect(right[1][1]).toBeCloseTo(-2, 6);
  });
});

describe("terrain grade at a bridge joint", () => {
  it("makes the ground level across the road at the joint on a cross slope", () => {
    // 1 m of cross slope per 8 m cell, across a bridge along x.
    const cols = 30;
    const rows = 12;
    const heights = [];
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) heights.push(j * 1 + i * 0.05);
    const grid = { cell: 8, x0: -120, z0: -44, cols, rows, heights: Float32Array.from(heights) };
    const strips = [
      { id: "a", kind: "street", width: 10, points: [[-110, 0], [-20, 0]] },
      { id: "b", kind: "street", width: 10, bridge: true, points: [[-20, 0], [20, 0]] },
      { id: "c", kind: "street", width: 10, points: [[20, 0], [110, 0]] },
    ];
    const t = createTerrain({ ...grid, heights: gradeBridgeEnds(grid, strips).heights });
    const L = bridgeLayouts(strips).get("b");
    for (const J of [L.points[0], L.points[L.points.length - 1]]) {
      const mid = t.height(J[0], 0);
      for (const z of [-5, -2.5, 2.5, 5]) expect(Math.abs(t.height(J[0], z) - mid)).toBeLessThan(0.005);
    }
  });
});

describe("bridge joints on the BeltLine level", () => {
  const sample = createGeoGroundSampler(LEVEL);

  it("meets the approach road at each joint with no step over 2 cm", () => {
    for (const { L, J, n } of joints()) {
      const deck = bridgeDeck(LEVEL, L.strip);
      const r = L.width / 2;
      for (let o = -r; o <= r + 1e-9; o += r / 4) {
        const x = J[0] + n[0] * o;
        const z = J[1] + n[1] * o;
        // The approach road is on the ground; the deck end must be too.
        expect(Math.abs(deck(x, z) - terrain.height(x, z)), `${L.id} at ${o.toFixed(1)}`).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("puts the deck mesh edge at each joint on the ground", () => {
    for (const L of layouts.values()) {
      const { deck } = bridgeMeshes(LEVEL, L.strip);
      const top = surfaceTop(LEVEL, L.strip.kind);
      const ends = [0, 1].filter((k) => L.ends[k].approach).map((k) => (k ? L.points[L.points.length - 1] : L.points[0]));
      let checked = 0;
      for (let i = 0; i < deck.positions.length; i += 3) {
        const [x, y, z] = [deck.positions[i], deck.positions[i + 1], deck.positions[i + 2]];
        if (!ends.some((J) => Math.abs(project(L.points, L.cum, x, z).s - (J === L.points[0] ? 0 : L.total)) < 0.01)) continue;
        expect(Math.abs(y - top - terrain.height(x, z)), L.id).toBeLessThanOrEqual(0.02);
        checked += 1;
      }
      if (ends.length) expect(checked, L.id).toBeGreaterThan(0);
    }
  });

  it("stops the approach road mesh at the joint, with the same width", () => {
    const trims = approachTrims(LEVEL.strips);
    for (const { L, k, J } of joints()) {
      const e = L.ends[k];
      const a = LEVEL.strips.find((s) => s.id === e.approach);
      const pts = trimPolyline(a.points, trims.get(a.id));
      // A short approach can be all under the run-on; then nothing is left.
      if (!pts) continue;
      const end = e.approachAtStart ? pts[0] : pts[pts.length - 1];
      expect(Math.hypot(end[0] - J[0], end[1] - J[1]), `${L.id} ${a.id}`).toBeLessThan(0.01);
      expect(a.width).toBeCloseTo(L.width, 6);
    }
  });

  it("shows no terrain through a deck, from joint to joint", () => {
    for (const L of layouts.values()) {
      const deck = bridgeDeck(LEVEL, L.strip);
      const top = surfaceTop(LEVEL, L.strip.kind);
      for (let a = 0; a <= L.total; a += 0.5) {
        const { p, n } = frameAt(L, a);
        const r = L.width / 2 - 0.05;
        for (const [x, z] of [p, [p[0] + n[0] * r, p[1] + n[1] * r], [p[0] - n[0] * r, p[1] - n[1] * r]]) {
          expect(terrain.height(x, z) + (LEVEL.surfaces.ground ?? 0), `${L.id} at ${a}`).toBeLessThan(deck(x, z) + top);
        }
      }
    }
  });

  it("ends each parapet at an end post and a wing wall off the road", () => {
    for (const L of layouts.values()) {
      for (const k of [1, -1]) {
        for (const run of parapetRuns(LEVEL, L.strip, k, BRIDGE.parapetWidth, parapetBlocked(LEVEL, L.strip))) {
          // A run either ends at an OSM end (with a wing wall) or at the edge
          // of another deck (a sidewalk bridge), never in the open road.
          for (const [i, p] of [[run.from, run.points[0]], [run.to, run.points[run.points.length - 1]]]) {
            const atEnd = i === 0 || i === run.last;
            if (!atEnd) continue;
            const s = project(L.points, L.cum, p[0], p[1]).s;
            expect(Math.min(Math.abs(s - L.span[0]), Math.abs(s - L.span[1])), L.id).toBeLessThan(0.01);
          }
        }
      }
      const { structure } = bridgeMeshes(LEVEL, L.strip);
      // The wing walls reach off the road: some structure vertex is past the
      // deck edge, out beyond the OSM end.
      let off = 0;
      for (let i = 0; i < structure.positions.length; i += 3) {
        const { s, d } = project(L.points, L.cum, structure.positions[i], structure.positions[i + 2]);
        if ((s < L.span[0] - 1 || s > L.span[1] + 1) && d > L.width / 2 + 0.5) off += 1;
      }
      const runs = [1, -1].flatMap((k) => parapetRuns(LEVEL, L.strip, k, BRIDGE.parapetWidth, parapetBlocked(LEVEL, L.strip)));
      if (runs.some((r) => r.from === 0 || r.to === r.last)) expect(off, L.id).toBeGreaterThan(0);
    }
  });

  it("puts no parapet inside a sidewalk deck next to a road deck", () => {
    // Highland Ave NE: the north sidewalk bridge touches the road deck, so
    // the road has no parapet on that side. The sidewalk keeps its outer one.
    const road = layouts.get("w41545424");
    const walk = layouts.get("w638312733");
    for (const k of [1, -1]) {
      for (const run of parapetRuns(LEVEL, road.strip, k, BRIDGE.parapetWidth, parapetBlocked(LEVEL, road.strip))) {
        for (let i = 0; i < run.points.length - 1; i += 1) {
          const x = (run.points[i][0] + run.points[i + 1][0]) / 2;
          const z = (run.points[i][1] + run.points[i + 1][1]) / 2;
          const { n } = frameAt(road, project(road.points, road.cum, x, z).s);
          const o = (road.width / 2 - BRIDGE.parapetWidth / 2) * k;
          const q = project(walk.points, walk.cum, x + n[0] * o, z + n[1] * o);
          expect(q.d).toBeGreaterThan(walk.width / 2);
        }
      }
    }
    expect(parapetRuns(LEVEL, walk.strip, 1, BRIDGE.parapetWidth, parapetBlocked(LEVEL, walk.strip)).length + parapetRuns(LEVEL, walk.strip, -1, BRIDGE.parapetWidth, parapetBlocked(LEVEL, walk.strip)).length).toBe(1);
  });

  it("runs the center line across each joint with no kink and no gap", () => {
    // The view drapes the road lines on the terrain; the deck lines come at their height.
    const m = { positions: [] };
    for (const t of roadMarkings(LEVEL)) {
      for (const part of t.deck ? [drapeMesh(t.mesh, terrain), t.deck] : [drapeMesh(t.mesh, terrain)]) for (const v of part.positions) m.positions.push(v);
    }
    const parkway = layouts.get("w156324725");
    for (const k of [0, 1]) {
      const J = k ? parkway.points[parkway.points.length - 1] : parkway.points[0];
      // Yellow line vertices within 0.5 m of each side of the joint, on the line.
      let before = 0;
      let after = 0;
      for (let i = 0; i < m.positions.length; i += 3) {
        const [x, y, z] = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
        const d = Math.hypot(x - J[0], z - J[1]);
        if (d > 1) continue;
        const { s, d: off } = project(parkway.points, parkway.cum, x, z);
        if (off > 0.3) continue;
        // On the deck side or the road side of the joint, at the road height.
        if ((k === 0 && s >= 0) || (k === 1 && s <= parkway.total)) after += 1;
        else before += 1;
        expect(Math.abs(y - (terrain.height(x, z) + LEVEL.surfaces.street + 0.02)), `y at ${x},${z}`).toBeLessThan(0.03);
      }
      expect(before, `road line at joint ${k}`).toBeGreaterThan(0);
      expect(after, `deck line at joint ${k}`).toBeGreaterThan(0);
    }
  });

  it("rolls the skater across each joint of each bridge with no bonk and no fall", () => {
    const failures = [];
    let rolls = 0;
    for (const { L, k, J, u, n } of joints()) {
      const half = L.width / 2;
      // The middle, and each side clear of the parapet by the body radius.
      const side = half - BRIDGE.parapetWidth - 0.6;
      for (const o of [0, side, -side]) {
        for (const dir of [1, -1]) {
          // From 5 m out on the road to 5 m in on the deck (or to the OSM
          // end, where the deck can turn), and back.
          const inward = Math.min(5, L.ends[k].shift);
          const start = dir === 1 ? -5 : inward;
          const x0 = J[0] + u[0] * start + n[0] * o;
          const z0 = J[1] + u[1] * start + n[1] * o;
          const g = sample(x0, z0, Infinity);
          if (![L.id, L.ends[0].approach, L.ends[1].approach].includes(g.id)) continue;
          let s = createSkateState({ position: [x0, g.height, z0], yaw: yawFromHeading(u[0] * dir, u[1] * dir) });
          s.speed = 6;
          let bad = null;
          // 5 m past the joint at 6 m/s.
          const steps = Math.round(((dir === 1 ? 5 + inward : inward + 5) / 6) * 60);
          for (let i = 0; i < steps && !bad; i += 1) {
            s = stepSkate(s, {}, 1 / 60, { sampleGround: sample });
            if (s.bonked) bad = "bonk";
            else if (s.state === "air") bad = `air (${s.airFrom})`;
          }
          rolls += 1;
          if (bad) failures.push(`${L.id} offset ${o.toFixed(1)} dir ${dir}: ${bad}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(rolls).toBeGreaterThan(150);
  }, 30000);
});

// The point p at length a along a bridge layout, and the normal n there.
function frameAt(L, a) {
  const P = L.points;
  let i = 0;
  while (i < P.length - 2 && L.cum[i + 1] < a) i += 1;
  const l = L.cum[i + 1] - L.cum[i] || 1;
  const k = (a - L.cum[i]) / l;
  const d = [(P[i + 1][0] - P[i][0]) / l, (P[i + 1][1] - P[i][1]) / l];
  return { p: [P[i][0] + d[0] * k * l, P[i][1] + d[1] * k * l], n: [-d[1], d[0]] };
}
