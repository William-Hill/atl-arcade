import { describe, expect, it } from "vitest";
import { GOVERNOR, createGovernor, currentRung, governorStep, ladderFor } from "./governor.js";
import { QUALITY } from "./quality.js";

function feed(g, ms, frames) {
  let s = g;
  let changes = 0;
  for (let i = 0; i < frames; i += 1) {
    s = governorStep(s, ms);
    if (s.changed) changes += 1;
  }
  return { g: s, changes };
}

describe("ladderFor", () => {
  it("steps the phone tier from 1.5 to 1.25 to 1, then turns the post off", () => {
    expect(ladderFor(QUALITY.phone)).toEqual([
      { pixelRatio: 1.5, post: "lite" },
      { pixelRatio: 1.25, post: "lite" },
      { pixelRatio: 1, post: "lite" },
      { pixelRatio: 1, post: null },
    ]);
  });
  it("starts the high tier at 2", () => {
    const l = ladderFor(QUALITY.high);
    expect(l[0]).toEqual({ pixelRatio: 2, post: "full" });
    expect(l.at(-1)).toEqual({ pixelRatio: 1, post: null });
  });
  it("gives the low tier only pixel ratio rungs", () => {
    expect(ladderFor(QUALITY.low).every((r) => r.post === null)).toBe(true);
  });
});

describe("governorStep", () => {
  it("does nothing during the warmup", () => {
    const { g, changes } = feed(createGovernor(ladderFor(QUALITY.phone)), 50, 50); // 2.5 s
    expect(changes).toBe(0);
    expect(g.rung).toBe(0);
  });

  it("keeps the rung while the median is in the budget", () => {
    const { g, changes } = feed(createGovernor(ladderFor(QUALITY.phone)), 16.7, 60 * 20);
    expect(changes).toBe(0);
    expect(currentRung(g)).toEqual({ pixelRatio: 1.5, post: "lite" });
  });

  it("steps down one rung when the median is over the budget, then waits", () => {
    let g = createGovernor(ladderFor(QUALITY.phone));
    g = feed(g, 16.7, 180).g; // 3 s warmup
    const r = feed(g, 40, GOVERNOR.window);
    expect(r.changes).toBe(1);
    expect(r.g.rung).toBe(1);
    // In the cooldown (2 s = 50 frames at 40 ms) nothing changes.
    expect(feed(r.g, 40, 49).changes).toBe(0);
  });

  it("goes down to the last rung on a slow device and stops there", () => {
    const { g, changes } = feed(createGovernor(ladderFor(QUALITY.phone)), 45, 5000);
    expect(changes).toBe(3);
    expect(currentRung(g)).toEqual({ pixelRatio: 1, post: null });
  });

  it("ignores a long pause, such as a hidden tab", () => {
    let g = createGovernor(ladderFor(QUALITY.phone));
    g = feed(g, 16.7, 200).g;
    const { changes } = feed(g, 5000, 200);
    expect(changes).toBe(0);
  });

  it("is not moved by a few slow frames", () => {
    let g = createGovernor(ladderFor(QUALITY.phone));
    g = feed(g, 16.7, 200).g;
    let changes = 0;
    for (let i = 0; i < 900; i += 1) {
      g = governorStep(g, i % 10 === 0 ? 60 : 16.7);
      if (g.changed) changes += 1;
    }
    expect(changes).toBe(0);
  });
});
