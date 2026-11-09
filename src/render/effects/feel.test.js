import { describe, expect, it } from "vitest";
import {
  DUST_COLOR,
  FEEL,
  SPARK_COLOR,
  createShake,
  dustSpecs,
  feelTriggers,
  fovTarget,
  landFall,
  motionPolicy,
  shakeAngles,
  shakeEnvelope,
  sparkSpecs,
  startShake,
  stepFov,
  stepShake,
} from "./feel.js";
import { EFFECT_TIERS, effectsPolicy } from "./fx.js";
import { SKATE } from "../../sim/skate/constants.js";
import { createSkateState, runScript, stepSkate } from "../../sim/skate/controller.js";
import { GREYBOX } from "../../level/greybox.js";
import { createGroundSampler } from "../../level/ground.js";

const skater = (over = {}) => ({ ...createSkateState(), ...over });
const greybox = { sampleGround: createGroundSampler(GREYBOX) };

function roll(speed, yaw = 0, position = [0, 0, 0]) {
  const s = createSkateState({ position, yaw });
  s.speed = speed;
  s.velocity = [speed * Math.cos(yaw), 0, -speed * Math.sin(yaw)];
  return s;
}

describe("feel triggers", () => {
  it("uses the controller's gravity", () => {
    expect(FEEL.gravity).toBe(SKATE.gravity);
  });

  it("a fast bonk shakes; a push into a wall from rest does not", () => {
    expect(feelTriggers(skater({ speed: 8 }), skater({ bonked: true })).bonk).toBeGreaterThan(0.5);
    expect(feelTriggers(skater({ speed: 0.5 }), skater({ bonked: true })).bonk).toBe(0);
    expect(feelTriggers(skater({ speed: 30 }), skater({ bonked: true })).bonk).toBe(1);
  });

  it("a faster bonk shakes more", () => {
    const a = feelTriggers(skater({ speed: 3 }), skater({ bonked: true })).bonk;
    const b = feelTriggers(skater({ speed: 9 }), skater({ bonked: true })).bonk;
    expect(b).toBeGreaterThan(a);
  });

  it("a landing gives the fall height from the fall speed", () => {
    const f = landFall(skater({ velocity: [0, -10, 0] }));
    expect(f.speed).toBe(10);
    expect(f.height).toBeCloseTo((10 * 10) / (2 * FEEL.gravity), 9);
    expect(landFall(skater({ velocity: [0, 3, 0] })).speed).toBe(0);
  });

  it("a soft landing has a fall but no dust; a big fall has full dust", () => {
    const soft = feelTriggers(skater({ velocity: [0, -1, 0] }), skater({ justLanded: true })).land;
    expect(soft.strength).toBe(0);
    expect(soft.height).toBeGreaterThan(0);
    const big = feelTriggers(skater({ velocity: [0, -12, 0] }), skater({ justLanded: true })).land;
    expect(big.strength).toBe(1);
  });

  it("a wall slide gives the slide speed", () => {
    const f = feelTriggers(skater(), skater({ wallSlide: true, speed: 9 }));
    expect(f.slide.speed).toBe(9);
    expect(f.slide.strength).toBeGreaterThan(0);
    expect(feelTriggers(skater(), skater({ speed: 9 })).slide).toBe(null);
  });

  it("reads the real controller: a shallow wall approach slides, a head-on one bonks", () => {
    const slide = runScript(roll(8, 0.1, [0, 0.15, -9.2]), [{ frames: 90 }], { env: greybox, trace: true }).states;
    let prev = roll(8, 0.1, [0, 0.15, -9.2]);
    let slides = 0;
    for (const s of slide) {
      if (feelTriggers(prev, s).slide) slides += 1;
      prev = s;
    }
    expect(slides).toBeGreaterThan(0);

    // Head-on into the same wall (north, -z) at full speed.
    let s = roll(8, Math.PI / 2, [0, 0.15, -6]);
    let bonk = 0;
    for (let i = 0; i < 120 && !bonk; i += 1) {
      const next = stepSkate(s, {}, 1 / 60, greybox);
      bonk = feelTriggers(s, next).bonk;
      s = next;
    }
    expect(bonk).toBeGreaterThan(0.5);
  });

  it("does not change the skater it reads", () => {
    const prev = skater({ speed: 8, velocity: [0, -9, 0] });
    const next = skater({ bonked: true, justLanded: true, wallSlide: true, speed: 4 });
    const before = JSON.stringify([prev, next]);
    feelTriggers(prev, next);
    expect(JSON.stringify([prev, next])).toBe(before);
  });
});

