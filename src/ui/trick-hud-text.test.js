import { describe, expect, it } from "vitest";
import { contrast, over } from "./layout.js";
import { ARROWS, CHIP_BANNED, CHIP_MS, TRICK_LINE, beatPips, busyChip, createChip, holdBar, linkText, progressChip, resultChip, stepChip, tagGlyph, trickLine } from "./trick-hud-text.js";
import { REFUSED_TEXT } from "./hud.js";

const L = (name, dir = null, tag = null, landing = "clean") => ({ name, dir, tag, landing });

describe("#330 E1 the trick line", () => {
  it("the GDD anchor: • Ledge Grind + • Manual + ← Japan Grab ★ x3", () => {
    const links = [L("Ledge Grind", "n"), L("Manual", "n"), L("Japan Grab", "l", "PERFECT")];
    expect(trickLine(links, { ...TRICK_LINE.desktop, multiplier: 3 }).text).toBe("• Ledge Grind + • Manual + ← Japan Grab ★ x3");
  });

  it("each link has its arrow, its short name, and its glyph", () => {
    expect(linkText(L("Long Ledge Makio Grind", "d"))).toBe("↓ Long Ledge Makio");
    expect(linkText(L("Toe Roll", "u", "GOOD"))).toBe("↑ Toe Roll ✓");
    expect(linkText(L("Japan Grab", "l", null, "stumble"))).toBe("← Japan Grab ~");
    expect(linkText(L("Ramp Air", null))).toBe("Ramp Air");
    expect(linkText(L("Mute Grab", "n"))).toBe("• Mute Grab");
    expect(tagGlyph({ beatTag: "PERFECT", landing: "clean" })).toBe("★");
    expect(tagGlyph(L("x", null, "PERFECT", "stumble"))).toBe("~");
  });

  it("no name shows Frontside", () => {
    for (const d of Object.keys(ARROWS)) expect(linkText(L("Long Rail Grind", d))).not.toMatch(/Frontside/);
  });

  it("the 3 newest links fit; a 4th link folds into +1; 2 hidden links show +2", () => {
    const four = [L("Hop"), L("Rail Grind", "n"), L("Hop"), L("Mute Grab", "n")];
    const r4 = trickLine(four, { ...TRICK_LINE.desktop, multiplier: 4 });
    expect(r4.fold).toBe("+1 ");
    expect(r4.shown).toBe(3);
    expect(r4.text).toBe("+1 • Rail Grind + Hop + • Mute Grab x4");
    const r5 = trickLine([L("Hop"), ...four], { ...TRICK_LINE.desktop, multiplier: 5 });
    expect(r5.text.startsWith("+2 ")).toBe(true);
  });

  it("drops to 2 links, then 1, to fit the budget; a long link shows in full", () => {
    const links = [L("Long Ledge Makio Grind", "u"), L("Long Rail Royale Grind", "d"), L("Rocket Grab", "u", "PERFECT")];
    const desk = trickLine(links, { ...TRICK_LINE.desktop, multiplier: 3 });
    expect(desk.text.length).toBeLessThanOrEqual(64);
    expect(desk.shown).toBe(3);
    const phone = trickLine(links, { ...TRICK_LINE.compact, multiplier: 3 });
    expect(phone.text.length).toBeLessThanOrEqual(30);
    expect(phone.shown).toBe(1);
    expect(phone.text).toBe("+2 ↑ Rocket Grab ★ x3");
    const one = trickLine([L("Long Ledge Makio Grind", "u")], { maxLinks: 3, maxChars: 5, multiplier: 1 });
    expect(one.text).toBe("↑ Long Ledge Makio x1");
  });

  it("the budgets are 64 characters on a desktop and 30 on a compact screen", () => {
    expect(TRICK_LINE.desktop).toEqual({ maxLinks: 3, maxChars: 64 });
    expect(TRICK_LINE.compact).toEqual({ maxLinks: 3, maxChars: 30 });
  });

  it("in one-button mode no link has an arrow", () => {
    const links = [L("Ledge Grind", "n"), L("Japan Grab", "l", "GOOD")];
    const t = trickLine(links, { oneButton: true, multiplier: 2 }).text;
    for (const a of Object.values(ARROWS)) expect(t).not.toContain(a);
    expect(t).toBe("Ledge Grind + Japan Grab ✓ x2");
  });

  it("no link, no line", () => {
    expect(trickLine([]).text).toBe("");
  });
});

