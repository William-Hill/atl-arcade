import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { INTRO, INTRO_SEEN_KEY, createFront, flightLine, flightPose, frontPress, frontStep, introPlan, introSeen, keyStarts, logoOpacity, markIntroSeen, pointAt, titlePose } from "./intro.js";

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

describe("introPlan", () => {
  it("plays the intro on a first visit", () => {
    expect(introPlan({})).toEqual({ start: "intro", reason: "first-visit" });
  });
  it("goes to the title screen on a return visit", () => {
    expect(introPlan({ seen: true }).start).toBe("title");
  });
  it("?intro=0 goes straight to the game, also on a first visit", () => {
    expect(introPlan({ param: "0" }).start).toBe("play");
    expect(introPlan({ param: "off", seen: true }).start).toBe("play");
  });
  it("the autopilot goes to the game", () => {
    expect(introPlan({ autopilot: true })).toEqual({ start: "play", reason: "autopilot" });
  });
  it("goes to the game under WebDriver, so the e2e suite keeps its start", () => {
    expect(introPlan({ webdriver: true })).toEqual({ start: "play", reason: "webdriver" });
  });
  it("?intro=1 plays the intro under WebDriver and on a return visit", () => {
    expect(introPlan({ param: "1", webdriver: true, seen: true }).start).toBe("intro");
  });
  it("?intro=title goes to the title screen", () => {
    expect(introPlan({ param: "title", webdriver: true }).start).toBe("title");
  });
  it("reduced motion never plays the flight", () => {
    expect(introPlan({ reducedMotion: true }).start).toBe("title");
    expect(introPlan({ param: "1", reducedMotion: true })).toEqual({ start: "title", reason: "reduced-motion" });
  });
  it("a non-geodata level or a non-follow view goes to the game", () => {
    expect(introPlan({ param: "1", geo: false }).start).toBe("play");
    expect(introPlan({ param: "1", view: "orbit" }).start).toBe("play");
  });
});

describe("return visit storage", () => {
  it("is false on a first visit and true after markIntroSeen", () => {
    const s = memoryStorage();
    expect(introSeen(s)).toBe(false);
    markIntroSeen(s);
    expect(introSeen(s)).toBe(true);
    expect(s.getItem(INTRO_SEEN_KEY)).toBe("1");
  });
  it("ignores a missing or broken storage", () => {
    expect(introSeen(null)).toBe(false);
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(introSeen(broken)).toBe(false);
    expect(() => markIntroSeen(broken)).not.toThrow();
  });
});

describe("phase steps", () => {
  it("the intro goes to the title screen after INTRO.seconds", () => {
    let s = createFront({ start: "intro" });
    let changes = 0;
    for (let i = 0; i < Math.ceil(INTRO.seconds / 0.1) + 1; i += 1) {
      s = frontStep(s, 0.1);
      if (s.changed) changes += 1;
    }
    expect(s.phase).toBe("title");
    expect(changes).toBe(1);
  });
  it("a press skips the intro, then a press starts the game", () => {
    let s = createFront({ start: "intro" });
    s = frontStep(s, 1);
    s = frontPress(s);
    expect(s).toMatchObject({ phase: "title", t: 0, changed: true, from: "intro" });
    s = frontPress(s);
    expect(s).toMatchObject({ phase: "play", changed: true, from: "title" });
    s = frontPress(s);
    expect(s).toMatchObject({ phase: "play", changed: false });
  });
  it("the title screen stays until a press", () => {
    let s = createFront({ start: "title" });
    for (let i = 0; i < 1000; i += 1) s = frontStep(s, 0.1);
    expect(s.phase).toBe("title");
  });
  it("the flight moves in the intro, the title camera turns on the title screen, and neither with moving false", () => {
    const s0 = createFront({ start: "intro" });
    const s1 = frontStep(s0, 0.1);
    expect(s1.flight).toBeCloseTo(s0.flight + INTRO.speed * 0.1);
    expect(s1.orbit).toBe(0);
    const t0 = createFront({ start: "title" });
    const t1 = frontStep(t0, 0.1);
    expect(t1.orbit).toBeCloseTo(INTRO.titleTurn * 0.1);
    expect(t1.flight).toBe(t0.flight);
    expect(frontStep(s0, 0.1, { moving: false }).flight).toBe(s0.flight);
    expect(frontStep(t0, 0.1, { moving: false }).orbit).toBe(0);
  });
  it("a slow frame does not jump the flight or the clock", () => {
    const s = frontStep(createFront({ start: "intro" }), 5);
    expect(s.t).toBe(INTRO.maxStep);
    expect(s.phase).toBe("intro");
  });
  it("a negative frame time does nothing", () => {
    const s0 = createFront({ start: "intro" });
    const s1 = frontStep(s0, -1);
    expect(s1.t).toBe(0);
    expect(s1.flight).toBe(s0.flight);
  });
  it("the game phase does not change", () => {
    const s = createFront({ start: "play" });
    expect(frontStep(s, 1)).toBe(s);
  });
});

