import { describe, expect, it } from "vitest";
import { CLAIM_FX, claimBurstSpecs, claimRim, claimSpecs, goldenFactor, linearColor, petalSpecs, rimAlpha, rimBuildings, rimWalls } from "./claim-fx.js";
import { FX, effectsPolicy } from "../render/effects/fx.js";
import { BLOOM_THRESHOLD } from "../render/pbr-palette.js";

const ACCENT = [0.8, 0.5, 0.2];
const FEET = [10, 2, -5];

describe("when a spot is claimed (the burst and the petals)", () => {
  it("puts a star and a ring flat at the feet for 0.4 s on the high tier, with a hot core on the star only", () => {
    const specs = claimBurstSpecs(FEET, ACCENT, effectsPolicy("high").claim);
    expect(specs.map((s) => s.shape)).toEqual(["ring", "star"]);
    for (const s of specs) {
      expect(s.flat).toBe(true);
      expect(s.life).toBe(0.4);
      expect(s.color).toEqual(ACCENT);
      expect(s.position[0]).toBe(10);
      expect(s.position[2]).toBe(-5);
      expect(s.position[1]).toBeGreaterThan(2);
      expect(s.position[1]).toBeLessThan(2.2);
    }
    expect(specs.find((s) => s.shape === "star").core).toBe(true);
    expect(specs.find((s) => s.shape === "ring").core).toBe(false);
  });

  it("keeps the ring only, with no bloom, on the phone tier", () => {
    const specs = claimBurstSpecs(FEET, ACCENT, effectsPolicy("phone").claim);
    expect(specs).toHaveLength(1);
    expect(specs[0]).toMatchObject({ shape: "ring", core: false });
  });

  it("drops 16 petals on high, 8 on phone and none on low", () => {
    const count = (tier) => claimSpecs(FEET, ACCENT, effectsPolicy(tier)).filter((s) => s.shape === "petal").length;
    expect(count("high")).toBe(16);
    expect(count("phone")).toBe(8);
    expect(count("low")).toBe(0);
    expect(claimSpecs(FEET, ACCENT, effectsPolicy("low"))).toEqual([]);
  });

  it("turns the burst and the petals off with reduced motion and with ?fx=0 (R-1)", () => {
    expect(claimSpecs(FEET, ACCENT, effectsPolicy("high", { reducedMotion: true }))).toEqual([]);
    expect(claimSpecs(FEET, ACCENT, effectsPolicy("phone", { off: true }))).toEqual([]);
    expect(claimSpecs(FEET, ACCENT, null)).toEqual([]);
  });

  it("starts the petals over the skater and lets them fall for 1 s, in dogwood pink under the bloom threshold", () => {
    const petals = petalSpecs(FEET, 16, 7);
    const pink = linearColor(CLAIM_FX.petals.color, FX.emissive.body);
    for (const p of petals) {
      expect(p.shape).toBe("petal");
      expect(p.life).toBe(1);
      expect(p.flat).toBe(false);
      expect(p.color).toEqual(pink);
      expect(Math.max(...p.color)).toBeLessThan(BLOOM_THRESHOLD.night);
      expect(p.position[1] - FEET[1]).toBeGreaterThanOrEqual(CLAIM_FX.petals.top[0]);
      expect(p.position[1] - FEET[1]).toBeLessThanOrEqual(CLAIM_FX.petals.top[1]);
      expect(Math.hypot(p.position[0] - FEET[0], p.position[2] - FEET[2])).toBeLessThanOrEqual(CLAIM_FX.petals.radius + 1e-9);
      expect(p.velocity[1]).toBeLessThan(0);
    }
    // In 1 s a petal falls less than its start height: it stays over the ground.
    const p = CLAIM_FX.petals;
    expect(p.fall * p.life + 0.5 * p.gravity * p.life ** 2).toBeLessThan(p.top[0]);
  });

  it("gives the same petals for the same seed, and other petals for another seed", () => {
    expect(petalSpecs(FEET, 8, 3)).toEqual(petalSpecs(FEET, 8, 3));
    expect(petalSpecs(FEET, 8, 3)).not.toEqual(petalSpecs(FEET, 8, 4));
    expect(petalSpecs(FEET, 0, 3)).toEqual([]);
  });

  it("makes the dogwood color pink: red over blue over green", () => {
    const [r, g, b] = linearColor("#c98fa6");
    expect(r).toBeCloseTo(1, 6);
    expect(b).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });
});

describe("when the golden-hour rim is drawn", () => {
  it("shows only at golden hour: off at night and at midday, full at a low sun", () => {
    expect(goldenFactor(-10)).toBe(0);
    expect(goldenFactor(60)).toBe(0);
    expect(goldenFactor(6)).toBe(1);
    expect(goldenFactor(1)).toBeGreaterThan(0);
    expect(goldenFactor(1)).toBeLessThan(1);
    expect(goldenFactor(NaN)).toBe(0);
    expect(rimAlpha(6)).toBe(CLAIM_FX.rim.alpha);
    expect(rimAlpha(30)).toBe(0);
  });

  it("is faint, and on the high tier only", () => {
    expect(CLAIM_FX.rim.alpha).toBeLessThanOrEqual(0.4);
    expect(claimRim("high")).toBe(true);
    expect(claimRim("phone")).toBe(false);
    expect(claimRim("low")).toBe(false);
    expect(claimRim("high", { off: true })).toBe(false);
  });

  it("goes on the Found buildings only, not on Claimed or Unknown ones or on other kinds", () => {
    const view = {
      spots: [
        { id: "a", kind: "building", state: "found" },
        { id: "b", kind: "building", state: "claimed" },
        { id: "c", kind: "building", state: "unknown" },
        { id: "d", kind: "bridge", state: "found" },
      ],
    };
    expect(rimBuildings(view)).toEqual(["a"]);
    expect(rimBuildings(null)).toEqual([]);
  });

  it("builds a wall band outside each edge of a footprint, with the normals pointing out", () => {
    // A 10 m square, clockwise in (x, z), closed.
    const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const { positions, normals } = rimWalls(ring, 3, 20, 0.5);
    expect(positions.length).toBe(4 * 6 * 3);
    expect(normals.length).toBe(positions.length);
    const ys = positions.filter((_, i) => i % 3 === 1);
    expect(Math.min(...ys)).toBe(3);
    expect(Math.max(...ys)).toBe(23);
    // Every vertex is 0.5 m outside the square on its normal side.
    for (let i = 0; i < positions.length; i += 3) {
      const [x, , z] = positions.slice(i, i + 3);
      const [nx, , nz] = normals.slice(i, i + 3);
      const out = nx !== 0 ? (nx > 0 ? x - 10 : -x) : nz > 0 ? z - 10 : -z;
      expect(out).toBeCloseTo(0.5, 9);
    }
    // The other winding gives the same band.
    const ccw = rimWalls([...ring].reverse(), 3, 20, 0.5);
    const sorted = (a) => [...a].map((v) => Math.round(v * 1e6)).sort((p, q) => p - q);
    expect(sorted(ccw.positions)).toEqual(sorted(positions));
  });
});
