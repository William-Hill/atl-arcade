import { describe, expect, it } from "vitest";
import { CAMERA_FX, cameraFxOffsets, createCameraFx, kickFor, landingImpact, shakeNoise, stepCameraFx, stepSpring } from "./camera-fx.js";
import { CAMERA, SKATE } from "./skate/constants.js";

const DT = 1 / 60;
const rest = { state: "rolling", speed: 0, velocity: [0, 0, 0] };

function run(fx, skater, frames, events = [], opts = {}) {
  let f = stepCameraFx(fx, skater, events, DT, opts);
  for (let i = 1; i < frames; i += 1) f = stepCameraFx(f, skater, [], DT, opts);
  return f;
}

// A skater that falls at `vy` m/s, then lands.
function land(vy, opts = {}) {
  let fx = stepCameraFx(createCameraFx(), { state: "air", speed: 5, velocity: [5, vy, 0] }, [], DT, opts);
  fx = stepCameraFx(fx, { state: "rolling", speed: 5, velocity: [5, 0, 0] }, [{ type: "land" }], DT, opts);
  return fx;
}

const ZERO = { fov: 0, right: 0, up: 0, roll: 0, flash: 0 };

describe("camera fx at rest", () => {
  it("gives offsets of exactly 0 at a standstill", () => {
    expect(cameraFxOffsets(run(createCameraFx(), rest, 120))).toEqual(ZERO);
  });

  it("goes back to exactly 0 after every effect", () => {
    let fx = land(-14);
    fx = stepCameraFx(fx, rest, [{ type: "gap" }, { type: "fall" }, { type: "bank", points: 9000 }], DT);
    fx = run(fx, rest, 600);
    expect(cameraFxOffsets(fx)).toEqual(ZERO);
  });
});

describe("speed FOV", () => {
  it("widens the view to speedFov at the top speed", () => {
    const fx = run(createCameraFx(), { ...rest, speed: SKATE.maxSpeed }, 300);
    expect(cameraFxOffsets(fx).fov).toBeCloseTo(CAMERA_FX.speedFov, 3);
  });

  it("caps over the top speed and scales under it", () => {
    expect(cameraFxOffsets(run(createCameraFx(), { ...rest, speed: SKATE.maxSpeed * 3 }, 300)).fov).toBeCloseTo(CAMERA_FX.speedFov, 3);
    const half = (SKATE.maxSpeed + CAMERA_FX.fovStart) / 2;
    expect(cameraFxOffsets(run(createCameraFx(), { ...rest, speed: half }, 300)).fov).toBeCloseTo(CAMERA_FX.speedFov / 2, 3);
  });

  it("keeps the base view at a slow creep", () => {
    expect(cameraFxOffsets(run(createCameraFx(), { ...rest, speed: CAMERA_FX.fovStart }, 300)).fov).toBe(0);
  });

  it("eases in, with no jump on the first frame", () => {
    const fx = stepCameraFx(createCameraFx(), { ...rest, speed: SKATE.maxSpeed }, [], DT);
    expect(fx.fov).toBeGreaterThan(0);
    expect(fx.fov).toBeLessThan(CAMERA_FX.speedFov * 0.1);
  });
});

describe("landing", () => {
  it("gives no dip and no shake on a soft landing", () => {
    expect(landingImpact(2)).toEqual({ dip: 0, trauma: 0 });
    const fx = land(-2);
    expect(fx.dip.v).toBe(0);
    expect(fx.trauma).toBe(0);
  });

  it("dips the camera down, then springs back", () => {
    let fx = land(-8);
    let low = 0;
    for (let i = 0; i < 60; i += 1) {
      low = Math.min(low, cameraFxOffsets(fx).up);
      fx = stepCameraFx(fx, rest, [], DT);
    }
    expect(low).toBeLessThan(0);
    expect(low).toBeGreaterThanOrEqual(-CAMERA_FX.maxDip);
    expect(cameraFxOffsets(run(fx, rest, 120)).up).toBe(0);
  });

  it("peaks near the dip size of the impact", () => {
    const { dip } = landingImpact(9);
    let fx = land(-9);
    let low = 0;
    for (let i = 0; i < 30; i += 1) {
      low = Math.min(low, fx.dip.x);
      fx = stepCameraFx(fx, rest, [], DT);
    }
    expect(-low).toBeCloseTo(dip, 2);
  });

  it("caps the dip and the landing trauma", () => {
    expect(landingImpact(100)).toEqual({ dip: CAMERA_FX.maxDip, trauma: CAMERA_FX.landTrauma });
  });

  it("shakes only from hardLand up", () => {
    expect(land(-(CAMERA_FX.hardLand - 0.5)).trauma).toBe(0);
    expect(land(-(CAMERA_FX.hardLand + 4)).trauma).toBeGreaterThan(0);
  });
});