describe("camera shake", () => {
  it("starts at the strength, decays to 0 over the duration, then stops making state", () => {
    let s = startShake(createShake(), 1);
    expect(s.amp).toBeCloseTo(FEEL.shake.amp, 9);
    expect(shakeEnvelope(s)).toBe(1);
    s = stepShake(s, FEEL.shake.duration / 2);
    expect(shakeEnvelope(s)).toBeCloseTo(0.25, 9);
    s = stepShake(s, FEEL.shake.duration);
    expect(s.amp).toBe(0);
    expect(stepShake(s, 0.016)).toBe(s);
    expect(shakeAngles(s)).toEqual({ pitch: 0, yaw: 0, roll: 0 });
  });

  it("stays under the peak angle and is the same for the same state", () => {
    let s = startShake(createShake(), 1);
    let peak = 0;
    for (let i = 0; i < 40; i += 1) {
      const a = shakeAngles(s);
      peak = Math.max(peak, Math.abs(a.pitch), Math.abs(a.yaw), Math.abs(a.roll));
      expect(shakeAngles(s)).toEqual(a);
      s = stepShake(s, 1 / 120);
    }
    expect(peak).toBeGreaterThan(FEEL.shake.amp * 0.3);
    expect(peak).toBeLessThanOrEqual(FEEL.shake.amp);
    // About 1.3 degrees at most.
    expect(FEEL.shake.amp).toBeLessThan(0.03);
  });

  it("a weak hit does not cut a strong shake; a strong hit restarts a weak one", () => {
    const strong = startShake(createShake(), 1);
    expect(startShake(strong, 0.3)).toBe(strong);
    const weak = startShake(createShake(), 0.3);
    const again = startShake(weak, 1);
    expect(again.amp).toBeGreaterThan(weak.amp);
    expect(again.seq).toBe(weak.seq + 1);
    expect(startShake(weak, 0)).toBe(weak);
  });

  it("reduced motion and ?fx=0 turn the camera motion off", () => {
    expect(motionPolicy()).toEqual({ shake: true, fov: true });
    expect(motionPolicy({ reducedMotion: true })).toEqual({ shake: false, fov: false });
    expect(motionPolicy({ off: true })).toEqual({ shake: false, fov: false });
  });
});

describe("speed field of view", () => {
  it("adds nothing at a push speed and the full boost at top speed", () => {
    expect(fovTarget(0)).toBe(0);
    expect(fovTarget(FEEL.fov.start)).toBe(0);
    expect(fovTarget(FEEL.fov.full)).toBe(FEEL.fov.boost);
    expect(fovTarget(-40)).toBe(FEEL.fov.boost);
    expect(fovTarget((FEEL.fov.start + FEEL.fov.full) / 2)).toBeCloseTo(FEEL.fov.boost / 2, 9);
  });

  it("opens over the attack time and closes over the release time", () => {
    const k = FEEL.fov;
    expect(stepFov(0, k.boost, k.attack / 2)).toBeCloseTo(k.boost / 2, 9);
    expect(stepFov(0, k.boost, k.attack * 2)).toBe(k.boost);
    expect(stepFov(k.boost, 0, k.release / 2)).toBeCloseTo(k.boost / 2, 9);
    expect(stepFov(k.boost, 0, k.release * 2)).toBe(0);
  });

  it("the boost stays small: under 10 degrees", () => {
    expect(FEEL.fov.boost).toBeLessThan(10);
  });
});

describe("dust and sparks", () => {
  it("the tiers: none on low, fewer on phone than on high, none with reduced motion", () => {
    expect(effectsPolicy("low").dust).toBe(0);
    expect(effectsPolicy("low").sparks).toBe(0);
    expect(effectsPolicy("low").enabled).toBe(false);
    expect(effectsPolicy("phone").dust).toBeLessThan(effectsPolicy("high").dust);
    expect(effectsPolicy("phone").sparks).toBeLessThanOrEqual(effectsPolicy("high").sparks);
    expect(effectsPolicy("high", { reducedMotion: true }).dust).toBe(null);
    expect(effectsPolicy("high", { off: true }).sparks).toBe(null);
    expect(EFFECT_TIERS.dust.high).toBeGreaterThan(0);
  });

  it("a bigger fall makes more, bigger and faster puffs", () => {
    const small = dustSpecs([0, 0, 0], 0.1, 7);
    const big = dustSpecs([0, 0, 0], 1, 7);
    expect(big.length).toBeGreaterThan(small.length);
    expect(big.length).toBe(7);
    expect(small.length).toBeGreaterThanOrEqual(2);
    expect(big[0].size).toBeGreaterThan(small[0].size);
    const v = (p) => Math.hypot(p.velocity[0], p.velocity[2]);
    expect(v(big[0])).toBeGreaterThan(v(small[0]));
    expect(dustSpecs([0, 0, 0], 0, 7)).toEqual([]);
    expect(dustSpecs([0, 0, 0], 1, 0)).toEqual([]);
  });

  it("the puffs are soft dust around the feet, the same for the same seed", () => {
    const a = dustSpecs([5, 2, -3], 1, 7, 42);
    expect(dustSpecs([5, 2, -3], 1, 7, 42)).toEqual(a);
    for (const p of a) {
      expect(p.shape).toBe("puff");
      expect(p.color).toEqual(DUST_COLOR);
      expect(p.opacity).toBeLessThan(1);
      expect(Math.hypot(p.position[0] - 5, p.position[2] + 3)).toBeLessThan(0.5);
      expect(p.position[1]).toBeGreaterThan(2);
    }
  });

  it("the sparks fly back from the heading and up, and fall", () => {
    const sp = sparkSpecs([0, 0, 0], [1, 0], 1, 4, 3);
    expect(sp).toHaveLength(4);
    for (const p of sp) {
      expect(p.shape).toBe("spark");
      expect(p.color).toEqual(SPARK_COLOR);
      expect(p.velocity[0]).toBeLessThan(0);
      expect(p.velocity[1]).toBeGreaterThan(0);
      expect(p.gravity).toBeGreaterThan(0);
    }
    expect(sparkSpecs([0, 0, 0], [1, 0], 1, 4, 3)).toEqual(sp);
    expect(sparkSpecs([0, 0, 0], [1, 0], 0, 4, 3)).toEqual([]);
  });

  it("no particle color goes over the night bloom threshold", () => {
    for (const c of [DUST_COLOR, SPARK_COLOR]) expect(Math.max(...c)).toBeLessThan(0.92);
  });
});
