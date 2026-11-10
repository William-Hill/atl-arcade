import { describe, expect, it } from "vitest";
import { BETTER_ORIENTATION, fullscreenApi, fullscreenLabel, orientationOf, wantsTurnHint } from "./screen.js";

describe("the turn hint (#97, MOB-9)", () => {
  it("landscape plays better on a phone", () => {
    expect(BETTER_ORIENTATION).toBe("landscape");
    expect(orientationOf(390, 844)).toBe("portrait");
    expect(orientationOf(844, 390)).toBe("landscape");
  });

  it("shows in portrait with touch controls only", () => {
    expect(wantsTurnHint({ touch: true, width: 390, height: 844 })).toBe(true);
    expect(wantsTurnHint({ touch: true, width: 844, height: 390 })).toBe(false);
    expect(wantsTurnHint({ touch: false, width: 390, height: 844 })).toBe(false);
  });
});

describe("fullscreenApi", () => {
  const calls = [];
  const standard = {
    fullscreenEnabled: true,
    fullscreenElement: null,
    exitFullscreen: () => calls.push("exit"),
    documentElement: { requestFullscreen: (o) => calls.push(["enter", o]) },
  };

  it("uses the standard API", () => {
    const api = fullscreenApi(standard);
    expect(api.event).toBe("fullscreenchange");
    expect(api.active()).toBe(false);
    api.enter();
    api.exit();
    expect(calls).toEqual([["enter", { navigationUI: "hide" }], "exit"]);
    standard.fullscreenElement = {};
    expect(api.active()).toBe(true);
  });

  it("falls back to the webkit names", () => {
    const doc = { webkitFullscreenElement: null, webkitExitFullscreen() {}, documentElement: { webkitRequestFullscreen() {} } };
    expect(fullscreenApi(doc).event).toBe("webkitfullscreenchange");
  });

  it("is null on iPhone Safari, where a page cannot go fullscreen", () => {
    expect(fullscreenApi({ documentElement: {} })).toBe(null);
    expect(fullscreenApi({ fullscreenEnabled: false, documentElement: { requestFullscreen() {} } })).toBe(null);
    expect(fullscreenApi(null)).toBe(null);
  });

  it("names the button for each state", () => {
    expect(fullscreenLabel(false).text).toBe("FULL SCREEN");
    expect(fullscreenLabel(true).name).toBe("Exit full screen");
  });
});
