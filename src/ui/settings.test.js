import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  choiceFrom,
  effectiveSettings,
  liveToggles,
  normalizeSettings,
  paramFor,
  readSettings,
  reloadHref,
  reloadKeys,
  safeStorage,
  sourcesOf,
  writeSettings,
} from "./settings.js";
import { PED_COUNT } from "../sim/peds.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    map,
  };
}
const throwing = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};
const q = (s) => new URLSearchParams(s);

describe("normalizeSettings", () => {
  it("gives the defaults for garbage", () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings("high")).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ quality: "ultra", look: "neon", peds: "lots", shadows: "yes", ink: 1, bloom: null })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps good values and clamps the walker count", () => {
    expect(normalizeSettings({ quality: "phone", look: "pbr", peds: 50, shadows: false, ink: false, bloom: false })).toEqual({ quality: "phone", look: "pbr", peds: 50, shadows: false, ink: false, bloom: false });
    expect(normalizeSettings({ peds: "999" }).peds).toBe(400);
    expect(normalizeSettings({ peds: -3 }).peds).toBe(0);
    expect(normalizeSettings({ peds: "0" }).peds).toBe(0);
    expect(normalizeSettings({ peds: "" }).peds).toBe("auto");
  });
});

describe("storage", () => {
  it("saves and reads back a choice", () => {
    const s = memoryStorage();
    expect(writeSettings(s, { quality: "low", ink: false })).toBe(true);
    expect(JSON.parse(s.map.get(SETTINGS_KEY)).quality).toBe("low");
    expect(readSettings(s)).toMatchObject({ quality: "low", ink: false, bloom: true });
  });

  it("works with no storage, a throwing storage, and bad JSON", () => {
    expect(readSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(writeSettings(null, DEFAULT_SETTINGS)).toBe(false);
    expect(writeSettings(throwing, DEFAULT_SETTINGS)).toBe(false);
    const s = memoryStorage();
    s.setItem(SETTINGS_KEY, "{not json");
    expect(readSettings(s)).toEqual(DEFAULT_SETTINGS);
  });

  it("returns null when the localStorage getter throws", () => {
    const win = {
      get localStorage() {
        throw new Error("SecurityError");
      },
    };
    expect(safeStorage(win)).toBe(null);
    expect(safeStorage(undefined)).toBe(null);
  });
});

describe("sources", () => {
  const saved = normalizeSettings({ quality: "low", look: "toon", peds: 25 });

  it("lets a URL flag win over the saved value", () => {
    expect(paramFor("quality", q("quality=high"), saved)).toBe("high");
    expect(paramFor("quality", q(""), saved)).toBe("low");
    expect(paramFor("peds", q("peds=0"), saved)).toBe("0");
    expect(paramFor("peds", q(""), saved)).toBe("25");
    // Nothing saved: null, so the game picks the device default.
    expect(paramFor("quality", q(""), DEFAULT_SETTINGS)).toBe(null);
    expect(paramFor("look", q("look="), DEFAULT_SETTINGS)).toBe(null);
  });

  it("names the source of each value", () => {
    expect(sourcesOf(q("look=pbr"), saved)).toMatchObject({ quality: "saved", look: "url", peds: "saved", shadows: "auto", ink: "auto" });
  });

  it("shows the URL flag in the menu's starting choice", () => {
    expect(choiceFrom(q("quality=phone"), saved)).toMatchObject({ quality: "phone", look: "toon", peds: 25 });
    expect(choiceFrom(q("quality=ultra"), saved).quality).toBe("auto");
  });
});

describe("effectiveSettings", () => {
  it("resolves auto from the device tier", () => {
    expect(effectiveSettings(DEFAULT_SETTINGS, "high")).toEqual({ quality: "high", look: "pbr", peds: PED_COUNT.high, shadows: true, ink: true, bloom: true });
    expect(effectiveSettings(DEFAULT_SETTINGS, "phone")).toEqual({ quality: "phone", look: "toon", peds: PED_COUNT.phone, shadows: false, ink: true, bloom: true });
  });

  it("uses the choice over the device tier", () => {
    expect(effectiveSettings({ quality: "low", look: "pbr", peds: 0, shadows: true }, "high")).toMatchObject({ quality: "low", look: "pbr", peds: 0, shadows: true });
  });
});

describe("reloads", () => {
  it("needs a reload only for a tier, look, walker or shadow change", () => {
    const running = effectiveSettings(DEFAULT_SETTINGS, "high");
    expect(reloadKeys(running, effectiveSettings({ quality: "high" }, "high"))).toEqual([]);
    expect(reloadKeys(running, effectiveSettings({ ink: false, bloom: false }, "high"))).toEqual([]);
    expect(reloadKeys(running, effectiveSettings({ quality: "low" }, "high"))).toEqual(["quality", "look", "peds", "shadows"]);
    expect(reloadKeys(running, effectiveSettings({ peds: 25 }, "high"))).toEqual(["peds"]);
  });

  it("drops the URL flags of the changed keys and keeps the rest", () => {
    const href = reloadHref("https://x.test/?level=beltline&quality=high&look=pbr&peds=10", ["quality", "shadows"]);
    const u = new URL(href);
    expect(u.searchParams.get("quality")).toBe(null);
    expect(u.searchParams.get("look")).toBe("pbr");
    expect(u.searchParams.get("level")).toBe("beltline");
  });
});

describe("liveToggles", () => {
  it("knows which post passes the chain has", () => {
    expect(liveToggles("full", "toon")).toEqual({ ink: true, bloom: true });
    expect(liveToggles("full", "pbr")).toEqual({ ink: false, bloom: true });
    expect(liveToggles("lite", "toon")).toEqual({ ink: true, bloom: false });
    expect(liveToggles(null, "toon")).toEqual({ ink: false, bloom: false });
  });
});
