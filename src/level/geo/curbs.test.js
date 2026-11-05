import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CURB, crossingEnds, piecePoints, rampAt, sidewalkLayout } from "./curbs.js";
import { createGeoGroundSampler } from "./geo-ground.js";
import { terrainOf } from "./terrain.js";
import { createLevelEnv } from "../ground.js";
import { createSkater, createSkaterEnv, stepSkater } from "../../sim/skate/skater.js";
import { benchLedges } from "./grindables.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
const DT = 1 / 60;

describe("curb ramps on a small level", () => {
  // A sidewalk that goes across a street, and a sidewalk along it.
  const level = {
    surfaces: { ground: 0, street: 0.03, sidewalk: 0.15 },
    bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 },
    strips: [
      { id: "st", kind: "street", highway: "residential", name: "A St", width: 8, points: [[-60, 0], [60, 0]] },
      { id: "across", kind: "sidewalk", width: 2, points: [[20, -30], [20, 30]] },
      { id: "along", kind: "sidewalk", width: 2, points: [[-60, 6], [60, 6]] },
    ],
    crossings: [{ id: "wc", points: [[-10, -5], [-10, 5]], marked: true }],
  };
  const lay = sidewalkLayout(level);

  it("cuts a sidewalk where it goes across a street, with an end ramp on each side", () => {
    const a = lay.get("across");
    expect(a.cuts).toHaveLength(1);
    const [c0, c1] = a.cuts[0];
    // The street is 8 m wide: the cut is from z -4 to 4 (30 - 4 = 26 m along).
    expect(c0).toBeCloseTo(26, 0);
    expect(c1).toBeCloseTo(34, 0);
    const ends = a.ramps.filter((r) => r.kind === "end");
    expect(ends).toHaveLength(2);
    for (const r of ends) {
      expect(r.s1 - r.s0).toBeCloseTo(CURB.ramp, 6);
      // The slope is 8% or less.
      expect((r.h0 - r.h1) / CURB.ramp).toBeLessThanOrEqual(0.084);
    }
    // No piece of the sidewalk is on the street.
    for (const range of a.pieces) for (const [, z] of piecePoints(level.strips[1].points, range)) expect(Math.abs(z)).toBeGreaterThanOrEqual(4 + CURB.ramp - 1e-6);
  });

  it("keeps a sidewalk that runs along the street, and gives it a cross ramp at the crossing", () => {
    const a = lay.get("along");
    expect(a.cuts).toHaveLength(0);
    const cross = a.ramps.filter((r) => r.kind === "cross");
    expect(cross).toHaveLength(1);
    expect(cross[0].source).toBe("wc");
    // The ramp goes from the back edge (z 7) down to the curb (z 5).
    expect(cross[0].a[1]).toBeCloseTo(7, 6);
    expect(cross[0].b[1]).toBeCloseTo(5, 6);
  });

  it("gives the sampler the ramp height, with no step at either end", () => {
    const sample = createGeoGroundSampler(level);
    const r = lay.get("across").ramps[0];
    const top = sample(r.a[0] + (r.a[0] - r.b[0]) * 0.01, r.a[1] + (r.a[1] - r.b[1]) * 0.01);
    const mid = sample((r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2);
    expect(top.height).toBeCloseTo(0.15, 2);
    expect(mid.height).toBeCloseTo(0.09, 2);
    expect(mid.normal[1]).toBeLessThan(1);
    expect(rampAt(r, r.b[0], r.b[1]).height).toBeCloseTo(0.03, 6);
  });
});

describe("curb ramps on the BeltLine level", () => {
  const lay = sidewalkLayout(LEVEL);
  const ramps = [...lay.values()].flatMap((l) => l.ramps);

  it("puts ramps at the crosswalks and the OSM crossings, at finite places", () => {
    expect(crossingEnds(LEVEL).length).toBeGreaterThan(300);
    expect(ramps.filter((r) => r.kind === "cross").length).toBeGreaterThan(100);
    expect(ramps.filter((r) => r.kind === "end").length).toBeGreaterThan(40);
    expect(ramps.some((r) => r.source?.startsWith("w"))).toBe(true);
    for (const r of ramps) for (const v of [...r.a, ...r.b, r.r, r.h0, r.h1]) expect(Number.isFinite(v)).toBe(true);
  });

  it("leaves no sidewalk piece across a street", () => {
    const sample = createGeoGroundSampler(LEVEL);
    const streets = new Set(LEVEL.strips.filter((s) => s.kind === "street").map((s) => s.id));
    let cut = 0;
    for (const s of LEVEL.strips.filter((x) => x.kind === "sidewalk" && !x.bridge)) {
      const l = lay.get(s.id);
      cut += l.cuts.length;
      for (const range of l.pieces) {
        const pts = piecePoints(s.points, range);
        // The middle of each piece is a sidewalk, not a street.
        const m = pts[Math.floor(pts.length / 2)];
        expect(streets.has(sample(m[0], m[1]).id), s.id).toBe(false);
      }
    }
    expect(cut).toBeGreaterThan(20);
  });
});