describe("#330 E2 the live trick chip", () => {
  const ev = (over = {}) => ({ nowMs: 0, trick: null, manual: null, move: null, ignored: null, refused: null, ...over });
  const grab = { kind: "grab", id: "japan", name: "Japan Grab", dir: "l", held: true };
  const dance = { kind: "dance", id: "dance_crisscross", name: "Cross Step", dir: "n", held: false };

  it("each state has its text and glyph", () => {
    expect(progressChip(grab)).toEqual({ look: "progress", text: "← Japan Grab" });
    expect(progressChip({ kind: "manual", id: "manual", name: "Manual" }, { manual: { meters: 12.7, toe: false } })).toEqual({ look: "progress", text: "• Manual 12 m" });
    expect(progressChip({ kind: "manual", id: "toe", name: "Toe Roll" }, { manual: { meters: 31, toe: true, capped: true } }).text).toBe("↑ Toe Roll MAX");
    expect(resultChip({ name: "Side Grab", dir: "r", beatTag: null })).toEqual({ look: "clean", text: "→ Side Grab" });
    expect(resultChip({ name: "Side Grab", dir: "r", beatTag: "GOOD" })).toEqual({ look: "good", text: "✓ GOOD → Side Grab" });
    expect(resultChip({ name: "Japan Grab", dir: "l", beatTag: "PERFECT" })).toEqual({ look: "perfect", text: "★ PERFECT ← Japan Grab" });
    expect(resultChip({ name: "Japan Grab", dir: "l", beatTag: null, landing: "stumble" })).toEqual({ look: "wobble", text: "~ WOBBLE ← Japan Grab" });
    expect(busyChip("Cross Step")).toEqual({ look: "busy", text: "… BUSY: Cross Step" });
  });

  it("a compact screen uses the short name in progress", () => {
    expect(progressChip({ kind: "manual", id: "toe", name: "Toe Roll" }, { manual: { meters: 3, toe: true }, compact: true }).text).toBe("\u2191 Toe Roll 3 m");
    expect(progressChip({ kind: "grind", id: "makio", name: "Long Ledge Makio Grind", dir: "u" }, { compact: true }).text).toBe("↑ Long Ledge Makio");
    expect(progressChip({ kind: "grind", id: "makio", name: "Long Ledge Makio Grind", dir: "u" }).text).toBe("↑ Long Ledge Makio Grind");
  });

  it("a link result shows for 900 ms of HUD time, then the chip hides", () => {
    let st = createChip();
    let r = stepChip(st, ev({ nowMs: 1000, move: { name: "Japan Grab", dir: "l", beatTag: "PERFECT", landing: "clean" } }));
    expect(r.chip.look).toBe("perfect");
    r = stepChip(r.state, ev({ nowMs: 1000 + CHIP_MS.result - 1 }));
    expect(r.chip.look).toBe("perfect");
    r = stepChip(r.state, ev({ nowMs: 1000 + CHIP_MS.result }));
    expect(r.chip).toBeNull();
  });

  it("a result takes the place of a trick in progress; a new trick start takes the place of a result", () => {
    let r = stepChip(createChip(), ev({ nowMs: 0, trick: { kind: "manual", id: "manual", name: "Manual" }, manual: { meters: 30, capped: true } }));
    expect(r.chip.text).toBe("• Manual MAX");
    r = stepChip(r.state, ev({ nowMs: 16, trick: { kind: "manual", id: "manual", name: "Manual" }, manual: { meters: 30, capped: true }, move: { name: "Manual", dir: "n", beatTag: "GOOD" } }));
    expect(r.chip.look).toBe("good");
    r = stepChip(r.state, ev({ nowMs: 32, trick: grab }));
    expect(r.chip).toEqual({ look: "progress", text: "← Japan Grab" });
  });

  it("Busy replaces the dance chip for 600 ms after the last ignored press, then the dance shows", () => {
    let r = stepChip(createChip(), ev({ nowMs: 0, trick: dance }));
    expect(r.chip.text).toBe("• Cross Step");
    r = stepChip(r.state, ev({ nowMs: 100, trick: dance, ignored: { name: "Cross Step", seq: 1 } }));
    expect(r.chip).toEqual(busyChip("Cross Step"));
    r = stepChip(r.state, ev({ nowMs: 600, trick: dance, ignored: { name: "Cross Step", seq: 2 } }));
    r = stepChip(r.state, ev({ nowMs: 600 + CHIP_MS.busy - 1, trick: dance }));
    expect(r.chip.look).toBe("busy");
    r = stepChip(r.state, ev({ nowMs: 600 + CHIP_MS.busy, trick: dance }));
    expect(r.chip.text).toBe("• Cross Step");
  });

  it("an ignored press after the result of a repeated dance shows Busy; a new result wins again", () => {
    let r = stepChip(createChip(), ev({ nowMs: 0, trick: dance }));
    // The dance ends and repeats (hold to repeat): same key, a new result.
    r = stepChip(r.state, ev({ nowMs: 1000, trick: dance, move: { name: "Cross Step", dir: "n" } }));
    expect(r.chip.look).toBe("clean");
    r = stepChip(r.state, ev({ nowMs: 1100, trick: dance, ignored: { seq: 1 } }));
    expect(r.chip.look).toBe("busy");
    r = stepChip(r.state, ev({ nowMs: 1200, trick: dance, move: { name: "Cross Step", dir: "n", beatTag: "GOOD" } }));
    expect(r.chip.look).toBe("good");
  });

  it("a link result in the Busy time takes its place at once; no Busy in one-button mode", () => {
    let r = stepChip(createChip(), ev({ nowMs: 0, trick: dance, ignored: { seq: 1 } }));
    expect(r.chip.look).toBe("busy");
    r = stepChip(r.state, ev({ nowMs: 50, trick: null, move: { name: "Cross Step", dir: "n" } }));
    expect(r.chip.look).toBe("clean");
    const ob = stepChip(createChip(), ev({ nowMs: 0, trick: dance, ignored: { seq: 1 }, oneButton: true }));
    expect(ob.chip.look).toBe("progress");
  });

  it("a refusal never takes the place of a trick in progress or a result; it shows on a hidden chip for 1400 ms", () => {
    let r = stepChip(createChip(), ev({ nowMs: 0, trick: grab, refused: REFUSED_TEXT.air }));
    expect(r.chip.look).toBe("progress");
    r = stepChip(createChip(), ev({ nowMs: 0, move: { name: "Hop" } }));
    r = stepChip(r.state, ev({ nowMs: 10, refused: REFUSED_TEXT.slow }));
    expect(r.chip.look).toBe("clean");
    r = stepChip(createChip(), ev({ nowMs: 0, refused: REFUSED_TEXT.slow }));
    expect(r.chip).toEqual({ look: "refused", text: REFUSED_TEXT.slow });
    r = stepChip(r.state, ev({ nowMs: CHIP_MS.refused }));
    expect(r.chip).toBeNull();
  });

  it("no chip string contains a banned word", () => {
    const names = ["Japan Grab", "Cross Step", "Manual", "Long Ledge Makio Grind"];
    const strings = [...Object.values(REFUSED_TEXT)];
    for (const n of names) {
      for (const beatTag of [null, "GOOD", "PERFECT"]) for (const landing of ["clean", "stumble"]) strings.push(resultChip({ name: n, dir: "l", beatTag, landing }).text);
      strings.push(busyChip(n).text, progressChip({ kind: "grab", id: "x", name: n, dir: "u" }).text);
    }
    for (const s of strings) for (const w of CHIP_BANNED) expect(s.toUpperCase().split(/[^A-Z]+/)).not.toContain(w);
  });
});

