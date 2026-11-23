// The trick map of docs/gdd/trick-input.md (R4, R6, R7, R12). Pure data.
// Text labels stand in for the clips in the greybox prototype.

export const GRABS = {
  n: { id: "mute", name: "Mute Grab", clip: "air_mute" },
  l: { id: "japan", name: "Japan Grab", clip: "air_japan" },
  r: { id: "side", name: "Side Grab", clip: "air_liukang" },
  u: { id: "rocket", name: "Rocket Grab", clip: "air_rocket", newClip: true },
  d: { id: "tuckknee", name: "Tuck Knee", clip: "air_tuckknee", newClip: true },
};

export const STANCES = {
  n: { id: "edge", word: null, clip: "grind_frontside" },
  l: { id: "soul", word: "Soul", clip: "grind_soul" },
  r: { id: "unity", word: "Unity", clip: "grind_unity" },
  u: { id: "makio", word: "Makio", clip: "grind_makio", newClip: true },
  d: { id: "royale", word: "Royale", clip: "grind_royale", newClip: true },
};

// Dances: beats and points per dance (R7). A groove pays 75 per beat.
const D = (id, name, beats, points, source = true) => ({ id, name, beats, points, source });
const BANKHEAD = D("bankhead", "Bankhead Bounce", 2, 150);
const WALKITOUT = D("walkitout", "Walk It Out", 2, 150);
const PREP = D("prep", "The Prep", 2, 150);
const SWAGSURF = D("swagsurf", "Swag Surf", 2, 150);
const SNAPLEAN = D("snaplean", "Snap Lean", 2, 150);
const DRUMLINE = D("drumline", "Drumline Count", 2, 150, false);
const JAMSTEP = D("jamstep", "Jam Step", 2, 150, false);
const JAMGROOVE = D("jamgroove", "Jam Groove", 2, 150, false);
const CROSSSTEP = D("crossstep", "Cross Step", 2, 150);
const TOESPIN = D("toespin", "Toe Spin", 1, 160, false);
const SMOOTHQUAD = D("smoothquad", "Smooth Quad", 2, 150, false);
const ATLRYDIN = D("atlrydin", "ATL Rydin", 8, 600);
const SITSPIN = D("sitspin", "Sit Spin", 1, 160, false);

export const DANCES = {
  trick: {
    nia: { n: BANKHEAD, l: WALKITOUT, r: PREP, u: SWAGSURF, d: SNAPLEAN },
    marcus: { n: SWAGSURF, l: WALKITOUT, r: PREP, u: DRUMLINE, d: JAMSTEP },
  },
  spin: { n: CROSSSTEP, l: TOESPIN, r: SMOOTHQUAD, u: ATLRYDIN, d: SITSPIN },
};

export const danceFor = (button, skater, dir) => (button === "spin" ? DANCES.spin[dir] : DANCES.trick[skater][dir]);

// One-button sets (R12.1), in order.
export const ONE_BUTTON = {
  air: ["n", "l", "r", "u", "d"].map((d) => GRABS[d]),
  grind: ["n", "l", "r", "u", "d"],
  ground: {
    nia: [BANKHEAD, WALKITOUT, PREP, SWAGSURF, SNAPLEAN, CROSSSTEP, TOESPIN, SMOOTHQUAD, ATLRYDIN, SITSPIN],
    marcus: [SWAGSURF, WALKITOUT, PREP, DRUMLINE, JAMSTEP, CROSSSTEP, TOESPIN, SMOOTHQUAD, ATLRYDIN, SITSPIN, JAMGROOVE, BANKHEAD, SNAPLEAN],
  },
};

// The grind name (R6): [Long] [edge] [stance] Grind.
export function grindName(edge, dir, meters, longMeters = 10) {
  const parts = [];
  if (meters >= longMeters) parts.push("Long");
  parts.push(edge);
  const word = STANCES[dir].word;
  if (word) parts.push(word);
  parts.push("Grind");
  return parts.join(" ");
}

// The HUD short form drops the final "Grind" of a direction stance.
export function hudShort(name) {
  const isStance = Object.values(STANCES).some((s) => s.word && name.includes(` ${s.word} Grind`));
  return isStance ? name.replace(/ Grind$/, "") : name;
}

export const MANUAL_NAMES = { manual: "Manual", toe: "Toe Roll" };

// Every trick name the prototype can show (for the name check test).
export function allTrickNames() {
  const names = new Set();
  Object.values(GRABS).forEach((g) => names.add(g.name));
  for (const edge of ["Rail", "Ledge"]) for (const d of Object.keys(STANCES)) for (const m of [1, 12]) names.add(grindName(edge, d, m));
  [DANCES.spin, DANCES.trick.nia, DANCES.trick.marcus].forEach((s) => Object.values(s).forEach((x) => names.add(x.name)));
  ONE_BUTTON.ground.marcus.forEach((x) => names.add(x.name));
  names.add("Manual");
  names.add("Toe Roll");
  names.add("Ramp Air");
  names.add("Hop");
  return [...names];
}

export const ARROWS = { n: "•", l: "←", r: "→", u: "↑", d: "↓" };
