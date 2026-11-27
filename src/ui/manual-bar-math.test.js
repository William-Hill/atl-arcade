import { describe, expect, it } from "vitest";
import { MANUAL_BAR, barHeight, barTarget, fixedPlace, followStep, hitsBlocker, markerLook, markerTop, pickSide, safeRect, smoothToward, zoneOf } from "./manual-bar-math.js";

const size = { w: MANUAL_BAR.w, h: barHeight(false) };

describe("#330 E4 the manual balance bar", () => {
  it("the marker place for m = -1, 0, 0.5, 1", () => {
    expect(markerTop(-1, 180)).toBe(0);
    expect(markerTop(0, 180)).toBe(90);
    expect(markerTop(0.5, 180)).toBe(135);
    expect(markerTop(1, 180)).toBe(180);
    expect(markerTop(3, 160)).toBe(160);
    expect(markerTop(NaN, 160)).toBe(80);
  });

  it("the zone of each m (pattern first, color second)", () => {
    expect(zoneOf(0)).toBe("safe");
    expect(zoneOf(-0.49)).toBe("safe");
    expect(zoneOf(0.5)).toBe("warning");
    expect(zoneOf(-0.79)).toBe("warning");
    expect(zoneOf(0.8)).toBe("limit");
    expect(zoneOf(-1)).toBe("limit");
  });

  it("the bar is 180 px high on a desktop and 160 px on a compact screen, plus 2 labels of 16 px", () => {
    expect(barHeight(false)).toBe(212);
    expect(barHeight(true)).toBe(192);
  });

  it("the bar goes 56 px right of the skater; the side flips when the right side has no room", () => {
    const safe = safeRect(1280, 720);
    expect(pickSide({ x: 640, y: 360 }, size, safe)).toBe("right");
    expect(barTarget({ x: 640, y: 360 }, "right", size, safe)).toEqual({ x: 696, y: 360 });
    expect(pickSide({ x: 1240, y: 360 }, size, safe)).toBe("left");
    expect(barTarget({ x: 1240, y: 360 }, "left", size, safe)).toEqual({ x: 1184, y: 360 });
  });

  it("the bar stays inside the safe rectangle and off the blockers", () => {
    const safe = safeRect(412, 839, { top: 0, right: 0, bottom: 0, left: 0 });
    const t = barTarget({ x: 200, y: 20 }, "right", size, safe);
    expect(t.y - size.h / 2).toBeGreaterThanOrEqual(safe.y);
    const blocker = { x: 240, y: 300, w: 160, h: 200 };
    const b = barTarget({ x: 200, y: 400 }, "right", size, safe, [blocker]);
    const r = { x: b.x - size.w / 2, y: b.y - size.h / 2, w: size.w, h: size.h };
    const hit = r.x < blocker.x + blocker.w && blocker.x < r.x + r.w && r.y < blocker.y + blocker.h && blocker.y < r.y + r.h;
    expect(hit).toBe(false);
  });

  it("hitsBlocker finds a bar on a blocker (the smoothing path check)", () => {
    const blocker = { x: 690, y: 300, w: 100, h: 100 };
    expect(hitsBlocker({ x: 696, y: 350 }, size, [blocker])).toBe(true);
    expect(hitsBlocker({ x: 696, y: 520 }, size, [blocker])).toBe(false);
    expect(hitsBlocker({ x: 600, y: 350 }, size, [])).toBe(false);
  });

  it("followStep: the rendered bar jumps to the clear target when the smoothed place hits a blocker", () => {
    const blocker = { x: 690, y: 300, w: 100, h: 100 };
    // The review example: from (696, 520) to the target (696, 180), half the way in one step.
    const dt = 0.12 * Math.LN2;
    const plain = smoothToward({ x: 696, y: 520 }, { x: 696, y: 180 }, dt);
    expect(hitsBlocker(plain, size, [blocker])).toBe(true);
    const step = followStep({ x: 696, y: 520 }, { x: 696, y: 180 }, dt, size, [blocker]);
    expect(step).toEqual({ x: 696, y: 180 });
    expect(hitsBlocker(step, size, [blocker])).toBe(false);
    // With no blocker on the path it smooths as before.
    expect(followStep({ x: 696, y: 520 }, { x: 696, y: 180 }, dt, size, [])).toEqual(plain);
  });

  it("the smoothing step moves 1 - exp(-dt / 0.12) of the distance", () => {
    const a = 1 - Math.exp(-(1 / 60) / 0.12);
    const n = smoothToward({ x: 0, y: 0 }, { x: 100, y: -50 }, 1 / 60);
    expect(n.x).toBeCloseTo(100 * a, 9);
    expect(n.y).toBeCloseTo(-50 * a, 9);
    expect(smoothToward(null, { x: 5, y: 6 }, 1 / 60)).toEqual({ x: 5, y: 6 });
    expect(smoothToward({ x: 1, y: 1 }, { x: 5, y: 6 }, 0)).toEqual({ x: 1, y: 1 });
  });

  it("with reduced motion the bar has a fixed place: 120 px right of the center", () => {
    const safe = safeRect(1280, 720);
    expect(fixedPlace(1280, 720, size, safe)).toEqual({ x: 760, y: 360 });
  });

  it("the marker pulses at 2 Hz at |m| >= 0.7; with reduced motion no pulse, an alert mark", () => {
    expect(markerLook(0.69, 0.25)).toEqual({ opacity: 1, alert: false, near: false });
    expect(markerLook(0.7, 0).opacity).toBeCloseTo(1, 9);
    expect(markerLook(-0.9, 0.25).opacity).toBeCloseTo(0.55, 9); // half a period at 2 Hz
    expect(markerLook(0.9, 0.5).opacity).toBeCloseTo(1, 9);
    expect(markerLook(0.9, 0.25, true)).toEqual({ opacity: 1, alert: true, near: true });
    expect(MANUAL_BAR.pulseHz).toBeLessThanOrEqual(3);
  });
});
