import { describe, expect, it } from "vitest";
import { CLAIM_PREFIX, FREE_RUN_HINT, goalLine, landmarkStepArgs, withClaimMedal, withGapGoal } from "./play.js";
import { createLandmarks, landmarkView, markSpot, prepareLandmarks, spotState, stepLandmarks } from "../sim/landmarks.js";
import { createGoals } from "../sim/skate/goals.js";

const DT = 1 / 60;
const DATA = {
  v: 1,
  level: "test-level",
  spots: [
    { id: "bridge", kind: "bridge", name: "Trail Bridge", at: [300, 0], find: { r: 20 }, short: "A bridge of 1910.", challenge: { type: "gap", tier: "typical", hint: "Hop the bridge", zone: { x: 300, z: 0, r: 8 }, goal: "gap-bridge" } },
    { id: "art", kind: "art", name: "Trail Art", at: [600, 0], find: { r: 14 }, short: "A piece of trail art.", challenge: { type: "line", tier: "typical", hint: "Ride the 3 rings in order in 14 s", checkpoints: [[600, 0], [630, 0], [660, 0]], seconds: 14 } },
    { id: "district", kind: "edge", name: "Old District", at: [900, 0], find: { r: 20 }, short: "A district east of here." },
  ],
};
const fresh = () => createLandmarks(prepareLandmarks(DATA), { level: DATA.level });
const DEF = { time: 150, goals: [{ id: "score", type: "score", target: 100, label: "Score" }, { id: "gap-bridge", type: "gap", label: "Bridge Hop", zone: { x: 300, z: 0, r: 8 } }], medals: { bronze: 2500, silver: 6000, gold: 12000 } };
// A run of src/sim/skate/run.js, as far as landmarkObs reads it.
const runAt = (x, z, skater = {}) => ({ skater: { position: [x, 0, z], state: "rolling", grind: null, ...skater }, moves: [], banked: 0 });

describe("when a landmark step runs", () => {
  it("is active from the first tick of a timed run until the run ends", () => {
    const g = createGoals(DEF);
    expect(landmarkStepArgs(runAt(0, 0), { timed: true, goals: g }).active).toBe(true);
    expect(landmarkStepArgs(runAt(0, 0), { timed: true, goals: { ...g, ended: true } }).active).toBe(false);
    expect(landmarkStepArgs(runAt(0, 0), { timed: true, goals: g }).obs.teleported).toBe(false);
  });

  it("marks the first tick after Travel here", () => {
    expect(landmarkStepArgs(runAt(0, 0), { timed: true, goals: createGoals(DEF), teleported: true }).obs.teleported).toBe(true);
  });

  it("finds a spot in a free run and claims none", () => {
    let s = fresh();
    // 30 ticks in the air in the gap zone, then a landing: a claim in a timed run.
    for (let i = 0; i < 30; i += 1) {
      const a = landmarkStepArgs(runAt(300, 0, { state: "air" }), { timed: false });
      s = stepLandmarks(s, a.obs, DT, { active: a.active });
    }
    const a = landmarkStepArgs(runAt(300, 0, { justLanded: true }), { timed: false });
    s = stepLandmarks(s, a.obs, DT, { active: a.active });
    expect(spotState(s, "bridge")).toBe("found");
    expect(s.run.claimed).toEqual([]);
  });

  it("claims the same hop in a timed run", () => {
    let s = fresh();
    const g = createGoals(DEF);
    for (let i = 0; i < 30; i += 1) {
      const a = landmarkStepArgs(runAt(300, 0, { state: "air" }), { timed: true, goals: g });
      s = stepLandmarks(s, a.obs, DT, { active: a.active });
    }
    const a = landmarkStepArgs(runAt(300, 0, { justLanded: true }), { timed: true, goals: g });
    s = stepLandmarks(s, a.obs, DT, { active: a.active });
    expect(spotState(s, "bridge")).toBe("claimed");
    expect(s.events.claimed[0].goal).toBe("gap-bridge");
  });
});

