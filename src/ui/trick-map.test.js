import { describe, expect, it } from "vitest";
import { DANCE_ORIGINS, NO_SOURCE, originOf } from "../content/dance-origins.js";
import { createBindings } from "../input/bindings.js";
import { createOneButton } from "../input/one-button.js";
import { CHIP_BANNED } from "./trick-hud-text.js";
import { CELL_ORDER, cardPlace, cellText, contextOf, flickCard, inputLine, oneButtonNext, originText, trickListSections } from "./trick-map.js";

const names = (card) => CELL_ORDER.map((d) => card.cells[d]);

describe("#330 E5 the flick card", () => {
  it("TRICK in the air shows the 5 grabs", () => {
    expect(names(flickCard("style1", "air"))).toEqual(["Mute Grab", "Rocket Grab", "Japan Grab", "Side Grab", "Tuck Knee"]);
    expect(cellText("r", "Side Grab")).toBe("→ Side Grab");
    expect(cellText("n", "Mute Grab")).toBe("• Mute Grab tap");
  });

  it("TRICK on the ground shows the TRICK dances of the skater (R7)", () => {
    expect(names(flickCard("style1", "ground", "nia"))).toEqual(["Bankhead Bounce", "Swag Surf", "Walk It Out", "The Prep", "Snap Lean"]);
    expect(names(flickCard("style1", "ground", "marcus"))).toEqual(["Swag Surf", "Drumline Count", "Walk It Out", "The Prep", "Jam Step"]);
  });

  it("TRICK in a grind or a manual, and SPIN off the ground, show one line", () => {
    expect(flickCard("style1", "grind")).toEqual({ line: "Off on a rail" });
    expect(flickCard("style1", "manual")).toEqual({ line: "Off in a manual" });
    expect(flickCard("style2", "air")).toEqual({ line: "SPIN: on the ground" });
    expect(names(flickCard("style2", "ground"))).toEqual(["Cross Step", "ATL Rydin", "Toe Spin", "Smooth Quad", "Sit Spin"]);
  });

  it("GRIND shows the 5 stances in any context", () => {
    for (const ctx of ["air", "ground", "grind", "manual"]) expect(names(flickCard("grind", ctx))).toEqual(["Grind", "Makio", "Soul", "Unity", "Royale"]);
  });

  it("one-button mode: TRICK shows the next item of the set", () => {
    const ob = createOneButton();
    expect(oneButtonNext(ob, "air")).toBe("Mute Grab");
    expect(oneButtonNext({ ...ob, next: { ...ob.next, air: 1 } }, "air")).toBe("Japan Grab");
    expect(flickCard("style1", "air", "nia", { oneButton: true, next: "Japan Grab" })).toEqual({ line: "Next: Japan Grab" });
  });

  it("the context comes from the skater state", () => {
    expect(contextOf({ state: "air" })).toBe("air");
    expect(contextOf({ state: "grind" })).toBe("grind");
    expect(contextOf({ state: "rolling", manual: {} })).toBe("manual");
    expect(contextOf({ state: "rolling" })).toBe("ground");
  });

  it("the card goes above the buttons in portrait, and to their left in landscape", () => {
    const portrait = cardPlace({ x: 212, y: 600, w: 200, h: 200 }, { w: 220, h: 100 }, 412, 839);
    expect(portrait.side).toBe("above");
    expect(portrait.y + 100).toBeLessThanOrEqual(600 - 8);
    const land = cardPlace({ x: 620, y: 200, w: 200, h: 200 }, { w: 220, h: 100 }, 839, 412);
    expect(land.side).toBe("left");
    expect(land.x + 220).toBeLessThanOrEqual(620 - 8);
  });
});

describe("#330 E6 the trick list", () => {
  it("has the 5 sections in order, with the buttons of the device", () => {
    const kb = trickListSections("nia", { device: "keyboard", bindings: createBindings() });
    expect(kb.map((s) => s.id)).toEqual(["air", "rail", "trick", "spin", "manual"]);
    expect(kb.map((s) => s.button)).toEqual(["Q", "F, at the snap", "Q", "E", "Hold F, no rail near"]);
    expect(kb.at(-1).note).toBe("Balance with W and S");
    const pad = trickListSections("nia", { device: "gamepad" });
    expect(pad.map((s) => s.button)).toEqual(["Y", "RT, at the snap", "Y", "B", "Hold RT, no rail near"]);
    const touch = trickListSections("nia", { device: "touch" });
    expect(touch[0].button).toBe("TRICK");
  });

  it("a pad remap changes the button names", () => {
    const b = createBindings({ gamepad: { buttons: { style1: [2] } } });
    expect(trickListSections("nia", { device: "gamepad", bindings: b })[0].button).toBe("X");
  });

  it("a remap changes the key names", () => {
    const b = createBindings({ keyboard: { style1: ["KeyZ"], dirUp: ["KeyI"], dirDown: ["KeyK"] } });
    const kb = trickListSections("nia", { device: "keyboard", bindings: b });
    expect(kb[0].button).toBe("Z");
    expect(kb.at(-1).note).toBe("Balance with I and K");
    expect(inputLine("keyboard", b)).toMatch(/^Direction \(I /);
  });

  it("Nia and Marcus show the TRICK dances of R7; the other sections are the same", () => {
    const nia = trickListSections("nia");
    const marcus = trickListSections("marcus");
    expect(nia[2].cells.map((c) => c.name)).toEqual(["Bankhead Bounce", "Swag Surf", "Walk It Out", "The Prep", "Snap Lean"]);
    expect(marcus[2].cells.map((c) => c.name)).toEqual(["Swag Surf", "Drumline Count", "Walk It Out", "The Prep", "Jam Step"]);
    for (const i of [0, 1, 3, 4]) expect(marcus[i].cells).toEqual(nia[i].cells);
    expect(nia[0].cells[1].label).toBe("Up: Rocket Grab");
  });

  it("each dance shows its origin or the no-source note", () => {
    for (const skater of ["nia", "marcus"]) {
      for (const s of trickListSections(skater).filter((x) => x.id === "trick" || x.id === "spin")) {
        for (const c of s.cells) {
          expect(c.origin.short.length, c.name).toBeGreaterThan(0);
          if (!c.origin.sources.length) expect(c.origin.short, c.name).toContain(NO_SOURCE);
        }
      }
    }
    expect(originOf("Unknown").short).toBe(NO_SOURCE);
  });

  it("no song title shows while the lyric check is open; Nae Nae is not on the screen", () => {
    expect(originText({ short: "x", song: "Some Song", lyricCheck: "open" })).toBe("x");
    expect(originText({ short: "x", song: "Some Song", lyricCheck: "passed" })).toBe("x. Song: Some Song");
    for (const o of Object.values(DANCE_ORIGINS)) {
      expect(o.lyricCheck).toBe("open");
      expect(o.song).toBeUndefined();
      expect(`${o.short} ${o.detail ?? ""}`).not.toMatch(/Nae Nae/i);
    }
  });

  it("the origin text uses no banned word", () => {
    for (const o of Object.values(DANCE_ORIGINS)) {
      const words = `${o.short} ${o.detail ?? ""}`.toUpperCase().split(/[^A-Z]+/);
      for (const w of CHIP_BANNED) expect(words).not.toContain(w);
    }
  });

  it("one-button mode puts the one-button set first and notes that the directions are off", () => {
    const s = trickListSections("marcus", { oneButton: true });
    expect(s[0].id).toBe("one-button");
    expect(s[0].list.map((l) => l.title)).toEqual(["Air", "Rail", "Ground"]);
    expect(s[1].note).toBe("Directions are off in one-button mode");
  });
});
