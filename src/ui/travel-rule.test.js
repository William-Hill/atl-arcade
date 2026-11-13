import { describe, expect, it } from "vitest";
import { canTravelTo, travelHint, travelMode } from "./travel-rule.js";

describe("travelMode", () => {
  it("keeps the default: any in the dev server, off in a production build", () => {
    expect(travelMode(null, { dev: true })).toBe("any");
    expect(travelMode(null, { dev: false })).toBe("off");
    expect(travelMode(undefined)).toBe("off");
  });

  it("reads ?travel=1, ?travel=0 and ?travel=found in both builds", () => {
    for (const dev of [true, false]) {
      expect(travelMode("1", { dev })).toBe("any");
      expect(travelMode("0", { dev })).toBe("off");
      expect(travelMode("found", { dev })).toBe("found");
    }
  });

  it("turns travel off for an unknown value", () => {
    expect(travelMode("yes", { dev: true })).toBe("off");
    expect(travelMode("", { dev: true })).toBe("off");
  });
});

describe("canTravelTo", () => {
  const unknown = { state: "unknown" };
  const found = { state: "found" };
  const claimed = { state: "claimed" };

  it("allows every pick in the any mode", () => {
    for (const spot of [null, unknown, found, claimed]) expect(canTravelTo("any", spot)).toBe(true);
  });

  it("allows only Found and Claimed spots in the found mode", () => {
    expect(canTravelTo("found", null)).toBe(false);
    expect(canTravelTo("found", unknown)).toBe(false);
    expect(canTravelTo("found", found)).toBe(true);
    expect(canTravelTo("found", claimed)).toBe(true);
  });

  it("allows nothing when travel is off", () => {
    for (const spot of [null, unknown, found, claimed]) expect(canTravelTo("off", spot)).toBe(false);
  });
});

describe("travelHint", () => {
  it("names the rule of the mode", () => {
    expect(travelHint("any")).toBe(" · click, then T: travel");
    expect(travelHint("found")).toBe(" · click a found spot, then T: travel");
    expect(travelHint("off")).toBe("");
  });
});
