// The trick map for the screen (#330, docs/ux/trick-hud.md 8.3 and 9.2):
// the cells of the touch flick card and the sections of the trick list.
// Pure: no DOM.

import { GRABS, MANUALS, STANCES, danceFor } from "../sim/skate/tricks.js";
import { ONE_BUTTON_SETS } from "../input/one-button.js";
import { keyName } from "../input/remap.js";
import { originOf } from "../content/dance-origins.js";
import { ARROWS } from "./trick-hud-text.js";

// The order of the cells in the DOM: the neutral cell first, then up,
// left, right, down. CSS puts them in a 3 x 3 grid.
export const CELL_ORDER = Object.freeze(["n", "u", "l", "r", "d"]);
export const DIR_WORDS = Object.freeze({ n: "Tap", u: "Up", l: "Left", r: "Right", d: "Down" });

// The context of a press, from the skater state.
export function contextOf(s) {
  if (!s) return "ground";
  if (s.state === "air") return "air";
  if (s.state === "grind") return "grind";
  if (s.manual) return "manual";
  return "ground";
}

const stanceName = (d, { full = false } = {}) => {
  const w = STANCES[d].word;
  if (!w) return full ? "Rail Grind or Ledge Grind" : "Grind";
  return full ? `${w} Grind` : w;
};

const cells = (fn) => Object.fromEntries(CELL_ORDER.map((d) => [d, fn(d)]));

// The cells of a button in a context: { cells: { n, u, l, r, d } } or
// { line } (one line and no ring). In one-button mode TRICK shows one line
// with the next item of the set (`next`).
export function flickCard(button, ctx, skater = "nia", { oneButton = false, next = null } = {}) {
  if (oneButton && button === "style1") return { line: next ? `Next: ${next}` : "Next trick: tap TRICK" };
  if (button === "grind") return { cells: cells((d) => stanceName(d)) };
  if (button === "style1") {
    if (ctx === "air") return { cells: cells((d) => GRABS[d].name) };
    if (ctx === "grind") return { line: "Off on a rail" };
    if (ctx === "manual") return { line: "Off in a manual" };
    return { cells: cells((d) => danceFor("style1", skater, d).name) };
  }
  if (button === "style2") {
    if (ctx === "ground") return { cells: cells((d) => danceFor("style2", skater, d).name) };
    return { line: "SPIN: on the ground" };
  }
  return { line: "" };
}

// The text of one card cell: "↑ Rocket Grab", or "• Mute Grab tap" in the middle.
export const cellText = (d, name) => (d === "n" ? `${ARROWS.n} ${name} tap` : `${ARROWS[d]} ${name}`);

// The next item of the one-button set for a context (the HUD reads the
// one-button state of src/input/one-button.js; it does not change it).
export function oneButtonNext(ob, ctx, skater = "nia") {
  if (!ob || !ob.next) return null;
  const set = ctx === "air" ? "air" : ctx === "grind" ? "grind" : ctx === "manual" ? null : skater === "marcus" ? "marcus" : "nia";
  if (!set || !ONE_BUTTON_SETS[set]) return null;
  const list = ONE_BUTTON_SETS[set];
  return list[(ob.next[set] ?? 0) % list.length].name;
}

// --- The trick list (E6) ---------------------------------------------------

const firstKey = (bindings, action) => {
  const k = bindings?.keyboard?.[action]?.[0];
  return k ? keyName(k) : "?";
};
const keyPair = (bindings, a, b) => `${firstKey(bindings, a)} and ${firstKey(bindings, b)}`;

// The button name of an action per device.
const PAD = { style1: "Y", style2: "B", grind: "RT" };
const TOUCH = { style1: "TRICK", style2: "SPIN", grind: "GRIND" };
export function buttonName(action, device, bindings) {
  if (device === "gamepad") return PAD[action];
  if (device === "touch") return TOUCH[action];
  return firstKey(bindings, action);
}

