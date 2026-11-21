import { describe, expect, it } from "vitest";
import { ATLANTA, dayOfYear, skyState, sunState, weatherFor, weatherOverride, wetAt } from "./weather.js";

describe("dayOfYear", () => {
  it("counts the days of the year", () => {
    expect(dayOfYear(new Date(2026, 0, 1))).toBe(1);
    expect(dayOfYear(new Date(2026, 11, 31))).toBe(365);
    expect(dayOfYear(new Date(2028, 11, 31))).toBe(366); // leap
  });
});

describe("sunState", () => {
  it("puts the noon sun due south at the solstice elevations of Atlanta", () => {
    // Winter solstice (day 355): 90 - |33.75 - (-23.44)| = 32.8 deg.
    const winter = sunState({ day: 355, hour: 12.6, place: ATLANTA });
    expect(winter.elevation).toBeCloseTo(32.8, 0);
    // Summer solstice (day 172): 90 - |33.75 - 23.44| = 79.7 deg.
    const summer = sunState({ day: 172, hour: 13.6, place: ATLANTA });
    expect(summer.elevation).toBeCloseTo(79.7, 0);
    // Both due south: the level frame has north at -z, so south is +z.
    expect(winter.dir[2]).toBeGreaterThan(0.9 * Math.abs(winter.dir[0]));
    expect(winter.dir[2]).toBeGreaterThan(0);
  });

  it("rises in the east and sets in the west", () => {
    const morning = sunState({ day: 172, hour: 8, place: ATLANTA });
    const evening = sunState({ day: 172, hour: 18, place: ATLANTA });
    expect(morning.dir[0]).toBeGreaterThan(0); // east
    expect(evening.dir[0]).toBeLessThan(0); // west
    expect(morning.elevation).toBeGreaterThan(0);
  });

  it("is below the horizon at night", () => {
    const night = sunState({ day: 355, hour: 2, place: ATLANTA });
    expect(night.elevation).toBeLessThan(-20);
    expect(night.dir[1]).toBeLessThan(0);
  });

  it("moves solar noon late for the longitude west of the zone meridian", () => {
    // Solar noon (highest sun) is after civil noon in Atlanta.
    const noon = sunState({ day: 100, hour: 12, place: ATLANTA });
    const later = sunState({ day: 100, hour: 12.6, place: ATLANTA });
    expect(later.elevation).toBeGreaterThan(noon.elevation);
  });
});

describe("weatherFor", () => {
  it("is deterministic for a day and an hour", () => {
    const a = weatherFor({ day: 200, hour: 15, seed: 1 });
    const b = weatherFor({ day: 200, hour: 15, seed: 1 });
    expect(a).toEqual(b);
  });

  it("varies from day to day", () => {
    const kinds = new Set();
    for (let d = 170; d < 200; d += 1) kinds.add(weatherFor({ day: d, hour: 15, seed: 2 }).kind);
    expect(kinds.size).toBeGreaterThan(1);
  });

  it("rains about as often as Atlanta over a year", () => {
    let rainDays = 0;
    for (let d = 1; d <= 365; d += 1) {
      let dayRain = 0;
      for (const h of [9, 13, 17]) dayRain = Math.max(dayRain, weatherFor({ day: d, hour: h, seed: 3 }).rain);
      if (dayRain > 0.2) rainDays += 1;
    }
    expect(rainDays).toBeGreaterThan(60);
    expect(rainDays).toBeLessThan(160);
  });

  it("keeps October clearer than January on average", () => {
    const mean = (days) => days.reduce((s, d) => s + weatherFor({ day: d, hour: 14, seed: 4 }).cloud, 0) / days.length;
    const jan = mean(Array.from({ length: 31 }, (_, i) => i + 1));
    const oct = mean(Array.from({ length: 31 }, (_, i) => i + 274));
    expect(oct).toBeLessThan(jan);
  });

  it("never rains on a dry day", () => {
    for (let d = 1; d <= 60; d += 1) {
      const w = weatherFor({ day: d, hour: 12, seed: 5 });
      if (w.kind !== "rain" && w.kind !== "storm") expect(w.rain).toBe(0);
    }
  });
});

describe("weatherOverride", () => {
  it("maps each name to a fixed weather", () => {
    const w = { kind: "rain", cloud: 0.9, rain: 0.7 };
    expect(weatherOverride(w, "clear").rain).toBe(0);
    expect(weatherOverride(w, "storm").kind).toBe("storm");
    expect(weatherOverride(w, "bogus")).toBe(w);
  });
});

describe("skyState", () => {
  const sunNoon = sunState({ day: 172, hour: 13.6, place: ATLANTA });
  const sunNight = sunState({ day: 172, hour: 2, place: ATLANTA });

  it("lights a clear noon strongly and a clear night not at all", () => {
    const day = skyState({ sun: sunNoon, weather: { kind: "clear", cloud: 0.05, rain: 0 } });
    const night = skyState({ sun: sunNight, weather: { kind: "clear", cloud: 0.05, rain: 0 } });
    expect(day.sunIntensity).toBeGreaterThan(2);
    expect(night.sunIntensity).toBe(0);
    expect(night.windowLit).toBeGreaterThan(0.95);
    expect(day.windowLit).toBeLessThan(0.4);
  });

  it("dims the sun and closes the fog under rain", () => {
    const clear = skyState({ sun: sunNoon, weather: { kind: "clear", cloud: 0.05, rain: 0 } });
    const rain = skyState({ sun: sunNoon, weather: { kind: "rain", cloud: 0.9, rain: 0.7 } });
    expect(rain.sunIntensity).toBeLessThan(clear.sunIntensity * 0.4);
    expect(rain.fog).toBeLessThan(clear.fog);
    expect(rain.wet).toBeGreaterThan(0.5);
    expect(rain.rainRate).toBeGreaterThan(0.5);
  });

  it("keeps the day sky blue and the night sky dark", () => {
    const day = skyState({ sun: sunNoon, weather: { kind: "clear", cloud: 0.05, rain: 0 } });
    const night = skyState({ sun: sunNight, weather: { kind: "clear", cloud: 0.05, rain: 0 } });
    expect(day.zenith[2]).toBeGreaterThan(day.zenith[0] + day.zenith[1]);
    expect(night.zenith[2]).toBeLessThan(0.1);
  });
});

describe("wetAt", () => {
  it("keeps the ground wet after a storm hour", () => {
    // Find a storm hour this year, then check the hour after it.
    for (let d = 150; d < 300; d += 1) {
      for (let h = 12; h < 20; h += 1) {
        if (weatherFor({ day: d, hour: h, seed: 6 }).rain > 0.7) {
          const wet = wetAt({ day: d, hour: h + 2, seed: 6 });
          expect(wet).toBeGreaterThan(0.3);
          return;
        }
      }
    }
    throw new Error("no storm hour found in the test window");
  });
});
