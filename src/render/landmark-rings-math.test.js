import { describe, expect, it } from "vitest";
import { RINGS, RING_SHAPES, areaRect, claimFade, dashCount, isRed, ringCapacity, ringEmissive, ringGround, ringList, ringPoint, ringPulse, rectPoint } from "./landmark-rings-math.js";
import { createLandmarks, inZone as inZoneOf, landmarkView, markSpot, prepareLandmarks, stepLandmarks } from "../sim/landmarks.js";
import { padPoint, withSkatepark } from "../level/skatepark.js";
import BELTLINE_FILE from "../../levels/beltline-eastside/level.json";
import BELTLINE_SKATEPARK from "../../levels/beltline-eastside/skatepark.json";
import SKATE_FEATURES from "../../assets/skate-features/features.json";
import BELTLINE_SPOTS from "../../levels/beltline-eastside/landmarks.json";

const BELTLINE = withSkatepark(BELTLINE_FILE, BELTLINE_SKATEPARK, SKATE_FEATURES);
const fresh = () => createLandmarks(prepareLandmarks(BELTLINE_SPOTS, BELTLINE), { level: "beltline-eastside" });
const found = (...ids) => ids.reduce((s, id) => markSpot(s, id, "found"), fresh());
const rings = (state, opts) => ringList(landmarkView(state).spots, opts);

describe("V-1: the emissive values of the ring", () => {
  it("is 0.8 in the pbr look by day", () => {
    expect(ringEmissive({ look: "pbr", night: 0 })).toEqual({ rest: 0.8, core: 0.8 });
  });

  it("has a core of 1.6 at night, and the rest stays at 0.8", () => {
    expect(ringEmissive({ look: "pbr", night: 1 })).toEqual({ rest: 0.8, core: 1.6 });
    // Over the night bloom threshold (0.92) for the core only; under the day threshold (2.4).
    expect(ringEmissive({ look: "pbr", night: 1 }).core).toBeGreaterThan(0.92);
    expect(ringEmissive({ look: "pbr", night: 1 }).rest).toBeLessThan(0.92);
    expect(ringEmissive({ look: "pbr", night: 1 }).core).toBeLessThan(2.4);
  });

  it("keeps the night core for the high tier: the other tiers have no bloom", () => {
    expect(ringEmissive({ look: "pbr", night: 1, tier: "phone" })).toEqual({ rest: 0.8, core: 0.8 });
    expect(ringEmissive({ look: "pbr", night: 1, tier: "low" })).toEqual({ rest: 0.8, core: 0.8 });
  });

  it("is flat and unlit in the toon look", () => {
    expect(ringEmissive({ look: "toon", night: 1 })).toEqual({ rest: 1, core: 1 });
  });
});

describe("the tiers and reduced motion (R-1)", () => {
  it("has no pulse on the low tier", () => {
    for (const t of [0, 0.4, 1.3, 2]) expect(ringPulse("low", t)).toBe(1);
  });

  it("has a slow, small scale pulse on the phone and high tiers", () => {
    for (const tier of ["phone", "high"]) {
      const values = Array.from({ length: 60 }, (_, i) => ringPulse(tier, i * 0.1));
      expect(Math.max(...values)).toBeGreaterThan(1.01);
      expect(Math.max(...values)).toBeLessThanOrEqual(1.05);
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0.95);
      expect(RINGS.pulse[tier].period).toBeGreaterThanOrEqual(2);
    }
  });

  it("has no pulse with reduced motion, on every tier", () => {
    for (const tier of ["low", "phone", "high"]) for (const t of [0.3, 0.8, 1.7]) expect(ringPulse(tier, t, true)).toBe(1);
  });

  it("turns a claimed ring gold and fades it in 0.5 s", () => {
    expect(claimFade(0)).toMatchObject({ alpha: 1, fill: 1, done: false });
    expect(claimFade(0.25).alpha).toBeCloseTo(0.5, 9);
    expect(claimFade(0.25).scale).toBeGreaterThan(1);
    expect(claimFade(0.5).done).toBe(true);
  });

  it("only fades a claimed ring, in 0.3 s, with reduced motion", () => {
    expect(claimFade(0.15, true)).toMatchObject({ fill: 0, scale: 1, done: false });
    expect(claimFade(0.15, true).alpha).toBeCloseTo(0.5, 9);
    expect(claimFade(0.3, true).done).toBe(true);
  });
});

