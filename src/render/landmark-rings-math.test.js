import { describe, expect, it } from "vitest";
import { RINGS, RING_SHAPES, claimFade, dashCount, isRed, ringCapacity, ringEmissive, ringGround, ringList, ringPulse } from "./landmark-rings-math.js";
import { createLandmarks, landmarkView, markSpot, prepareLandmarks, stepLandmarks } from "../sim/landmarks.js";
import { withSkatepark } from "../level/skatepark.js";
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
    expect(list.map((r) => [r.id, r.shape, r.x, r.z, r.r])).toEqual([
      ["krog-street-market", RING_SHAPES.grind, -98.3, 890, 20],
      ["freedom-parkway-bridge", RING_SHAPES.gap, 336, 18.6, 12],
      ["historic-fourth-ward-skatepark", RING_SHAPES.combo, 272.3, -1.5, 10],
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