describe("the skater on the curbs and the benches (#136)", () => {
  const env = createLevelEnv(LEVEL);
  const skaterEnv = createSkaterEnv(LEVEL, env.grindables);
  const t = terrainOf(LEVEL);
  const lay = sidewalkLayout(LEVEL);

  function ride(start, yaw, frames, inputAt) {
    let s = createSkater(LEVEL, { position: start, yaw });
    s.speed = 4;
    const log = [];
    for (let i = 0; i < frames; i += 1) {
      s = stepSkater(s, inputAt(i), DT, env, skaterEnv);
      log.push({ bonked: s.bonked, state: s.state, y: s.position[1], h: s.position[1] - t.height(s.position[0], s.position[2]), id: s.groundId, snapped: s.justSnapped, grind: s.grind?.id ?? null, fell: s.justFell });
    }
    return { s, log };
  }

  it("rolls up a curb cut from the street to the sidewalk with no bonk", () => {
    // The end ramps of the sidewalks that go across a street.
    const list = [...lay.values()].flatMap((l) => l.ramps).filter((r) => r.kind === "end" && !r.source);
    let rolls = 0;
    for (const r of list.slice(0, 12)) {
      const len = Math.hypot(r.a[0] - r.b[0], r.a[1] - r.b[1]);
      const ux = (r.a[0] - r.b[0]) / len;
      const uz = (r.a[1] - r.b[1]) / len;
      // Start on the street 2 m before the ramp foot, and roll up it.
      const x = r.b[0] - ux * 2;
      const z = r.b[1] - uz * 2;
      const g = env.sampleGround(x, z);
      if (!g || g.height > t.height(x, z) + 0.05) continue;
      const yaw = Math.atan2(-uz, ux);
      const { log } = ride([x, g.height, z], yaw, 90, () => ({ push: true }));
      expect(log.some((e) => e.bonked), r.id).toBe(false);
      expect(log.some((e) => e.fell), r.id).toBe(false);
      // The skater went up the ramp to the sidewalk: 0.15 m over the terrain.
      expect(Math.max(...log.map((e) => e.h)), r.id).toBeGreaterThan(0.12);
      rolls += 1;
    }
    expect(rolls).toBeGreaterThanOrEqual(5);
  });

  it("pops a curb onto the sidewalk with no bonk", () => {
    const curbs = env.grindables.filter((g) => g.id.startsWith("ledge:curb:") && g.total > 10);
    let pops = 0;
    for (const c of curbs.slice(0, 20)) {
      const p = c.points[Math.floor(c.points.length / 2)];
      const q = c.points[Math.floor(c.points.length / 2) + 1] ?? c.points[Math.floor(c.points.length / 2) - 1];
      const l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1;
      // The normal toward the sidewalk: the side where the ground is higher.
      let nx = -(q[2] - p[2]) / l;
      let nz = (q[0] - p[0]) / l;
      const side = env.sampleGround(p[0] + nx * 0.5, p[2] + nz * 0.5);
      if (!side || side.height < p[1] - 0.02) {
        nx = -nx;
        nz = -nz;
      }
      const x = p[0] - nx * 2.5;
      const z = p[2] - nz * 2.5;
      const g = env.sampleGround(x, z);
      const on = env.sampleGround(p[0] + nx * 0.6, p[2] + nz * 0.6);
      // A clean case: the street before the curb, and the sidewalk after it.
      if (!g || !on || on.height - g.height < 0.08 || !on.id.startsWith("w")) continue;
      const yaw = Math.atan2(-nz, nx);
      const { log } = ride([x, g.height, z], yaw, 50, (i) => (i === 18 ? { jump: true } : {}));
      expect(log.some((e) => e.bonked), c.id).toBe(false);
      expect(log.some((e) => e.state === "air"), c.id).toBe(true);
      expect(log.some((e) => e.fell), c.id).toBe(false);
      pops += 1;
      if (pops >= 5) break;
    }
    expect(pops).toBeGreaterThanOrEqual(3);
  });

  it("grinds an OSM bench and a curb", () => {
    const benches = benchLedges(LEVEL, env.props);
    expect(benches.length).toBeGreaterThanOrEqual(10);
    let grinds = 0;
    for (const b of benches.slice(0, 10)) {
      const [p0, , p2] = b.points;
      const len = Math.hypot(p2[0] - p0[0], p2[2] - p0[2]);
      const ux = (p2[0] - p0[0]) / len;
      const uz = (p2[2] - p0[2]) / len;
      const x = p0[0] - ux * 2.2;
      const z = p0[2] - uz * 2.2;
      const g = env.sampleGround(x, z);
      if (!g || g.height > p0[1]) continue;
      const { log } = ride([x, g.height, z], Math.atan2(-uz, ux), 40, () => ({ grind: true, push: true }));
      if (log.some((e) => e.grind === b.id)) grinds += 1;
    }
    expect(grinds).toBeGreaterThanOrEqual(3);
    // A curb ledge.
    const c = env.grindables.find((g) => g.id.startsWith("ledge:curb:") && g.total > 20);
    const [p0, p1] = c.points;
    const l = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
    const ux = (p1[0] - p0[0]) / l;
    const uz = (p1[2] - p0[2]) / l;
    const g = env.sampleGround(p0[0] - ux * 1.5, p0[2] - uz * 1.5);
    const { log } = ride([p0[0] - ux * 1.5, g.height, p0[2] - uz * 1.5], Math.atan2(-uz, ux), 30, () => ({ grind: true, push: true }));
    expect(log.some((e) => e.grind === c.id)).toBe(true);
  });
});
