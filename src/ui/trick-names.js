// The HUD short form of a trick name (docs/gdd/trick-input.md R6, #335;
// docs/ux/trick-hud.md 5.1). Pure.
//
// A grind with a direction stance drops the final word "Grind", so every
// grind name fits HUD_NAME_MAX: "Long Ledge Makio Grind" (22 characters)
// becomes "Long Ledge Makio" (16). The neutral stance keeps "Grind"
// ("Long Ledge Grind"), and every other name stays as it is.

import { STANCES } from "../sim/skate/tricks.js";

// The most characters of one link name on the HUD trick line.
export const HUD_NAME_MAX = 18;

const STANCE_WORDS = new Set(Object.values(STANCES).map((s) => s.word).filter(Boolean));

export function hudShortName(name) {
  const text = String(name ?? "");
  const words = text.split(" ");
  if (words.length >= 3 && words.at(-1) === "Grind" && STANCE_WORDS.has(words.at(-2))) return words.slice(0, -1).join(" ");
  return text;
}

// The combo links with their HUD names, for comboLine().
export function hudLinks(links) {
  return links.map((l) => ({ ...l, name: hudShortName(l.name) }));
}
