import { describe, expect, it } from "vitest";
import { FACT_CARDS, createCardState, stepCards } from "./fact-cards.js";
import { createRun, stepRun } from "./skate/run.js";
import { GREYBOX } from "../level/greybox.js";

const CARDS = [
  { id: "a", position: [0, 1, 0] },
  { id: "b", position: [10, 1, 0] },
  { id: "c", position: [0, 20, 0] },
];

describe("stepCards", () => {
  it("collects a card in reach once, and leaves the others", () => {
    let s = createCardState(CARDS);
    expect(s).toMatchObject({ count: 0, total: 3 });
    const first = stepCards(s, [1, 0, 1]);
    expect(first.collected).toEqual(["a"]);
    expect(first.state.count).toBe(1);
    const again = stepCards(first.state, [1, 0, 1]);
    expect(again.collected).toEqual([]);
    expect(again.state).toBe(first.state);
    s = stepCards(again.state, [10, 0, FACT_CARDS.radius - 0.1]).state;
    expect(s.collected).toEqual(["a", "b"]);
  });
  it("does not collect a card out of reach in the ground plane or in height", () => {
    const s = createCardState(CARDS);
    expect(stepCards(s, [5, 1, 0]).collected).toEqual([]);
    expect(stepCards(s, [0, 20 - FACT_CARDS.height - 0.5, 0]).collected).toEqual([]);
  });
});

describe("fact cards in a run", () => {
  it("counts the collected cards in the run state and adds the points to the banked score", () => {
    const at = GREYBOX.spawn.position;
    let run = createRun(GREYBOX, { cards: [{ id: "here", position: [at[0], at[1], at[2]] }, { id: "far", position: [at[0] + 100, at[1], at[2]] }] });
    expect(run.cards).toMatchObject({ count: 0, total: 2 });
    run = stepRun(run, {}, 1 / 60);
    expect(run.factsCollected).toEqual(["here"]);
    expect(run.cards.count).toBe(1);
    expect(run.combo.score).toBe(FACT_CARDS.points);
    run = stepRun(run, {}, 1 / 60);
    expect(run.factsCollected).toEqual([]);
    expect(run.combo.score).toBe(FACT_CARDS.points);
  });
  it("has an empty card state when the level has no cards", () => {
    const run = stepRun(createRun(GREYBOX), {}, 1 / 60);
    expect(run.cards).toMatchObject({ count: 0, total: 0 });
  });
});
