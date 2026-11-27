// The text of the trick HUD (#330, docs/ux/trick-hud.md sections 5 and 6).
// Pure: no DOM. src/ui/hud.js puts the result on the screen.
//
// E1, the trick line: "[+N ]link + link + link xM". Each link is
// "[arrow] short name [tag glyph]".
// E2, the live trick chip: the trick in progress, the result of a link, the
// Busy cue, and the refusal reason.
// E3: the hold bar of a grab and the beat pips of a dance.

import { hudShortName } from "./trick-names.js";

// The arrow of each direction. The neutral slot is a dot.
export const ARROWS = Object.freeze({ n: "•", l: "←", r: "→", u: "↑", d: "↓" });
// The tag glyphs (no color-only signal, R12.4).
export const GLYPHS = Object.freeze({ PERFECT: "★", GOOD: "✓", stumble: "~", busy: "…", cut: "▶" });

export const arrowOf = (dir) => (dir && ARROWS[dir] ? ARROWS[dir] : "");

// The glyph of a link: PERFECT, GOOD, or a stumble. No glyph for a clean
// link off the beat.
export function tagGlyph(link) {
  if (!link) return "";
  if (link.landing === "stumble") return GLYPHS.stumble;
  const tag = link.tag ?? link.beatTag ?? null;
  return tag && GLYPHS[tag] ? GLYPHS[tag] : "";
}

// The text of one link on E1. `oneButton`: no arrow (the direction did not
// choose the trick).
export function linkText(link, { oneButton = false } = {}) {
  const parts = [];
  const arrow = oneButton ? "" : arrowOf(link.dir);
  if (arrow) parts.push(arrow);
  parts.push(hudShortName(link.name));
  const glyph = tagGlyph(link);
  if (glyph) parts.push(glyph);
  return parts.join(" ");
}

// The budgets of the fit rule (5.3).
export const TRICK_LINE = Object.freeze({
  desktop: { maxLinks: 3, maxChars: 64 },
  compact: { maxLinks: 3, maxChars: 30 },
});

// E1. Returns { fold, body, mult, text, shown }: `fold` is "+N " or "",
// `mult` is " xM" (bold on the screen). The 3 newest links show if the full
// text fits `maxChars`; else 2, else 1. One link always shows in full.
export function trickLine(links, { maxLinks = 3, maxChars = 64, oneButton = false, multiplier = 1 } = {}) {
  const list = links ?? [];
  if (!list.length) return { fold: "", body: "", mult: "", text: "", shown: 0 };
  const names = list.map((l) => linkText(l, { oneButton }));
  const mult = ` x${multiplier}`;
  const build = (n) => {
    const hidden = names.length - n;
    const fold = hidden > 0 ? `+${hidden} ` : "";
    const body = names.slice(-n).join(" + ");
    return { fold, body, mult, text: `${fold}${body}${mult}`, shown: n };
  };
  let n = Math.max(1, Math.min(maxLinks, names.length));
  while (n > 1 && build(n).text.length > maxChars) n -= 1;
  return build(n);
}

// --- E2: the live trick chip -------------------------------------------------

export const CHIP_MS = Object.freeze({ result: 900, busy: 600, refused: 1400 });

// The look of each chip state. shell.css draws each one with a different
// border (solid, none, 2 px, 3 px bold, dotted), so no state is color only.
export const CHIP_LOOKS = Object.freeze(["progress", "clean", "good", "perfect", "wobble", "busy", "refused"]);

// The words the chip never shows (6.1). The full list comes with #342
// (src/content/banned-words.js); these are the words that the spec names.
export const CHIP_BANNED = Object.freeze(["FAIL", "CRASH", "MISS", "BAD"]);

// The name with its arrow. `compact` uses the HUD short form.
function named(name, dir, { compact = false, oneButton = false } = {}) {
  const arrow = oneButton ? "" : arrowOf(dir);
  const text = compact ? hudShortName(name) : String(name ?? "");
  return arrow ? `${arrow} ${text}` : text;
}

// The chip of a trick in progress. `trick` is state.trick; `manual` is
// state.manual (for the meters); `capMeters` is TRICK.manualCapMeters.
export function progressChip(trick, { manual = null, capMeters = 30, compact = false, oneButton = false } = {}) {
  if (!trick) return null;
  if (trick.kind === "manual") {
    const meters = manual ? Math.floor(manual.meters + 1e-9) : 0;
    const capped = Boolean(manual && (manual.capped || manual.meters >= capMeters));
    const dir = manual?.toe ? "u" : "n";
    return { look: "progress", text: `${named(trick.name, dir, { oneButton })} ${capped ? "MAX" : `${meters} m`}` };
  }
  return { look: "progress", text: named(trick.name, trick.dir, { compact, oneButton }) };
}

