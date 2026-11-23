// Which places fast travel may go to (#271). Pure.
//
// The full map (src/ui/fullmap.js) asks `canTravelTo(mode, spot)` when the
// player picks a place or an icon. The owner decides the mode for the City
// pitch demo (docs/proposals/271-fast-travel.md). This file does not change
// the default.
//
// Modes:
// - "off": no fast travel. The map has no travel hint and no button.
// - "any": any place, park, or spot, also an Unknown spot. This is the dev
//   server default and `?travel=1`.
// - "found": only a landmark spot that is Found or Claimed. A place, a park,
//   an Unknown spot, or an edge marker (past the map edge) is not a target. This is `?travel=found` (opt-in).

export const TRAVEL_MODES = ["off", "any", "found"];

// The mode from the `travel` URL parameter. `dev` is true in the dev server.
// With no parameter: "any" in the dev server, "off" in a production build
// (the rule of 2026-11-04 in docs/decisions.md). An unknown value is "off".
export function travelMode(param, { dev = false } = {}) {
  if (param === null || param === undefined) return dev ? "any" : "off";
  if (param === "1") return "any";
  if (param === "found") return "found";
  return "off";
}

// True when fast travel may go to the pick. `spot` is the landmark spot of
// the picked icon ({ state: "unknown" | "found" | "claimed" }), or null for
// a place or a park.
export function canTravelTo(mode, spot) {
  if (mode === "any") return true;
  if (mode === "found") return Boolean(spot) && spot.kind !== "edge" && (spot.state === "found" || spot.state === "claimed");
  return false;
}

// The travel part of the map hint for the mode ("" when travel is off).
export function travelHint(mode) {
  if (mode === "any") return " · click, then T: travel";
  if (mode === "found") return " · click a found spot, then T: travel";
  return "";
}
