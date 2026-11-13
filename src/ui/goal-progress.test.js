import { describe, expect, it } from "vitest";
import { DONE_MARK, goalRows, goalStatus, metText, newlyMet, rowText, shortNumber } from "./goal-progress.js";
import { createGoals } from "../sim/skate/goals.js";
import { goalsFor } from "../level/goals.js";

// The round goals on the HUD (#268).

const BELTLINE = goalsFor("beltline-eastside");

function state(over = {}) {
  return { ...createGoals(BELTLINE), ...over };
}

describe("the goal rows", () => {
  it("has one row per goal type of the Beltline, in a fixed order", () => {
    const rows = goalRows(goalStatus(BELTLINE, state()));
    expect(rows.map((r) => r.key)).toEqual(["score", "combo", "cards", "gap"]);
    expect(rows.map((r) => [r.value, r.target, r.done])).toEqual([
      [0, 6000, false],
      [0, 1000, false],
      [0, 3, false],
      [0, 2, false],
    ]);
  });

  it("shows the progress of each goal, and the gaps as one count", () => {
    const rows = goalRows(goalStatus(BELTLINE, state({ score: 2340, best: 640, cards: 1, gaps: ["gap-stone-mountain"] })));
    expect(rows.map((r) => rowText(r))).toEqual(["Score 2,340/6,000", "Combo 640/1,000", "Cards 1/3", "Gaps 1/2"]);
    expect(rows.map((r) => rowText(r, true))).toEqual(["Score 2.3K/6K", "Combo 640/1K", "Cards 1/3", "Gaps 1/2"]);
  });

  it("shows the first open goal when a level has two goals of one type", () => {
    const status = [
      { id: "s1", type: "score", label: "Score 5,000", value: 6000, target: 5000, done: true },
      { id: "s2", type: "score", label: "Score 10,000", value: 6000, target: 10000, done: false },
    ];
    expect(goalRows(status).map((r) => rowText(r))).toEqual(["Score 6,000/10,000"]);
    const all = status.map((g) => ({ ...g, value: 12000, done: true }));
    expect(goalRows(all).map((r) => rowText(r))).toEqual([`${DONE_MARK} Score 10,000/10,000`]);
  });

  it("marks a done row with a check mark and keeps the value at the target", () => {
    const rows = goalRows(goalStatus(BELTLINE, state({ score: 7400, best: 1200, cards: 3, gaps: ["gap-freedom-parkway", "gap-stone-mountain"] })));
    expect(rows.every((r) => r.done)).toBe(true);
    expect(rows.map((r) => rowText(r))).toEqual([
      `${DONE_MARK} Score 6,000/6,000`,
      `${DONE_MARK} Combo 1,000/1,000`,
      `${DONE_MARK} Cards 3/3`,
      `${DONE_MARK} Gaps 2/2`,
    ]);
  });

  it("agrees with the results screen on each goal", () => {
    const s = state({ score: 6000, best: 999, cards: 3, gaps: [] });
    const status = goalStatus(BELTLINE, s);
    expect(status.map((g) => [g.id, g.done])).toEqual([
      ["score", true],
      ["combo", false],
      ["cards", true],
      ["gap-freedom-parkway", false],
      ["gap-stone-mountain", false],
    ]);
  });

  it("leaves out a type that the level does not have", () => {
    const def = { level: "t", time: 60, goals: [{ id: "s", type: "score", target: 100, label: "Score 100" }], medals: {} };
    expect(goalRows(goalStatus(def, createGoals(def))).map((r) => r.key)).toEqual(["score"]);
  });
});

describe("short numbers on the phone tier", () => {
  it("keeps numbers under 1,000 and writes thousands as K", () => {
    expect(shortNumber(640, true)).toBe("640");
    expect(shortNumber(1000, true)).toBe("1K");
    expect(shortNumber(2340, true)).toBe("2.3K");
    expect(shortNumber(2399, true)).toBe("2.3K");
    expect(shortNumber(12000, true)).toBe("12K");
    expect(shortNumber(12000)).toBe("12,000");
  });
});

describe("the confirmation of a met goal", () => {
  it("names each goal that is met at that moment, once", () => {
    const a = goalStatus(BELTLINE, state({ score: 5900, best: 900 }));
    const b = goalStatus(BELTLINE, state({ score: 6100, best: 1100 }));
    expect(newlyMet(a, b).map((g) => g.id)).toEqual(["score", "combo"]);
    expect(newlyMet(b, b)).toEqual([]);
    expect(metText(newlyMet(a, b)[0])).toBe(`${DONE_MARK} Goal met: Score 6,000 points`);
  });

  it("names each gap by its label", () => {
    const a = goalStatus(BELTLINE, state());
    const b = goalStatus(BELTLINE, state({ gaps: ["gap-freedom-parkway"] }));
    expect(newlyMet(a, b).map(metText)).toEqual([`${DONE_MARK} Goal met: Freedom Parkway Underpass Hop`]);
  });

  it("says nothing at the start of a run or on a replay", () => {
    const done = goalStatus(BELTLINE, state({ score: 9000 }));
    const fresh = goalStatus(BELTLINE, state());
    expect(newlyMet(null, done)).toEqual([]);
    expect(newlyMet(done, fresh)).toEqual([]);
  });
});