describe("the rings of the Beltline file", () => {
  it("draws no ring for an Unknown spot, a Claimed spot or an edge marker", () => {
    expect(rings(fresh())).toEqual([]);
    expect(rings(found("inman-park-historic-district"))).toEqual([]);
    expect(rings(markSpot(found("studioplex"), "studioplex", "claimed"))).toEqual([]);
  });

  it("draws 1 ring at the zone of a Found gap, grind or combo spot", () => {
    const list = rings(found("freedom-parkway-bridge", "krog-street-market", "historic-fourth-ward-skatepark"));
    expect(list.map((r) => [r.id, r.shape, Math.round(r.x * 10) / 10, Math.round(r.z * 10) / 10, r.r])).toEqual([
      ["krog-street-market", RING_SHAPES.grind, -98.3, 890, 20],
      ["freedom-parkway-bridge", RING_SHAPES.gap, 336, 18.6, 12],
      ["historic-fourth-ward-skatepark", RING_SHAPES.combo, 264.4, 3.3, 19],
    ]);
  });

  it("draws a numbered ring at each checkpoint of a Found line spot", () => {
    const list = rings(found("telephone-factory-lofts"));
    expect(list.map((r) => [r.shape, r.digit, r.x, r.z, r.r])).toEqual([
      [RING_SHAPES.line, 0, 166.9, -371, 4],
      [RING_SHAPES.line, 1, 186.4, -348.2, 4],
      [RING_SHAPES.line, 2, 206.1, -325.5, 4],
    ]);
  });

  it("dims a checkpoint that the skater passed in this attempt", () => {
    let s = found("telephone-factory-lofts");
    s = stepLandmarks(s, { position: [166.9, 0, -371], airborne: false, landed: false, bailed: false, teleported: false, grind: null, linked: false, banked: 0 }, 1 / 60);
    expect(rings(s).map((r) => r.alpha)).toEqual([RINGS.passed, 1, 1]);
  });

  it("tells the 4 types apart by shape: every ring has the same color", () => {
    expect(new Set(Object.values(RING_SHAPES)).size).toBe(4);
    const list = rings(found(...BELTLINE_SPOTS.spots.map((s) => s.id)));
    expect(new Set(list.map((r) => r.shape))).toEqual(new Set([0, 1, 2, 3]));
    // A ring carries no color: the one material has the landmark gold.
    for (const r of list) expect(Object.keys(r)).not.toContain("color");
    expect(RINGS.gold).toBe("#ffd166");
    expect(RINGS.width).toBe(0.15);
  });

  it("has room for every ring of the file, from the file", () => {
    const spots = prepareLandmarks(BELTLINE_SPOTS, BELTLINE);
    const lines = spots.filter((s) => s.challenge?.type === "line");
    const others = spots.filter((s) => s.challenge && s.challenge.type !== "line");
    expect(ringCapacity(spots)).toBe(others.length + lines.reduce((n, s) => n + s.challenge.checkpoints.length, 0));
    expect(rings(found(...BELTLINE_SPOTS.spots.map((s) => s.id)))).toHaveLength(ringCapacity(spots));
  });

  it("shows no ring in a free run", () => {
    expect(rings(found("freedom-parkway-bridge"), { timed: false })).toEqual([]);
  });

  it("gives a dashed ring a whole count of dashes", () => {
    for (const r of [8, 12, 15, 20]) {
      expect(Number.isInteger(dashCount(r))).toBe(true);
      expect(dashCount(r)).toBeGreaterThanOrEqual(8);
    }
    expect(dashCount(20)).toBeGreaterThan(dashCount(15));
  });
});

describe("the ground under a ring", () => {
  const ring = { x: 0, z: 0, r: 10 };

  it("follows a slope", () => {
    const g = ringGround(ring, 5, (x) => 5 + x * 0.05);
    expect(g.y).toBe(5);
    expect(g.heights).toHaveLength(RINGS.samples);
    expect(g.heights[0]).toBeCloseTo(0.5, 6);
    expect(g.heights[RINGS.samples / 2]).toBeCloseTo(-0.5, 6);
  });

  it("does not climb a roof or drop under a bridge: an off-level sample takes its neighbors", () => {
    // A 9 m roof on the +x side, and no ground at all on the -x side.
    const g = ringGround(ring, 5, (x) => (x > 9 ? 14 : x < -9 ? null : 5.2));
    for (const h of g.heights) expect(h).toBeCloseTo(0.2, 6);
  });

  it("is flat when no sample is on the level of the zone", () => {
    expect(ringGround(ring, 5, () => null).heights.every((h) => h === 0)).toBe(true);
  });
});