describe("#330 E3 the hold bar and the beat pips", () => {
  it("the hold bar fills to holdCap and shows the cap", () => {
    const g = { kind: "grab", held: true };
    expect(holdBar(g, 0)).toEqual({ fill: 0, capped: false });
    expect(holdBar(g, 0.75)).toEqual({ fill: 0.5, capped: false });
    expect(holdBar(g, 1.5)).toEqual({ fill: 1, capped: true });
    expect(holdBar(g, 3)).toEqual({ fill: 1, capped: true });
    expect(holdBar({ kind: "grab", held: false }, 1)).toBeNull();
    expect(holdBar({ kind: "dance", held: true }, 1)).toBeNull();
  });

  it("one pip per beat; the past beats fill", () => {
    expect(beatPips({ time: 0, duration: 1.2 }, 2)).toEqual({ total: 2, past: 0 });
    expect(beatPips({ time: 0.6, duration: 1.2 }, 2)).toEqual({ total: 2, past: 1 });
    expect(beatPips({ time: 2.0, duration: 4.8 }, 8)).toEqual({ total: 8, past: 3 });
    expect(beatPips(null, 2)).toBeNull();
  });
});

describe("#330 the chip colors on the pill", () => {
  it("each text color gives 4.5:1 or more on the pill over white", () => {
    const pill = over([11, 11, 18, 0.82], [255, 255, 255]);
    for (const c of [[0xf3, 0xf3, 0xf7], [0xff, 0xd1, 0x66], [0x7e, 0xf0, 0xc2], [0xff, 0x80, 0xc4]]) expect(contrast(c, pill)).toBeGreaterThanOrEqual(4.5);
  });
});
