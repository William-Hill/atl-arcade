import { describe, expect, it } from "vitest";
import { OVERTIME_TEXT, ROUND_END, STOPPING_TEXT, roundPhase, roundStatus } from "./round-end.js";
import { createGoals, stepGoals } from "./goals.js";

const DEF = { level: "t", time: 150, overtime: 10, goals: [{ id: "score", type: "score", target: 100, label: "Score" }], medals: { bronze: 1, silver: 2, gold: 3 } };
const run = (active) => ({ skater: { state: "rolling", position: [0, 0, 0] }, combo: { active, score: 0, best: 0 } });

describe("the soft end of a timed round (#260)", () => {
  it("has no phase with no timer", () => {
    expect(roundPhase(null)).toBe("none");
    expect(roundStatus("none", null, DEF)).toBeNull();
  });

  it("plays, then shows the overtime while a combo is open", () => {
    let g = createGoals(DEF);
    expect(roundPhase(g)).toBe("play");
    expect(roundStatus("play", g, DEF)).toBeNull();
    g = stepGoals({ ...g, time: 149.99 }, run(true), DEF, 1 / 60);
    expect(g.ended).toBe(false);
    expect(roundPhase(g)).toBe("overtime");
    expect(roundStatus("overtime", g, DEF)).toBe(`${OVERTIME_TEXT}: 10 s`);
    g = stepGoals({ ...g, time: 155.2 }, run(true), DEF, 1 / 60);
    expect(roundStatus(roundPhase(g), g, DEF)).toBe(`${OVERTIME_TEXT}: 5 s`);
  });

  it("stops the input with a message for the hold time, then shows the results", () => {
    const g = stepGoals({ ...createGoals(DEF), time: 150 }, run(false), DEF, 1 / 60);
    expect(g.ended).toBe(true);
    expect(roundPhase(g, { endedFor: 0 })).toBe("stopping");
    expect(roundStatus("stopping", g, DEF)).toBe(STOPPING_TEXT);
    expect(roundPhase(g, { endedFor: ROUND_END.hold - 0.02 })).toBe("stopping");
    expect(roundPhase(g, { endedFor: ROUND_END.hold })).toBe("results");
    expect(roundStatus("results", g, DEF)).toBeNull();
  });

  it("keeps the hold in its tuning range", () => {
    expect(ROUND_END.hold).toBeGreaterThanOrEqual(0.8);
    expect(ROUND_END.hold).toBeLessThanOrEqual(2.5);
  });
});