describe("S-4: no red", () => {
  it("knows red from the landmark gold, the ink and the district accents", () => {
    expect(isRed(255, 0, 0)).toBe(true);
    expect(isRed(214, 40, 40)).toBe(true);
    expect(isRed(255, 60, 90)).toBe(true);
    expect(isRed(255, 209, 102)).toBe(false); // #ffd166
    expect(isRed(11, 11, 18)).toBe(false); // the ink
    expect(isRed(201, 150, 46)).toBe(false); // #c9962e
    expect(isRed(111, 155, 191)).toBe(false); // #6f9bbf
    expect(isRed(255, 255, 255)).toBe(false);
  });
});

// #365: the skatepark combo zone is the pad plus 2 m, drawn as a rounded
// rectangle (the zone edge itself).
describe("the area ring of the skatepark pad (#365)", () => {
  const ring = () => rings(found("historic-fourth-ward-skatepark")).find((r) => r.id === "historic-fourth-ward-skatepark");
  const pad = (u, v) => padPoint(BELTLINE_SKATEPARK, u, v);
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

  it("finds the rectangle of an outline: center, long axis, half sizes with the margin", () => {
    const r = areaRect([[0, 0], [10, 0], [10, 4], [0, 4]], 2);
    expect(r).toMatchObject({ x: 5, z: 2, hu: 7, hv: 4, corner: 2 });
    expect(near(Math.cos(r.angle), 1)).toBe(true);
    // A small margin keeps the least corner radius.
    expect(areaRect([[0, 0], [10, 0], [10, 4], [0, 4]], 0).corner).toBe(RINGS.rectCorner);
  });

  it("walks the rounded rectangle at an even pace, with the normal out", () => {
    expect(rectPoint(7, 4, 2, 0)).toEqual([7, 0, 1, 0]);
    // The total length: 4 (5 + 2) straight + 2 pi 2 of corners.
    const total = 4 * 5 + 4 * 2 + 4 * Math.PI;
    const top = rectPoint(7, 4, 2, (2 + Math.PI + 5) / total);
    expect(top.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0, 4, 0, 1]);
    for (let i = 0; i <= 64; i += 1) {
      const [x, z, nx, nz] = rectPoint(7, 4, 2, i / 64);
      // Every point is 2 m (the corner radius) from the inner 5 x 2 box.
      const dx = Math.max(0, Math.abs(x) - 5);
      const dz = Math.max(0, Math.abs(z) - 2);
      expect(Math.hypot(dx, dz)).toBeCloseTo(2, 6);
      expect(Math.hypot(nx, nz)).toBeCloseTo(1, 6);
    }
    expect(rectPoint(7, 4, 2, 1)).toEqual(rectPoint(7, 4, 2, 0));
  });

  it("draws the zone of the Beltline skatepark as the pad plus 2 m, on its zone edge", () => {
    const r = ring();
    expect(r.rect).toMatchObject({ corner: 2 });
    expect(r.rect.hu).toBeCloseTo(17, 2);
    expect(r.rect.hv).toBeCloseTo(9, 2);
    expect(r.x).toBeCloseTo(BELTLINE_SKATEPARK.center[0], 2);
    expect(r.z).toBeCloseTo(BELTLINE_SKATEPARK.center[1], 2);
    // Each drawn point is 2 m from the pad outline: on the edge of the zone.
    const zone = prepareLandmarks(BELTLINE_SPOTS, BELTLINE).find((x) => x.id === "historic-fourth-ward-skatepark").challenge.zone;
    for (let i = 0; i < 32; i += 1) {
      const [x, z] = ringPoint(r, i / 32);
      expect(x).not.toBeNaN();
      // Just inside the drawn line is in the zone; just outside is not.
      const dx = x - r.x;
      const dz = z - r.z;
      const len = Math.hypot(dx, dz);
      expect(inZoneOf(zone, x - (dx / len) * 0.05, z - (dz / len) * 0.05)).toBe(true);
      expect(inZoneOf(zone, x + (dx / len) * 0.05, z + (dz / len) * 0.05)).toBe(false);
    }
    // The west end of the rail lane is inside the drawn line.
    const [wx, wz] = pad(-13, -3.5);
    expect(inZoneOf(zone, wx, wz)).toBe(true);
  });

  it("samples the ground under the rectangle, not under a circle", () => {
    const r = ring();
    const asked = [];
    ringGround(r, 1, (x, z) => {
      asked.push([x, z]);
      return 1;
    });
    expect(asked.length).toBe(RINGS.samples);
    expect(asked[0][0]).toBeCloseTo(ringPoint(r, 0)[0], 6);
    expect(asked[4][1]).toBeCloseTo(ringPoint(r, 4 / RINGS.samples)[1], 6);
  });
});