// The input line under the header.
export function inputLine(device, bindings) {
  if (device === "gamepad") return "Left stick or d-pad + button";
  if (device === "touch") return `Flick the button. A tap gives the ${ARROWS.n} trick.`;
  const dirs = ["dirUp", "dirLeft", "dirDown", "dirRight"].map((a) => firstKey(bindings, a)).join(" ");
  return `Direction (${dirs} or the arrows) + button`;
}

// The 5 sections of the trick list (9.2), plus the one-button set first in
// one-button mode (9.4). Each cell: { dir, name, label, origin? }.
export function trickListSections(skater = "nia", { device = "keyboard", bindings = null, oneButton = false } = {}) {
  const cell = (d, name, dance = false) => {
    const c = { dir: d, name, label: `${DIR_WORDS[d]}: ${name}` };
    if (dance) c.origin = originOf(name);
    return c;
  };
  const compass = (fn, dance = false) => CELL_ORDER.map((d) => cell(d, fn(d), dance));
  const sections = [
    { id: "air", title: "Air: grabs", button: buttonName("style1", device, bindings), cells: compass((d) => GRABS[d].name) },
    { id: "rail", title: "Rail: grind stances", button: `${buttonName("grind", device, bindings)}, at the snap`, cells: compass((d) => stanceName(d, { full: true })) },
    { id: "trick", title: "Ground: TRICK dances", button: buttonName("style1", device, bindings), cells: compass((d) => danceFor("style1", skater, d).name, true) },
    { id: "spin", title: "Ground: SPIN dances", button: buttonName("style2", device, bindings), cells: compass((d) => danceFor("style2", skater, d).name, true) },
    {
      id: "manual",
      title: "Manual",
      button: `Hold ${buttonName("grind", device, bindings)}, no rail near`,
      cells: [cell("n", MANUALS.manual.name), cell("u", MANUALS.toe.name)],
      note: device === "keyboard" ? `Balance with ${keyPair(bindings, "dirUp", "dirDown")}` : "Balance with the stick up and down",
    },
  ];
  if (oneButton) {
    const set = skater === "marcus" ? "marcus" : "nia";
    sections.unshift({
      id: "one-button",
      title: "One-button set",
      button: buttonName("style1", device, bindings),
      list: [
        { title: "Air", items: ONE_BUTTON_SETS.air.map((i) => i.name) },
        { title: "Rail", items: ONE_BUTTON_SETS.grind.map((i) => i.name) },
        { title: "Ground", items: ONE_BUTTON_SETS[set].map((i) => i.name) },
      ],
    });
    for (const s of sections.slice(1)) s.note = s.note ? `${s.note}. Directions are off in one-button mode` : "Directions are off in one-button mode";
  }
  return sections;
}

// The safe text of an origin (R13): with an open lyric check, the text
// names no song. This build has no song titles in the text, so it returns
// the text as it is; a song title goes in `song` only, and shows only
// after the check passes.
export function originText(origin) {
  const parts = [origin.short];
  if (origin.song && origin.lyricCheck === "passed") parts.push(`Song: ${origin.song}`);
  return parts.join(". ");
}

// The place of the flick card (8.3): above the button area when the
// viewport is taller than wide, else to its left, with an 8 px gap, inside
// the safe rectangle. `buttons` is the rectangle of `.touch-buttons`.
// Returns the top-left { x, y } of the card of size (w, h).
export function cardPlace(buttons, { w, h }, viewW, viewH, { gap = 8, margin = 16 } = {}) {
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  if (viewH > viewW) {
    const x = clamp(buttons.x + buttons.w / 2 - w / 2, margin, viewW - margin - w);
    return { x, y: clamp(buttons.y - gap - h, margin, viewH - margin - h), side: "above" };
  }
  const x = clamp(buttons.x - gap - w, margin, viewW - margin - w);
  return { x, y: clamp(buttons.y + buttons.h - h, margin, viewH - margin - h), side: "left" };
}
