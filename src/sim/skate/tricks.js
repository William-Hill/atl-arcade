// The trick map and the trick points (docs/gdd/trick-input.md R4, R6, R7,
// R8, R12, F3, F4). Pure data and functions.
//
// A direction is "n", "l", "r", "u", or "d" (direction.js).

import { COMBO, STYLE, TRICK } from "./constants.js";

// R4: grabs. `air_rocket` and `air_tuckknee` are new clips (#329); the
// renderer plays the nearest present clip until they exist.
export const GRABS = {
  n: { id: "mute", name: "Mute Grab", clip: "air_mute" },
  l: { id: "japan", name: "Japan Grab", clip: "air_japan" },
  r: { id: "side", name: "Side Grab", clip: "air_liukang" }, // placeholder name (owner choice 2026-11-22, Q3)
  u: { id: "rocket", name: "Rocket Grab", clip: "air_rocket" },
  d: { id: "tuckknee", name: "Tuck Knee", clip: "air_tuckknee" },
};

// R6: grind stances. The neutral stance has no stance word ("Ledge Grind").
export const STANCES = {
  n: { id: "edge", word: null, clip: "grind_frontside" },
  l: { id: "soul", word: "Soul", clip: "grind_soul" },
  r: { id: "unity", word: "Unity", clip: "grind_unity" },
  u: { id: "makio", word: "Makio", clip: "grind_makio" },
  d: { id: "royale", word: "Royale", clip: "grind_royale" },
};

// R8: the manual. A fresh up at the GRIND press gives the Toe Roll.
export const MANUALS = {
  manual: { id: "manual", name: "Manual", clip: "manual" },
  toe: { id: "toe", name: "Toe Roll", clip: "manual_toe" },
};

// R7: the dances come from STYLE.moves (each with its own beats and points).
const ALL_DANCES = STYLE.moves.flatMap((m) => m.dances);
const byName = (name) => {
  const d = ALL_DANCES.find((x) => x.name === name);
  if (!d) throw new Error(`tricks: no dance "${name}" in STYLE.moves`);
  return d;
};
// ATL Rydin (R7): 8 beats (the 2-bar spec), 600 points (75 per beat). Its
// clip `dance_atlrydin` is new (#329); Sit Spin plays in its slot until then.
export const ATL_RYDIN = { clip: "dance_sitspin", name: "ATL Rydin", beats: 8, points: 600, futureClip: "dance_atlrydin" };

// The dance slots: button (`style1` TRICK, `style2` SPIN), skater, direction.
export const DANCE_SLOTS = {
  style1: {
    nia: { n: byName("Bankhead Bounce"), l: byName("Walk It Out"), r: byName("The Prep"), u: byName("Swag Surf"), d: byName("Snap Lean") },
    marcus: { n: byName("Swag Surf"), l: byName("Walk It Out"), r: byName("The Prep"), u: byName("Drumline Count"), d: byName("Jam Step") },
  },
  style2: { n: byName("Cross Step"), l: byName("Toe Spin"), r: byName("Smooth Quad"), u: ATL_RYDIN, d: byName("Sit Spin") },
};

// The dance of a slot. An unknown skater gets Nia's TRICK slots.
export function danceFor(button, skater, dir = "n") {
  const d = dirOk(dir);
  if (button === "style2") return DANCE_SLOTS.style2[d];
  return (DANCE_SLOTS.style1[skater] ?? DANCE_SLOTS.style1.nia)[d];
}

function dirOk(dir) {
  return dir in GRABS ? dir : "n";
}

export const grabFor = (dir = "n") => GRABS[dirOk(dir)];
export const stanceFor = (dir = "n") => STANCES[dirOk(dir)];

// R12.1: the one-button air set (Mute, Japan, Side, Rocket, Tuck Knee). The
// next press takes the next item; the list starts again after the last.
export const ONE_BUTTON_AIR = ["n", "l", "r", "u", "d"];

// R6: [Long] [edge] [stance] Grind. `id` is the grindable id ("ledge:..." is a ledge).
export function grindName(id, meters, stance = "n", k = COMBO) {
  const parts = [];
  if (meters >= k.longGrindMeters) parts.push("Long");
  parts.push(String(id).startsWith("ledge") ? "Ledge" : "Rail");
  const word = stanceFor(stance).word;
  if (word) parts.push(word);
  parts.push("Grind");
  return parts.join(" ");
}

// F4: the stance bonus. The neutral stance adds 0.
export const stanceBonus = (stance = "n", k = TRICK) => (stance && stance !== "n" ? k.stanceBonus : 0);

// F3 airBase by the air source. A roll off an edge (a drop) has 0.
export function airBase(airFrom, k = COMBO) {
  if (airFrom === "ramp") return k.vertAirPoints;
  if (airFrom === "launch") return k.rampAirPoints;
  if (airFrom === "jump" || airFrom === "grind") return k.hopPoints;
  return 0;
}

// The link name of an air with no grab ("Vert Air", "Ramp Air", "Hop"), or
// null: a drop with no grab adds no link.
export function airName(airFrom) {
  if (airFrom === "ramp") return "Vert Air";
  if (airFrom === "launch") return "Ramp Air";
  if (airFrom === "jump" || airFrom === "grind") return "Hop";
  return null;
}

// F3 n: the full half turns of |airYaw| (rad), up to spinCapHalfTurns.
export function halfTurns(airYaw, k = TRICK) {
  return Math.min(Math.floor(Math.abs(airYaw) / Math.PI + 1e-9), k.spinCapHalfTurns);
}

// F3: airBase + trickBase + holdRate * min(tHold, holdCap) + spinPer180 * n.
// `grab` is null (no grab, or a void grab), "neutral", or "dir".
export function airPoints({ base = 0, grab = null, tHold = 0, airYaw = 0 }, k = TRICK) {
  const trickBase = grab === "neutral" ? k.trickBaseNeutral : grab === "dir" ? k.trickBaseDir : 0;
  const hold = grab ? k.holdRate * Math.min(Math.max(0, tHold), k.holdCap) : 0;
  return Math.round(base + trickBase + hold + k.spinPer180 * halfTurns(airYaw, k));
}
