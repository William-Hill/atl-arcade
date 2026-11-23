import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEffects, watchReducedMotion } from "./effects-view.js";
import { screenAnchor } from "./fx.js";

// A fake window with a prefers-reduced-motion media query that a test can flip.
function fakeWindow(matches) {
  const listeners = new Set();
  const mq = {
    matches,
    addEventListener: (type, fn) => type === "change" && listeners.add(fn),
    removeEventListener: (type, fn) => type === "change" && listeners.delete(fn),
  };
  const queries = [];
  return {
    queries,
    listeners,
    matchMedia: (q) => {
      queries.push(q);
      return mq;
    },
    flip(value) {
      mq.matches = value;
      for (const fn of [...listeners]) fn({ matches: value });
    },
  };
}

describe("watchReducedMotion", () => {
  it("reads the query at the start", () => {
    const win = fakeWindow(true);
    expect(watchReducedMotion(win).reduced).toBe(true);
    expect(win.queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(watchReducedMotion(fakeWindow(false)).reduced).toBe(false);
  });

  it("calls onChange when the setting changes, and stop() removes the listener", () => {
    const win = fakeWindow(false);
    const seen = [];
    const w = watchReducedMotion(win, (r) => seen.push(r));
    win.flip(true);
    win.flip(false);
    expect(seen).toEqual([true, false]);
    w.stop();
    expect(win.listeners.size).toBe(0);
    win.flip(true);
    expect(seen).toEqual([true, false]);
  });

  it("is false with no window or no matchMedia", () => {
    expect(watchReducedMotion(undefined).reduced).toBe(false);
    expect(watchReducedMotion({}).reduced).toBe(false);
    expect(() => watchReducedMotion({}).stop()).not.toThrow();
  });

  it("the effects layer turns off live when the setting changes", () => {
    const win = fakeWindow(false);
    const fx = createEffects({ tier: "high", win });
    expect(fx.policy.enabled).toBe(true);
    win.flip(true);
    expect(fx.reducedMotion).toBe(true);
    expect(fx.policy.enabled).toBe(false);
    fx.dispose();
    expect(win.listeners.size).toBe(0);
  });

  it("the player's choice wins over the media query, and null follows it again (#97)", () => {
    const win = fakeWindow(true);
    const fx = createEffects({ tier: "high", win });
    expect(fx.policy.enabled).toBe(false);
    fx.setReducedMotion(false);
    expect(fx.reducedMotion).toBe(false);
    expect(fx.deviceReducedMotion).toBe(true);
    expect(fx.policy.enabled).toBe(true);
    win.flip(false);
    win.flip(true);
    expect(fx.reducedMotion).toBe(false);
    fx.setReducedMotion(true);
    expect(fx.policy.enabled).toBe(false);
    fx.setReducedMotion(null);
    win.flip(false);
    expect(fx.reducedMotion).toBe(false);
    expect(fx.policy.enabled).toBe(true);
    fx.dispose();
  });
});

describe("screen anchor", () => {
  it("keeps a point in front as it is", () => {
    expect(screenAnchor(0.3, -0.2, false)).toEqual({ x: 0.3, y: -0.2 });
  });

  it("turns a point behind the camera back and puts it at the frame edge", () => {
    // Behind and to the right projects to the left: the anchor goes right.
    const a = screenAnchor(-0.4, 0.1, true);
    expect(a.x).toBeCloseTo(1, 9);
    expect(a.y).toBeCloseTo(-0.25, 9);
    expect(screenAnchor(-3, 0, true)).toEqual({ x: 3, y: -0 });
    expect(screenAnchor(0, 0, true)).toEqual({ x: 0, y: -1 });
  });

  it("the layer uses the unmirrored side for a skater behind the camera", () => {
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
    camera.position.set(0, 1, 0);
    camera.lookAt(0, 1, -10);
    camera.updateMatrixWorld();
    const fx = createEffects({ camera, tier: "high", win: fakeWindow(false) });
    fx.trigger("speed");
    // Behind the camera (+z) and to its right (+x).
    fx.update(1 / 60, { skater: { position: [3, 0.1, 4], speed: 20 } });
    expect(fx.info.lines).toBeGreaterThan(0);
    fx.dispose();
  });
});

describe("game-feel particles (#105)", () => {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 100);
  const base = (over = {}) => ({ position: [0, 0, -5], velocity: [0, 0, 0], speed: 0, yaw: 0, ...over });

  it("a hard landing spawns dust; a step down does not", () => {
    const fx = createEffects({ camera, tier: "high", win: fakeWindow(false) });
    fx.observe(base({ velocity: [0, -1, 0] }), base({ justLanded: true }));
    expect(fx.info.triggers.dust).toBe(0);
    fx.observe(base({ velocity: [0, -9, 0] }), base({ justLanded: true }));
    expect(fx.info.triggers.dust).toBe(1);
    fx.update(1 / 60, { skater: base() });
    expect(fx.info.bursts).toBeGreaterThanOrEqual(7);
    fx.dispose();
  });

  it("a wall slide spawns sparks each tick, fewer on phone, none on low", () => {
    const counts = {};
    for (const tier of ["low", "phone", "high"]) {
      const fx = createEffects({ camera, tier, win: fakeWindow(false) });
      for (let i = 0; i < 4; i += 1) fx.observe(base({ speed: 8 }), base({ wallSlide: true, speed: 8, velocity: [8, 0, 0], tick: i }));
      fx.update(1 / 120, { skater: base() });
      counts[tier] = fx.info.bursts;
      fx.dispose();
    }
    expect(counts.low).toBe(0);
    expect(counts.phone).toBe(8);
    expect(counts.high).toBe(12);
  });

  it("reduced motion turns the dust and sparks off", () => {
    const fx = createEffects({ camera, tier: "high", win: fakeWindow(true) });
    fx.observe(base({ velocity: [0, -9, 0] }), base({ justLanded: true, wallSlide: true, speed: 8 }));
    fx.update(1 / 60, { skater: base() });
    expect(fx.info.bursts).toBe(0);
    fx.dispose();
  });
});
