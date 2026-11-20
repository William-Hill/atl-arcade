// The player settings (#94): the render tier, the look, the walker count,
// and the shadow, ink and bloom toggles. Pure: the menu is in
// src/ui/settings-menu.js.
//
// Order of the sources: a URL flag (?quality, ?look, ?peds) wins, then the
// saved choice in localStorage, then the device default (qualityFor in
// src/render/quality.js). Storage can be missing or throw (a private
// window, blocked site data); then the game uses the defaults and the menu
// still works for the page.
//
// The tier, the look, the walkers and the shadows build the scene, so a
// change applies with a reload. The ink and the bloom are post passes, so
// they switch at once.

import { QUALITY } from "../render/quality.js";
import { lookFor } from "../render/look.js";
import { PED_COUNT, pedCount } from "../sim/peds.js";

export const SETTINGS_KEY = "atl.settings.v1";
export const TIERS = ["low", "phone", "high"];
export const LOOK_NAMES = ["toon", "pbr"];
// The walker counts in the menu. "auto" is the tier's count (PED_COUNT).
export const PED_CHOICES = [0, 25, 50, 120, 200];
// `reduceMotion` (#97): "auto" follows prefers-reduced-motion; true or
// false is the player's choice.
export const DEFAULT_SETTINGS = { quality: "auto", look: "auto", peds: "auto", shadows: "auto", ink: true, bloom: true, reduceMotion: "auto" };
// The settings that need a reload, and the URL flag of each.
export const RELOAD_KEYS = ["quality", "look", "peds", "shadows"];
export const URL_FLAGS = { quality: "quality", look: "look", peds: "peds" };

// Pure: a clean settings object from any value (a parsed JSON, a partial
// object, garbage). Unknown values fall back to the default.
export function normalizeSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const peds = Number(r.peds);
  return {
    quality: TIERS.includes(r.quality) ? r.quality : "auto",
    look: LOOK_NAMES.includes(r.look) ? r.look : "auto",
    peds: r.peds !== "auto" && r.peds !== null && r.peds !== "" && Number.isFinite(peds) ? Math.max(0, Math.min(400, Math.round(peds))) : "auto",
    shadows: typeof r.shadows === "boolean" ? r.shadows : "auto",
    ink: typeof r.ink === "boolean" ? r.ink : true,
    bloom: typeof r.bloom === "boolean" ? r.bloom : true,
    reduceMotion: typeof r.reduceMotion === "boolean" ? r.reduceMotion : "auto",
  };
}

// Pure: the reduced-motion state that runs (#97). `setting` is the saved
// choice ("auto", true or false); `device` is the prefers-reduced-motion
// media query. The choice wins; "auto" follows the device.
export function effectiveReducedMotion(setting, device) {
  return typeof setting === "boolean" ? setting : Boolean(device);
}

// Pure: the value to save when the player sets the box to `checked`. The
// value that agrees with the device is "auto", so a later change of the
// device setting applies again.
export function reduceMotionChoice(checked, device) {
  return Boolean(checked) === Boolean(device) ? "auto" : Boolean(checked);
}

// The saved settings, or the defaults when storage is missing, throws, or
// holds garbage.
export function readSettings(storage) {
  try {
    const text = storage?.getItem(SETTINGS_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return normalizeSettings(null);
  }
}

// Saves the settings. Returns false when storage is missing or throws.
export function writeSettings(storage, settings) {
  try {
    if (!storage) return false;
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

// window.localStorage, or null: the getter itself throws when site data is
// blocked.
export function safeStorage(win = globalThis.window) {
  try {
    return win?.localStorage ?? null;
  } catch {
    return null;
  }
}

// Pure: the value the game reads for one key, as the old URL string:
// the URL flag, else the saved choice, else null (the device default).
export function paramFor(key, urlParams, saved) {
  const flag = URL_FLAGS[key];
  const url = flag ? urlParams.get(flag) : null;
  if (url != null && url !== "") return url;
  const v = saved[key];
  return v === "auto" || v == null ? null : String(v);
}

// Pure: where each value comes from: "url", "saved", or "auto".
export function sourcesOf(urlParams, saved) {
  const out = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const flag = URL_FLAGS[key];
    const url = flag ? urlParams.get(flag) : null;
    if (url != null && url !== "") out[key] = "url";
    else out[key] = saved[key] === DEFAULT_SETTINGS[key] ? "auto" : "saved";
  }
  return out;
}

// Pure: the menu's starting choice: the saved settings with each URL flag
// shown in place of its saved value, because the URL flag is what runs.
export function choiceFrom(urlParams, saved) {
  const merged = { ...saved };
  for (const key of Object.keys(URL_FLAGS)) {
    const v = urlParams.get(URL_FLAGS[key]);
    if (v != null && v !== "") merged[key] = v;
  }
  return normalizeSettings(merged);
}

// Pure: what a choice runs as, with `autoQuality` the device default tier.
// { quality, look, peds (a count), shadows, ink, bloom }.
export function effectiveSettings(choice, autoQuality) {
  const c = normalizeSettings(choice);
  const quality = c.quality === "auto" ? autoQuality : c.quality;
  return {
    quality,
    look: lookFor(c.look === "auto" ? null : c.look, quality),
    peds: pedCount(quality, c.peds === "auto" ? null : String(c.peds)),
    shadows: c.shadows === "auto" ? QUALITY[quality].shadows : c.shadows,
    ink: c.ink,
    bloom: c.bloom,
  };
}

// Pure: the keys of RELOAD_KEYS that differ between what runs now and a
// new choice. Both are effectiveSettings() results.
export function reloadKeys(running, next) {
  return RELOAD_KEYS.filter((k) => running[k] !== next[k]);
}

// Pure: the page address for a reload that applies `keys`: their URL flags
// go, so the saved choice wins after the reload. The other flags stay.
// `carry` is the menu choice when storage did not keep it: then each key
// with a URL flag carries its choice in that flag ("auto" removes it).
export function reloadHref(href, keys, carry = null) {
  const url = new URL(href);
  for (const k of keys) {
    const flag = URL_FLAGS[k];
    if (!flag) continue;
    const v = carry ? carry[k] : "auto";
    if (v == null || v === "auto") url.searchParams.delete(flag);
    else url.searchParams.set(flag, String(v));
  }
  return url.toString();
}

// Pure: the keys a reload can apply. Without storage, only a key with a URL
// flag can go to the next page.
export function applicableKeys(keys, saved) {
  return saved ? [...keys] : keys.filter((k) => URL_FLAGS[k]);
}

// Pure: which live toggles the running post chain has. `post` is "full",
// "lite", or null (the low tier, or after a governor step). The pbr look has
// no ink pass, and only the full chain has bloom.
export function liveToggles(post, look) {
  return {
    ink: post === "lite" || (post === "full" && look !== "pbr"),
    bloom: post === "full",
  };
}

// Pure: the default walker count of a tier, for the menu label.
export function tierPeds(quality) {
  return PED_COUNT[quality] ?? PED_COUNT.low;
}
