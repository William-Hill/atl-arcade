import { describe, expect, it } from "vitest";
import { BODY_REF, SKATE_STACK, SKATER_BODIES, bodyFor, modelScale, skateFor } from "./body.js";
import { SKATE } from "./constants.js";
import { createSkateState, runScript } from "./controller.js";

describe("the skater bodies", () => {
  it("scales each model to the dossier height on skates", () => {
    for (const body of Object.values(SKATER_BODIES)) {
      expect(body.meshHeight * modelScale(body)).toBeCloseTo(body.height + SKATE_STACK, 6);
    }
    expect(modelScale(null)).toBe(1);
    expect(bodyFor("capsule")).toBeNull();
  });

  it("keeps SKATE for the reference body and for no body", () => {
    expect(skateFor(null)).toBe(SKATE);
    const ref = skateFor({ ...BODY_REF });
    for (const key of ["maxSpeed", "pushAccel", "coastDrag", "carveRate", "brakeDecel", "jumpSpeed", "bodyRadius"]) expect(ref[key]).toBeCloseTo(SKATE[key], 9);
  });

  it("gives Marcus (taller, heavier) a higher top speed, a longer coast, and a wider turn than Nia", () => {
    const nia = skateFor(SKATER_BODIES.nia);
    const marcus = skateFor(SKATER_BODIES.marcus);
    expect(marcus.maxSpeed).toBeGreaterThan(nia.maxSpeed);
    expect(marcus.coastDrag).toBeLessThan(nia.coastDrag);
    expect(marcus.carveRate).toBeLessThan(nia.carveRate);
    expect(marcus.pushAccel).toBeLessThan(nia.pushAccel);
    expect(marcus.bodyRadius).toBeGreaterThan(nia.bodyRadius);
    // Small changes: each constant stays within 12% of SKATE.
    for (const k of [nia, marcus]) for (const key of ["maxSpeed", "pushAccel", "coastDrag", "carveRate", "brakeDecel", "jumpSpeed", "bodyRadius"]) expect(Math.abs(k[key] / SKATE[key] - 1)).toBeLessThan(0.12);
  });

  it("changes the ride: Marcus coasts further from the same speed", () => {
    const coast = (k) => {
      const s = { ...createSkateState(), speed: 10 };
      return runScript(s, [{ frames: 180, input: {} }], { k }).state.speed;
    };
    expect(coast(skateFor(SKATER_BODIES.marcus))).toBeGreaterThan(coast(skateFor(SKATER_BODIES.nia)));
  });
});