describe("shake", () => {
  it("shakes on a fall and decays to 0", () => {
    let fx = stepCameraFx(createCameraFx(), rest, [{ type: "fall" }], DT);
    expect(fx.trauma).toBeGreaterThan(0.6);
    let peak = 0;
    for (let i = 0; i < 30; i += 1) {
      const o = cameraFxOffsets(fx);
      peak = Math.max(peak, Math.hypot(o.right, o.up));
      fx = stepCameraFx(fx, rest, [], DT);
    }
    expect(peak).toBeGreaterThan(0);
    fx = run(fx, rest, 60);
    expect(fx.trauma).toBe(0);
  });

  it("stays inside the caps", () => {
    let fx = stepCameraFx(createCameraFx(), rest, [{ type: "fall" }], DT);
    fx = { ...fx, trauma: 1 };
    for (let i = 0; i < 200; i += 1) {
      const o = cameraFxOffsets({ ...fx, time: i * 0.013 });
      expect(Math.abs(o.right)).toBeLessThanOrEqual(CAMERA_FX.shakeOffset);
      expect(Math.abs(o.roll)).toBeLessThanOrEqual(CAMERA_FX.shakeRoll);
    }
  });

  it("is deterministic", () => {
    const a = cameraFxOffsets(run(createCameraFx(), rest, 7, [{ type: "fall" }]));
    const b = cameraFxOffsets(run(createCameraFx(), rest, 7, [{ type: "fall" }]));
    expect(a).toEqual(b);
    expect(Math.abs(shakeNoise(3.3, 1))).toBeLessThanOrEqual(1);
  });
});

describe("landing fall speed", () => {
  it("uses the fall speed once: a second landing with no air frame gives no dip", () => {
    let fx = land(-12);
    fx = run(fx, rest, 120);
    fx = stepCameraFx(fx, rest, [{ type: "land" }], DT);
    expect(fx.dip.v).toBe(0);
    expect(fx.trauma).toBe(0);
  });
});

describe("a long frame", () => {
  it("shows a new bank flash and a new fall shake at full size on their first frame", () => {
    const fx = stepCameraFx(createCameraFx(), rest, [{ type: "bank", points: CAMERA_FX.bigBank }, { type: "fall" }], 0.1);
    expect(fx.flash).toBe(CAMERA_FX.bankFlash);
    expect(fx.trauma).toBe(CAMERA_FX.fallTrauma);
  });

  it("uses the fall speed of the land event when it has one", () => {
    // The last air frame saw 2 m/s, but the landing tick fell at 12 m/s.
    let fx = stepCameraFx(createCameraFx(), { state: "air", speed: 5, velocity: [5, -2, 0] }, [], DT);
    fx = stepCameraFx(fx, rest, [{ type: "land", fall: 12 }], DT);
    expect(fx.trauma).toBeCloseTo(landingImpact(12).trauma, 9);
    // A 2 m/s fall gives no dip; the 12 m/s fall does.
    expect(fx.dip.v).toBeLessThan(0);
  });
});

describe("shake frequency", () => {
  it("has its main wave at shakeFreq Hz", () => {
    expect(shakeNoise(0.25, 0)).toBeCloseTo(0.5 + 0.3 * Math.sin(2 * Math.PI * 0.25 * 2.31) + 0.2 * Math.sin(2 * Math.PI * 0.25 * 4.17), 9);
    const fx = { ...createCameraFx(), trauma: 1 };
    const a = cameraFxOffsets({ ...fx, time: 0 });
    const b = cameraFxOffsets({ ...fx, time: 100 / CAMERA_FX.shakeFreq });
    // After whole cycles of all three waves (100 cycles of 1, 231 of 2.31,
    // 417 of 4.17), the shake is back where it started.
    expect(b.right).toBeCloseTo(a.right, 6);
  });
});

