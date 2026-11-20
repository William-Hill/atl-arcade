import { describe, expect, it } from "vitest";
import { GOVERNOR, LITE_GOVERNOR, createGovernor, currentRung, governorStep, ladderFor, nextRung } from "./governor.js";
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

// Pbr lite (#246): the pbr look on the phone tier steps down to the toon look.
describe("the pbr lite ladder", () => {
  const ladder = ladderFor(QUALITY.phone, { lookDown: true });

  it("keeps the pbr look and the post pass on the pixel ratio rungs, and ends in toon", () => {
    expect(ladder).toEqual([
      { pixelRatio: 1.5, post: "lite", look: "pbr" },
      { pixelRatio: 1.25, post: "lite", look: "pbr" },
      { pixelRatio: 1, post: "lite", look: "pbr" },
      { pixelRatio: 1.5, post: "lite", look: "toon" },
    ]);
  });

  it("does not change the ladders of the other tiers and looks", () => {
    expect(ladderFor(QUALITY.phone).at(-1)).toEqual({ pixelRatio: 1, post: null });
    expect(ladderFor(QUALITY.high).some((r) => "look" in r)).toBe(false);
  });

  it("stays in pbr on a phone inside the budget", () => {
    const { g, changes } = feed(createGovernor(ladder, LITE_GOVERNOR), 16.7, 60 * 60);
    expect(changes).toBe(0);
    expect(currentRung(g).look).toBe("pbr");
  });

  it("lowers the pixel ratio first when that can reach the budget", () => {
    // 30 ms at 1.5: at 1.25 the pixels are 69 %, about 21 ms, in the budget.
    let g = feed(createGovernor(ladder, LITE_GOVERNOR), 16.7, 180).g;
    const r = feed(g, 30, GOVERNOR.window);
    expect(r.changes).toBe(1);
    expect(currentRung(r.g)).toEqual({ pixelRatio: 1.25, post: "lite", look: "pbr" });
    // Then the phone holds the budget: no more steps.
    g = feed(r.g, 21, 60 * 30).g;
    expect(currentRung(g).look).toBe("pbr");
  });

  it("skips to pixel ratio 1 when 1.25 cannot reach the budget", () => {
    // 50 ms at 1.5: 35 ms at 1.25 (over), 22 ms at 1 (inside).
    expect(nextRung(ladder, 0, 50, LITE_GOVERNOR)).toBe(2);
    expect(nextRung(ladder, 0, 50, GOVERNOR)).toBe(1);
  });

  it("steps to toon at once when no pixel ratio can reach the budget", () => {
    // 80 ms at 1.5 is 36 ms at 1: still over 25 ms.
    expect(nextRung(ladder, 0, 80, LITE_GOVERNOR)).toBe(3);
    const g = feed(createGovernor(ladder, LITE_GOVERNOR), 80, 38 + 50); // 3 s warmup, then 4 s
    expect(g.changes).toBe(1);
    expect(currentRung(g.g).look).toBe("toon");
    // The measurement ended on time (4 s), not after 90 frames (7.2 s).
    expect(g.g.elapsed).toBeLessThan(7100);
  });

  it("steps down through every rung to toon when the frames stay slow", () => {
    // 28 ms whatever the pixel ratio (a CPU-bound phone): 1.25, then 1, then toon.
    let s = createGovernor(ladder, LITE_GOVERNOR);
    const looks = [];
    for (let i = 0; i < 4000; i += 1) {
      s = governorStep(s, 28);
      if (s.changed) looks.push(`${currentRung(s).look} ${currentRung(s).pixelRatio}`);
    }
    expect(looks).toEqual(["pbr 1.25", "pbr 1", "toon 1.5"]);
    // The toon rung is the last: nothing more changes.
    expect(feed(s, 28, 1000).changes).toBe(0);
  });

  it("counts very slow frames in a row as a slow phone, not as a pause", () => {
    // 400 ms frames are over maxFrameMs (250 ms). The plain governor ignores
    // them; the lite governor counts them from the 4th in a row.
    expect(feed(createGovernor(ladderFor(QUALITY.phone)), 400, 200).changes).toBe(0);
    const { g, changes } = feed(createGovernor(ladder, LITE_GOVERNOR), 400, 30);
    expect(changes).toBe(1);
    expect(currentRung(g).look).toBe("toon");
  });

  it("still ignores one long pause between good frames", () => {
    let g = feed(createGovernor(ladder, LITE_GOVERNOR), 16.7, 200).g;
    let changes = 0;
    for (let i = 0; i < 2000; i += 1) {
      g = governorStep(g, i % 50 === 0 ? 5000 : 16.7);
      if (g.changed) changes += 1;
    }
    expect(changes).toBe(0);
  });
});
