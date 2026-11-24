import { describe, expect, it } from "vitest";
import { FIRST_LOAD, weatherAt, weatherClock } from "./weather-view.js";
import { atlantaTime } from "../sim/weather.js";

const q = (s) => new URLSearchParams(s);
// 2026-11-23 19:50 UTC is 14:50 in Atlanta (EST, UTC-5): the #353 case.
const ISSUE_353 = new Date(Date.UTC(2026, 10, 23, 19, 50));
// 2026-11-24 03:30 UTC is 22:30 on 2026-11-23 in Atlanta.
const LATE_UTC = new Date(Date.UTC(2026, 10, 24, 3, 30));

describe("atlantaTime (#353)", () => {
  it("gives the Atlanta date and hour, not the device time zone", () => {
    const t = atlantaTime(ISSUE_353);
    expect(t).toMatchObject({ year: 2026, month: 11, date: 23, day: 327 });
    expect(t.hour).toBeCloseTo(14 + 50 / 60, 5);
    const late = atlantaTime(LATE_UTC);
    expect(late.date).toBe(23);
    expect(late.hour).toBeCloseTo(22.5, 5);
  });
  it("follows daylight saving", () => {
    // 2026-07-01 18:00 UTC is 14:00 EDT (UTC-4).
    expect(atlantaTime(new Date(Date.UTC(2026, 6, 1, 18))).hour).toBeCloseTo(14, 5);
  });
});

describe("weatherClock first load (#353)", () => {
  it("with no parameters is a clear afternoon on the Atlanta date", () => {
    for (const now of [ISSUE_353, LATE_UTC, new Date(Date.UTC(2026, 0, 15, 4))]) {
      const c = weatherClock(q(""), now);
      expect(c.hour).toBe(FIRST_LOAD.hour);
      expect(c.override).toBe("clear");
      expect(c.day).toBe(atlantaTime(now).day);
    }
  });
  it("puts the sun up with no rain and a dry street on every day of the year", () => {
    for (let day = 1; day <= 365; day += 7) {
      const s = weatherAt({ ...weatherClock(q(""), ISSUE_353), day, seed: day });
      expect(s.kind).toBe("clear");
      expect(s.sun.elevation).toBeGreaterThan(20);
      expect(s.rainRate).toBe(0);
      expect(s.wet).toBe(0);
    }
  });
  it("keeps the real clock and the seasonal draw as options", () => {
    const c = weatherClock(q("time=now&weather=auto"), ISSUE_353);
    expect(c.hour).toBeCloseTo(14 + 50 / 60, 5);
    expect(c.override).toBe("auto");
    expect(weatherClock(q("time=now"), LATE_UTC).hour).toBeCloseTo(22.5, 5);
  });
  it("still takes a fixed time, date and weather", () => {
    const c = weatherClock(q("date=01-15&time=22&weather=rain&timescale=60"), ISSUE_353);
    expect(c).toMatchObject({ day: 15, hour: 22, override: "rain", timescale: 60 });
  });
  it("ignores a bad time and keeps the afternoon", () => {
    expect(weatherClock(q("time=noon"), ISSUE_353).hour).toBe(FIRST_LOAD.hour);
    expect(weatherClock(q("time="), ISSUE_353).hour).toBe(FIRST_LOAD.hour);
  });
});
