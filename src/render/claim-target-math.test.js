import { describe, expect, it } from "vitest";
import { TARGET, clipNear, grindTargets, pathLength, targetGain } from "./claim-target-math.js";
import { isRed } from "./landmark-rings-math.js";
import { createLandmarks, landmarkView, markSpot, prepareLandmarks, stepLandmarks } from "../sim/landmarks.js";
import { createLevelEnv } from "../level/ground.js";
import { withSkatepark } from "../level/skatepark.js";
import BELTLINE_FILE from "../../levels/beltline-eastside/level.json";
import BELTLINE_SKATEPARK from "../../levels/beltline-eastside/skatepark.json";
import SKATE_FEATURES from "../../assets/skate-features/features.json";
import BELTLINE_SPOTS from "../../levels/beltline-eastside/landmarks.json";

describe("the clip of a rail to the part near a zone", () => {
  const line = [[0, 1, 0], [100, 1, 0]];

  it("keeps the run of the rail within r of the center", () => {
    const part = clipNear(line, 50, 3, 5);
    expect(part[0][0]).toBeCloseTo(46, 6);
    expect(part.at(-1)[0]).toBeCloseTo(54, 6);
    expect(part.every(([, y]) => y === 1)).toBe(true);
  });

  it("is empty when the rail does not come that close", () => {
    expect(clipNear(line, 50, 10, 5)).toEqual([]);
    expect(clipNear([], 0, 0, 5)).toEqual([]);
  });

  it("keeps only the run that comes nearest, for a rail that leaves and comes back", () => {
    const u = [[0, 0, 0], [0, 0, 10], [20, 0, 10], [20, 0, 0]];
    const part = clipNear(u, 1, 0, 3);
    expect(part.every(([x]) => x < 5)).toBe(true);
  });

  it("measures a polyline", () => {
    expect(pathLength([[0, 0, 0], [3, 4, 0], [3, 4, 2]])).toBe(7);
  });
});

describe("the gain of the target line", () => {
  it("is brightest while the skater grinds the feature, and still with reduced motion", () => {
    expect(targetGain(true, 0.3)).toBe(TARGET.gain.active);
    expect(targetGain(false, 0.3, true)).toBe(TARGET.gain.rest);
    expect(targetGain(false, TARGET.pulse.period / 4)).toBeCloseTo(TARGET.gain.rest * (1 + TARGET.pulse.amp), 6);
    // The pbr look: at rest the gold stays under the day bloom threshold (2.4).
    expect(TARGET.gain.rest * (1 + TARGET.pulse.amp)).toBeLessThan(2.4);
  });

  it("uses the landmark gold and ink, not red", () => {
    const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    expect(isRed(...hex(TARGET.gold))).toBe(false);
  });
});

// The Ralph McGill curb of the audit (production/audits/2026-11-13-design-audit).
describe("the target of the Ralph McGill grind claim (#264)", () => {
  const level = withSkatepark(BELTLINE_FILE, BELTLINE_SKATEPARK, SKATE_FEATURES);
  const { grindables } = createLevelEnv(level);
  const spots = prepareLandmarks(BELTLINE_SPOTS, level);
  const ID = "ralph-mcgill-bridge";
  const spot = spots.find((s) => s.id === ID);
  const c = spot.challenge;
  const feature = grindables.find((g) => g.id === c.feature);
  const found = () => markSpot(createLandmarks(spots, { level: "beltline-eastside" }), ID, "found");
  const at = (dx = 0) => [c.zone.x + dx, 0, c.zone.z];

  it("finds the curb of the challenge in the level", () => {
    expect(feature).toBeTruthy();
  });

  it("shows the curb near the zone of a Found spot, in a timed run", () => {
    const list = grindTargets(landmarkView(found()).spots, grindables, at());
    expect(list.map((t) => [t.id, t.feature, t.active])).toEqual([[ID, c.feature, false]]);
    const t = list[0];
    // The line is long enough for the grind, and runs through the zone.
    expect(t.length).toBeGreaterThanOrEqual(c.meters);
    expect(Math.min(...t.points.map(([x, , z]) => Math.hypot(x - c.zone.x, z - c.zone.z)))).toBeLessThanOrEqual(c.zone.r);
    // Every point is on the curb: the samples of its own polyline.
    for (const [x, , z] of t.points) expect(Math.hypot(x - c.zone.x, z - c.zone.z)).toBeLessThanOrEqual(c.zone.r + c.meters + 1e-6);
  });

  it("does not show far from the zone, before the spot is Found, after the claim, or in a free run", () => {
    expect(grindTargets(landmarkView(found()).spots, grindables, at(c.zone.r + TARGET.near + 1))).toEqual([]);
    const unknown = createLandmarks(spots, { level: "beltline-eastside" });
    expect(grindTargets(landmarkView(unknown).spots, grindables, at())).toEqual([]);
    expect(grindTargets(landmarkView(markSpot(found(), ID, "claimed")).spots, grindables, at())).toEqual([]);
    expect(grindTargets(landmarkView(found()).spots, grindables, at(), { timed: false })).toEqual([]);
  });

  it("is active while the skater grinds the curb", () => {
    const p = feature.points[0];
    const obs = (s) => ({ position: [c.zone.x, 0, c.zone.z], airborne: false, landed: false, bailed: false, teleported: false, grind: { id: c.feature, s }, linked: false, banked: 0 });
    let s = stepLandmarks(found(), obs(0), 1 / 60);
    s = stepLandmarks(s, obs(1), 1 / 60);
    expect(p).toBeTruthy();
    expect(grindTargets(landmarkView(s).spots, grindables, at())[0].active).toBe(true);
  });
});
