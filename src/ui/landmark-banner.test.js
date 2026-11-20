import { describe, expect, it } from "vitest";
import { BANNER, bannerLines, bannerLook, claimedFill, contrast, districtAccent } from "./landmark-banner.js";
import { DISTRICT_LOOKS } from "../render/pbr-palette.js";
import { isRed } from "../render/landmark-rings-math.js";

describe("the banner on show", () => {
  it("slides in from above and fades in for 0.3 s", () => {
    expect(bannerLook({ time: 3, left: 3 })).toEqual({ opacity: 0, y: -BANNER.slide });
    const mid = bannerLook({ time: 3, left: 2.85 });
    expect(mid.opacity).toBeCloseTo(0.5, 9);
    expect(mid.y).toBeLessThan(0);
    expect(bannerLook({ time: 3, left: 2.7 }).opacity).toBeCloseTo(1, 9);
    expect(bannerLook({ time: 3, left: 2.7 }).y).toBeCloseTo(0, 9);
    expect(bannerLook({ time: 3, left: 1.5 })).toEqual({ opacity: 1, y: -0 });
  });

  it("fades out in the last 0.3 s of its time", () => {
    expect(bannerLook({ time: 3, left: 0.15 }).opacity).toBeCloseTo(0.5, 9);
    expect(bannerLook({ time: 3, left: 0.15 }).y).toBeCloseTo(0, 9);
  });

  it("R-1: fades with no slide with reduced motion", () => {
    for (const left of [3, 2.9, 2.8, 2.7, 1, 0.2, 0.05]) expect(bannerLook({ time: 3, left }, true).y).toBe(0);
    expect(bannerLook({ time: 3, left: 2.85 }, true).opacity).toBeCloseTo(0.5, 9);
  });

  it("shows nothing for no banner", () => {
    expect(bannerLook(null)).toEqual({ opacity: 0, y: 0 });
  });
});

describe("the banner lines", () => {
  it("shows the name and the short line for a Found banner", () => {
    expect(bannerLines({ type: "found", id: "a", title: "Trail Bridge", text: "A bridge of 1910." })).toEqual({ title: "Trail Bridge", text: "A bridge of 1910.", points: "" });
  });

  it("shows SPOT CLAIMED, the name and the points for a Claimed banner", () => {
    expect(bannerLines({ type: "claimed", id: "a", title: "SPOT CLAIMED", text: "Trail Bridge", points: 300 })).toEqual({ title: "SPOT CLAIMED", text: "Trail Bridge", points: "+300" });
  });

  it("shows no points when the run cap is full", () => {
    expect(bannerLines({ type: "claimed", id: "a", title: "SPOT CLAIMED", text: "Trail Bridge", points: 0 }).points).toBe("");
  });
});

describe("the Claimed fill", () => {
  it("is the brightest accent of the district at the skater, and trail away from every district", () => {
    expect(districtAccent(0, 0, [])).toBe("#c9962e");
    expect(districtAccent(0, 0, [{ id: "old-fourth-ward", x: 0, z: 0, radius: 100 }])).toBe("#6f9bbf");
    expect(districtAccent(0, 0, [{ id: "inman-park", x: 0, z: 0, radius: 100 }])).toBe("#8fa88f");
  });

  it("reads with dark ink at 4.5:1 or more in every district, and is never red", () => {
    for (const id of Object.keys(DISTRICT_LOOKS)) {
      const fill = claimedFill(districtAccent(0, 0, id === "trail" ? [] : [{ id, x: 0, z: 0, radius: 100 }]));
      expect(contrast(fill, BANNER.ink)).toBeGreaterThanOrEqual(4.5);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(fill.slice(i, i + 2), 16));
      expect(isRed(r, g, b)).toBe(false);
    }
  });

  it("makes a dark accent lighter until the ink reads on it", () => {
    const fill = claimedFill("#2e3f66");
    expect(fill).not.toBe("#2e3f66");
    expect(contrast(fill, BANNER.ink)).toBeGreaterThanOrEqual(4.5);
    expect(claimedFill("#c9962e")).toBe("#c9962e");
  });

  it("has a Found banner text that reads on the dark pill", () => {
    expect(contrast("#f5ecd7", "#0b0b12")).toBeGreaterThanOrEqual(4.5);
  });
});