describe("keyStarts", () => {
  it("a letter, Space, Enter, or an arrow starts the game", () => {
    for (const code of ["KeyW", "Space", "Enter", "ArrowUp"]) expect(keyStarts({ code })).toBe(true);
  });
  it("a modifier, Tab, the settings key, or a repeat does not", () => {
    for (const code of ["ShiftLeft", "Tab", "KeyO", "Escape"]) expect(keyStarts({ code })).toBe(false);
    expect(keyStarts({ code: "KeyW", repeat: true })).toBe(false);
    expect(keyStarts({ code: "KeyR", ctrlKey: true })).toBe(false);
  });
});

describe("logoOpacity", () => {
  it("fades in during the intro and is full on the title screen", () => {
    expect(logoOpacity({ phase: "intro", t: 0 })).toBe(0);
    expect(logoOpacity({ phase: "intro", t: INTRO.logoDelay + INTRO.logoFade / 2 })).toBeCloseTo(0.5);
    expect(logoOpacity({ phase: "intro", t: 100 })).toBe(1);
    expect(logoOpacity({ phase: "title", t: 0 })).toBe(1);
    expect(logoOpacity({ phase: "play", t: 0 })).toBe(0);
  });
  it("shows at once with reduced motion", () => {
    expect(logoOpacity({ phase: "intro", t: 0 }, { reducedMotion: true })).toBe(1);
  });
});

describe("flight line", () => {
  const square = { points: [[0, 0], [10, 0], [10, 10]], length: 20 };
  it("walks the line and wraps at the end", () => {
    expect(pointAt(square, 5)).toMatchObject({ x: 5, z: 0, dir: [1, 0] });
    expect(pointAt(square, 15)).toMatchObject({ x: 10, z: 5, dir: [0, 1] });
    expect(pointAt(square, 25)).toMatchObject({ x: 5, z: 0 });
  });
  it("picks the longest trail strip", () => {
    const line = flightLine([
      { kind: "street", points: [[0, 0], [1000, 0]] },
      { kind: "trail", id: "a", points: [[0, 0], [10, 0]] },
      { kind: "trail", id: "b", points: [[0, 0], [0, 30]] },
    ]);
    expect(line).toMatchObject({ id: "b", length: 30 });
    expect(flightLine([{ kind: "street", points: [[0, 0], [1, 0]] }])).toBeNull();
  });
  it("the camera is over the ground, to the right, and looks ahead", () => {
    const line = { points: [[0, 0], [100, 0]], length: 100 };
    const pose = flightPose(line, 10, () => 5);
    expect(pose.position[1]).toBe(5 + INTRO.height);
    // Travel to +x (east): the right side is +z (south).
    expect(pose.position[2]).toBe(INTRO.side);
    expect(pose.target[0]).toBeCloseTo(10 + INTRO.lookAhead);
    expect(pose.target[1]).toBe(5 + INTRO.lookHeight);
  });
  it("on the BeltLine Eastside level, the flight follows the Eastside Trail", () => {
    const level = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));
    const line = flightLine(level.strips);
    expect(line.length).toBeGreaterThan(INTRO.seconds * INTRO.speed + INTRO.startAt);
    const pose = flightPose(line, INTRO.startAt);
    const { minX, maxX, minZ, maxZ } = level.bounds;
    expect(pose.position[0]).toBeGreaterThan(minX);
    expect(pose.position[0]).toBeLessThan(maxX);
    expect(pose.position[2]).toBeGreaterThan(minZ);
    expect(pose.position[2]).toBeLessThan(maxZ);
  });
});

describe("titlePose", () => {
  it("keeps the camera at the title distance and looks at the skater", () => {
    for (const orbit of [0, 1, 3]) {
      const p = titlePose([10, 2, -5], 0.4, orbit);
      expect(Math.hypot(p.position[0] - 10, p.position[2] + 5)).toBeCloseTo(INTRO.titleRadius);
      expect(p.position[1]).toBe(2 + INTRO.titleHeight);
      expect(p.target).toEqual([10, 2 + INTRO.titleLook, -5]);
    }
  });
  it("starts in front of the skater", () => {
    const yaw = 1.2;
    const p = titlePose([0, 0, 0], yaw, 0);
    const forward = [Math.cos(yaw), -Math.sin(yaw)];
    expect(p.position[0] * forward[0] + p.position[2] * forward[1]).toBeGreaterThan(0);
  });
});