// The chip of a link result (a scored move of the run: { name, dir, beatTag, landing }).
export function resultChip(move, { compact = false, oneButton = false } = {}) {
  if (!move) return null;
  const name = named(move.name, move.dir, { compact, oneButton });
  if (move.landing === "stumble") return { look: "wobble", text: `${GLYPHS.stumble} WOBBLE ${name}` };
  if (move.beatTag === "PERFECT") return { look: "perfect", text: `${GLYPHS.PERFECT} PERFECT ${name}` };
  if (move.beatTag === "GOOD") return { look: "good", text: `${GLYPHS.GOOD} GOOD ${name}` };
  return { look: "clean", text: name };
}

export const busyChip = (danceName) => ({ look: "busy", text: `${GLYPHS.busy} BUSY: ${danceName}` });
export const refusedChip = (text) => (text ? { look: "refused", text } : null);

// The chip state machine (6.1 rules). Pure: each call returns a new state.
// state: { result, resultAt, resultUntil, trickKey, trickSince, busyUntil, refused, refusedUntil }
export function createChip() {
  return { result: null, resultAt: -Infinity, resultUntil: -Infinity, trickKey: null, trickSince: -Infinity, busyUntil: -Infinity, refused: null, refusedUntil: -Infinity };
}

const keyOf = (trick) => (trick ? `${trick.kind}:${trick.id}` : null);

// One HUD frame. `ev`: { nowMs, trick, manual, move (a new link result or
// null), ignored (a new ignored press or null), refused (a new reason text
// or null), compact, oneButton, capMeters }. Returns { state, chip } where
// chip is { look, text } or null (hidden).
export function stepChip(prev, ev) {
  const now = ev.nowMs;
  const s = { ...prev };
  const opts = { compact: Boolean(ev.compact), oneButton: Boolean(ev.oneButton) };
  const key = keyOf(ev.trick);
  // A new trick start (a new kind or id).
  if (key !== s.trickKey) {
    s.trickKey = key;
    if (key) s.trickSince = now;
  }
  if (ev.move) {
    s.result = resultChip(ev.move, opts);
    s.resultAt = now;
    s.resultUntil = now + CHIP_MS.result;
    // A link result takes the place of Busy at once.
    s.busyUntil = -Infinity;
  }
  const dance = ev.trick && ev.trick.kind === "dance";
  if (ev.ignored && dance && !ev.oneButton) s.busyUntil = now + CHIP_MS.busy;
  if (!dance) s.busyUntil = -Infinity;
  const resultShows = s.result && now < s.resultUntil;
  // A link result wins over a trick that started before it (or on the same
  // frame); a trick that started after it wins over it.
  const resultWins = resultShows && s.resultAt >= s.trickSince;
  const shows = resultWins || ev.trick;
  // A refusal shows only when the chip is hidden or shows another refusal.
  if (ev.refused && !shows) {
    s.refused = refusedChip(ev.refused);
    s.refusedUntil = now + CHIP_MS.refused;
  }
  let chip = null;
  if (resultWins) chip = s.result;
  else if (ev.trick) chip = dance && now < s.busyUntil ? busyChip(ev.trick.name) : progressChip(ev.trick, { manual: ev.manual, capMeters: ev.capMeters, ...opts });
  else if (resultShows) chip = s.result;
  else if (s.refused && now < s.refusedUntil) chip = s.refused;
  return { state: s, chip };
}

// --- E3: the hold bar and the beat pips --------------------------------------

// The hold bar of a grab: { fill 0..1, capped } while it is held, else null.
export function holdBar(trick, heldFor, holdCap = 1.5) {
  if (!trick || trick.kind !== "grab" || !trick.held) return null;
  const t = Math.max(0, heldFor || 0);
  return { fill: Math.min(1, t / holdCap), capped: t >= holdCap - 1e-9 };
}

// The beat pips of a dance: { total, past }. `time` and `duration` are in s.
export function beatPips(style, beats) {
  if (!style || !(beats > 0) || !(style.duration > 0)) return null;
  const per = style.duration / beats;
  const past = Math.max(0, Math.min(beats, Math.floor((style.time + 1e-9) / per)));
  return { total: beats, past };
}
