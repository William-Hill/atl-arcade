import { describe, expect, it } from "vitest";
import { modeHref, modeRules, runMode } from "./run-mode.js";

describe("run modes (#260)", () => {
  it("reads the mode from the run parameter of the address", () => {
    expect(runMode(null)).toBe("timed");
    expect(runMode("tour")).toBe("tour");
    expect(runMode("free")).toBe("free");
    expect(runMode("other")).toBe("timed");
  });

  it("gives a tour claims with no timer and no run cap", () => {
    expect(modeRules("tour")).toEqual({ mode: "tour", timer: false, claims: true, capped: false });
    // A tour works on a level with no goal list too.
    expect(modeRules("tour", { hasGoals: false }).claims).toBe(true);
  });

  it("gives a timed round the timer, the claims and the run cap", () => {
    expect(modeRules("timed")).toEqual({ mode: "timed", timer: true, claims: true, capped: true });
  });

  it("plays free skate in a free run, and in a timed address on a level with no goals", () => {
    expect(modeRules("free")).toEqual({ mode: "free", timer: false, claims: false, capped: true });
    expect(modeRules("timed", { hasGoals: false }).mode).toBe("free");
  });

  it("makes the address of another mode and keeps the other parameters", () => {
    const base = "http://localhost:5180/?level=beltline-eastside&mute=1";
    const tour = modeHref(base, "tour");
    expect(new URL(tour).searchParams.get("run")).toBe("tour");
    expect(new URL(tour).searchParams.get("level")).toBe("beltline-eastside");
    expect(new URL(modeHref(tour, "timed")).searchParams.has("run")).toBe(false);
  });
});