describe("wall margin", () => {
  it("keeps the shake inside the wall clip margin", () => {
    expect(CAMERA_FX.shakeOffset).toBeLessThan(CAMERA.clipMargin);
  });
});

describe("grind lean", () => {
  it("rolls with the grind balance and levels off the rail", () => {
    const grind = { state: "grind", speed: 6, velocity: [6, 0, 0], grind: { balance: 1 } };
    let fx = run(createCameraFx(), grind, 120);
    expect(cameraFxOffsets(fx).roll).toBeCloseTo(CAMERA_FX.grindRoll, 3);
    fx = run(fx, { ...grind, grind: { balance: -1 } }, 120);
    expect(cameraFxOffsets(fx).roll).toBeCloseTo(-CAMERA_FX.grindRoll, 3);
    fx = run(fx, rest, 120);
    expect(cameraFxOffsets(fx).roll).toBe(0);
  });
});

describe("zoom punch and flash", () => {
  it("narrows the view on a gap, then springs back", () => {
    let fx = stepCameraFx(createCameraFx(), rest, [{ type: "gap" }], DT);
    let low = 0;
    for (let i = 0; i < 40; i += 1) {
      low = Math.min(low, cameraFxOffsets(fx).fov);
      fx = stepCameraFx(fx, rest, [], DT);
    }
    expect(low).toBeCloseTo(CAMERA_FX.punchFov, 0);
    expect(cameraFxOffsets(fx).flash).toBe(0);
  });

  it("flashes on a gap", () => {
    const fx = stepCameraFx(createCameraFx(), rest, [{ type: "gap" }], DT);
    expect(cameraFxOffsets(fx).flash).toBe(CAMERA_FX.gapFlash);
  });

  it("punches on a big bank only", () => {
    const small = stepCameraFx(createCameraFx(), rest, [{ type: "bank", points: CAMERA_FX.bigBank - 1 }], DT);
    expect(small.punch.v).toBe(0);
    expect(small.flash).toBe(0);
    const big = stepCameraFx(createCameraFx(), rest, [{ type: "bank", points: CAMERA_FX.bigBank }], DT);
    expect(big.punch.v).toBeLessThan(0);
    expect(big.flash).toBeGreaterThan(0);
  });
});

describe("reduced motion", () => {
  it("keeps only a smaller speed FOV", () => {
    const opts = { reduced: true };
    let fx = land(-14, opts);
    fx = stepCameraFx(fx, { state: "grind", speed: SKATE.maxSpeed, velocity: [0, 0, 0], grind: { balance: 1 } }, [{ type: "gap" }, { type: "fall" }], DT, opts);
    for (let i = 0; i < 300; i += 1) {
      fx = stepCameraFx(fx, { ...rest, speed: SKATE.maxSpeed }, [], DT, opts);
      const o = cameraFxOffsets(fx);
      expect(o.right).toBe(0);
      expect(o.up).toBe(0);
      expect(o.roll).toBe(0);
      expect(o.flash).toBe(0);
    }
    expect(cameraFxOffsets(fx).fov).toBeCloseTo(CAMERA_FX.speedFov * CAMERA_FX.reducedFovScale, 3);
  });
});

describe("spring", () => {
  it("peaks at the kick size and is stable with a long frame", () => {
    let s = { x: 0, v: kickFor(0.2, 12) };
    let peak = 0;
    for (let i = 0; i < 600; i += 1) {
      s = stepSpring(s, 12, 1 / 600);
      peak = Math.max(peak, s.x);
    }
    expect(peak).toBeCloseTo(0.2, 3);
    const long = stepSpring({ x: 1, v: 0 }, 12, 0.1);
    expect(Math.abs(long.x)).toBeLessThan(1);
  });
});