describe("a gap claim at the zone of a gap goal", () => {
  it("marks the goal in this run, once", () => {
    const g = createGoals(DEF);
    const marked = withGapGoal(g, "gap-bridge", DEF);
    expect(marked.gaps).toEqual(["gap-bridge"]);
    expect(marked.justCleared).toEqual(["gap-bridge"]);
    expect(withGapGoal(marked, "gap-bridge", DEF)).toBe(marked);
  });

  it("changes nothing for no goal, an unknown goal, a goal of another type, or a run that ended", () => {
    const g = createGoals(DEF);
    expect(withGapGoal(g, null, DEF)).toBe(g);
    expect(withGapGoal(g, "gap-other", DEF)).toBe(g);
    expect(withGapGoal(g, "score", DEF)).toBe(g);
    expect(withGapGoal({ ...g, ended: true }, "gap-bridge", DEF)).toEqual({ ...g, ended: true });
    expect(withGapGoal(null, "gap-bridge", DEF)).toBeNull();
  });
});

describe("claim points count toward the medal only", () => {
  const base = { score: 2300, bestCombo: 900, goals: [{ id: "score", value: 2300, target: 6000, done: false }], medal: null, next: { medal: "bronze", score: 2500 } };

  it("gives the medal from the banked score plus the claim points, and keeps the score", () => {
    const r = withClaimMedal(base, DEF.medals, 300);
    expect(r.medal).toBe("bronze");
    expect(r.next).toEqual({ medal: "silver", score: 6000 });
    expect(r.score).toBe(2300);
    expect(r.medalScore).toBe(2600);
    expect(r.claimPoints).toBe(300);
    expect(r.goals).toBe(base.goals);
  });

  it("changes no medal with 0 claim points", () => {
    const r = withClaimMedal(base, DEF.medals, 0);
    expect(r.medal).toBeNull();
    expect(r.next).toEqual(base.next);
  });
});

describe("AC-3: the HUD goal line", () => {
  it("is empty when no claim spot is Found", () => {
    expect(goalLine(landmarkView(fresh()), [0, 0, 0])).toBeNull();
    // An edge marker has no challenge: no line.
    expect(goalLine(landmarkView(markSpot(fresh(), "district", "found")), [900, 0, 0])).toBeNull();
  });

  it("shows the challenge of the nearest Found spot", () => {
    let s = markSpot(fresh(), "bridge", "found");
    s = markSpot(s, "art", "found");
    expect(goalLine(landmarkView(s), [310, 0, 0])).toEqual({ id: "bridge", text: `${CLAIM_PREFIX}hop the bridge` });
    expect(goalLine(landmarkView(s), [590, 0, 0])).toEqual({ id: "art", text: "Claim it: ride the 3 rings in order in 14 s" });
  });

  it("drops the line of a spot when it is Claimed", () => {
    const s = markSpot(markSpot(fresh(), "bridge", "found"), "bridge", "claimed");
    expect(goalLine(landmarkView(s), [300, 0, 0])).toBeNull();
  });

  it("shows the next ring and the time left of a line in progress, and never the word bail", () => {
    let s = markSpot(fresh(), "art", "found");
    const at = (x) => ({ position: [x, 0, 0], airborne: false, landed: false, bailed: false, teleported: false, grind: null, linked: false, banked: 0 });
    s = stepLandmarks(s, at(600), DT);
    for (let i = 0; i < 90; i += 1) s = stepLandmarks(s, at(610), DT);
    const line = goalLine(landmarkView(s), [610, 0, 0]);
    expect(line.text).toBe("Ring 2 of 3: 13 s left");
    // A bail resets the attempt: the line is the hint again.
    s = stepLandmarks(s, { ...at(612), bailed: true }, DT);
    const after = goalLine(landmarkView(s), [612, 0, 0]);
    expect(after.text).toBe("Claim it: ride the 3 rings in order in 14 s");
    for (const t of [line.text, after.text, FREE_RUN_HINT]) expect(t.toLowerCase()).not.toContain("bail");
  });

  it("asks for a timed run in a free run", () => {
    const s = markSpot(fresh(), "bridge", "found");
    expect(goalLine(landmarkView(s), [300, 0, 0], { timed: false })).toEqual({ id: "bridge", text: FREE_RUN_HINT });
  });
});
