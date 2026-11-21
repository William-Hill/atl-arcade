import { describe, expect, it } from "vitest";
import { LOOK_DOWN_NOTICE, isLookDown, lookDownNotice, lookDownPlan } from "./look-down.js";
import { DEFAULT_SETTINGS } from "../ui/settings.js";

describe("isLookDown", () => {
  it("is true only for a rung with another look", () => {
    expect(isLookDown({ pixelRatio: 1.5, post: "lite", look: "toon" }, "pbr")).toBe(true);
    expect(isLookDown({ pixelRatio: 1, post: "lite", look: "pbr" }, "pbr")).toBe(false);
    expect(isLookDown({ pixelRatio: 1, post: null }, "pbr")).toBe(false);
    expect(isLookDown(undefined, "pbr")).toBe(false);
  });
});

describe("lookDownPlan", () => {
  it("turns a saved pbr choice into toon and marks the reload", () => {
    const plan = lookDownPlan("https://x.test/?level=beltline-eastside", { ...DEFAULT_SETTINGS, look: "pbr", ink: false });
    expect(plan.saved).toEqual({ ...DEFAULT_SETTINGS, look: "toon", ink: false });
    const url = new URL(plan.href);
    expect(url.searchParams.get("lookdown")).toBe("1");
    expect(url.searchParams.get("level")).toBe("beltline-eastside");
    expect(url.searchParams.has("look")).toBe(false);
  });
  it("turns a ?look=pbr flag into ?look=toon and keeps the other flags", () => {
    const plan = lookDownPlan("https://x.test/?quality=phone&look=pbr&fps=1", { ...DEFAULT_SETTINGS });
    const url = new URL(plan.href);
    expect(url.searchParams.get("look")).toBe("toon");
    expect(url.searchParams.get("quality")).toBe("phone");
    expect(url.searchParams.get("fps")).toBe("1");
    expect(plan.saved).toBe(null);
  });
  it("changes both when the address and the saved choice say pbr", () => {
    const plan = lookDownPlan("https://x.test/?look=pbr", { ...DEFAULT_SETTINGS, look: "pbr" });
    expect(new URL(plan.href).searchParams.get("look")).toBe("toon");
    expect(plan.saved.look).toBe("toon");
  });
  it("carries the look in the address when there is no storage", () => {
    const plan = lookDownPlan("https://x.test/", null);
    expect(new URL(plan.href).searchParams.get("look")).toBe("toon");
    expect(plan.saved).toBe(null);
  });
});

describe("lookDownNotice", () => {
  it("gives the line once and takes the flag out of the address", () => {
    const n = lookDownNotice("https://x.test/?look=toon&lookdown=1");
    expect(n.text).toBe(LOOK_DOWN_NOTICE);
    expect(n.href).toBe("https://x.test/?look=toon");
    expect(lookDownNotice(n.href).text).toBe(null);
  });
  it("is short and plain", () => {
    expect(LOOK_DOWN_NOTICE.length).toBeLessThanOrEqual(60);
  });
});
