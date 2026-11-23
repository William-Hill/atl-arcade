import { describe, expect, it } from "vitest";
import { metrics, PROFILES, pushTapSweep, routeBot, runSession, runTrial } from "./bots.js";

describe("playtest bots", () => {
  it("a trial is deterministic for a seed", () => {
    const a = runTrial({ device: "keyboard", ctx: "air", intended: "l", profile: PROFILES[0], seed: 42 });
    const b = runTrial({ device: "keyboard", ctx: "air", intended: "l", profile: PROFILES[0], seed: 42 });
    expect(a).toEqual(b);
  });
  it("every trial gives a trick in each context and device", () => {
    for (const device of ["keyboard", "gamepad", "touch"]) {
      const m = metrics(runSession({ profile: PROFILES[2], device, trials: 30, seed: 5 }));
      expect(m.noTrick).toBe(0);
    }
  });
  it("a perfect player (no spread, no noise) gets every trick as wanted", () => {
    const perfect = { ...PROFILES[3], id: "perfect", dirMeanMs: -40, dirSdMs: 0, pushProb: 0, carveProb: 0, touch: { flickPx: [50, 0], angleSdDeg: 0, tapJitterPx: 0, flickMs: [60, 60] } };
    for (const device of ["keyboard", "gamepad", "touch"]) {
      expect(metrics(runSession({ profile: perfect, device, trials: 30, seed: 2 })).wantedShare).toBe(1);
    }
  });
  it("on touch, the stick (push and carve) never gives a trick direction", () => {
    const m = metrics(runSession({ profile: PROFILES[4], device: "touch", trials: 60, seed: 3 }));
    expect(m.unwantedUpFromPush).toBe(0);
    expect(m.unwantedLRFromCarve).toBe(0);
  });
  it("push taps with no pause turn neutral tricks into Up at about (dirBefore + dirAfter) / period", () => {
    const share = pushTapSweep({ period: 0.6, trials: 120 });
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.5);
  });
  it("the route bot banks a 3-link combo with a manual and a grab", () => {
    const r = routeBot({ seed: 3, maxSeconds: 30 });
    expect(r.firstComboSec).not.toBeNull();
    expect(r.bank.names).toContain("Japan Grab");
    expect(r.bank.names.some((n) => n === "Manual")).toBe(true);
    expect(r.bank.names.some((n) => n.endsWith("Grind"))).toBe(true);
  });
});
