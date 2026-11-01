import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chainStrips, followLineScript, pointAt, projectOnLine } from "./trail-script.js";
import { createLevelEnv } from "../level/ground.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("trail script", () => {
  it("projects onto a polyline and walks along it", () => {
    const line = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    expect(projectOnLine(line, 5, 2)).toEqual({ s: 5, d: 2 });
    expect(pointAt(line, 15)).toEqual([10, 5]);
    expect(pointAt(line, 99)).toEqual([10, 10]);
  });

  it("chains the trail strips into one long line through the block", () => {
    const [trail] = chainStrips(LEVEL.strips, "trail");
    let len = 0;
    for (let i = 0; i < trail.length - 1; i += 1) len += Math.hypot(trail[i + 1][0] - trail[i][0], trail[i + 1][1] - trail[i][1]);
    expect(len).toBeGreaterThan(1500);
  });

  it("rides 40 s north on the Eastside Trail and never leaves the trail", () => {
    const env = createLevelEnv(LEVEL);
    const [trail] = chainStrips(LEVEL.strips, "trail");
    const { state, offTrack } = followLineScript(trail, LEVEL.spawn, env, { frames: 2400 });
    expect(offTrack).toBeLessThan(4.3 / 2);
    expect(state.respawned).toBeFalsy();
    expect(LEVEL.spawn.position[2] - state.position[2]).toBeGreaterThan(200);
    expect(env.sampleGround(state.position[0], state.position[2]).height).toBeCloseTo(LEVEL.surfaces.trail, 6);
  });
});
