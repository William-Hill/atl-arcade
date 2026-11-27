import { describe, expect, it } from "vitest";
import { park, stepperFor } from "../../../e2e/skatepark-ride.js";
import { planRide, spots, startAt } from "../../../e2e/landmark-rides.js";
import { route, stripGraph } from "../../../e2e/route-ride.js";
import { travelSpot } from "../../level/geo/travel.js";
import { goalsFor } from "../../level/goals.js";
import facts from "../../../levels/beltline-eastside/facts.json" with { type: "json" };
import { comboValue } from "./combo.js";
import { yawFromHeading } from "./controller.js";
import { computeResults, createGoals, goalsJson, stepGoals } from "./goals.js";
import { createRun } from "./run.js";

// #336, GDD R12.1: in one-button mode the player can reach every goal and
// every landmark challenge with the movement inputs (steer, push, brake,
// JUMP) and TRICK only. Each run here is planned in a closed loop with the
// REAL controller on the game level (Beltline Eastside, the default level),
// with the trick rules on in one-button mode, and each frame goes through
// oneButtonFrame() as in the game (stepperFor() in e2e/skatepark-ride.js).
// The device frames hold no GRIND, SPIN, or SWITCH, and no direction.
//
// The greybox is the debug level (src/level/levels.js); it has no fact
// cards, so it is not in this test.

const DT = 1 / 60;
const LEVEL = "beltline-eastside";
const ALLOWED = new Set(["steer", "push", "brake", "jump", "style1"]);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v) => Math.max(-1, Math.min(1, v));

// The keys of the device frames of a script that are not allowed.
function badKeys(frames) {
  const bad = new Set();
  for (const f of frames) for (const k of Object.keys(f.input ?? f)) if (!ALLOWED.has(k)) bad.add(k);
  return [...bad];
}

// The fact cards as the game places them (src/main.js).
function factCards() {
  const { env } = park();
  return facts.cards.map((c) => ({ id: c.id, position: [c.at[0], env.sampleGround(c.at[0], c.at[1])?.height ?? 0, c.at[1]] }));
}

// One full run with the goals of the level, in one-button mode. `plan(run, t)`
// gives the intent of a tick, or null to stop. The run has the fact cards.
function goalRun(start, plan, { max = 60 * 150 } = {}) {
  const { level } = park();
  const def = goalsFor(LEVEL);
  const stepper = stepperFor(true);
  let run = createRun(level, { ...start, cards: factCards() });
  let goals = createGoals(def);
  const frames = [];
  for (let t = 0; t < max && !goals.ended; t += 1) {
    const intent = plan(run, t);
    if (!intent) break;
    const stepped = stepper.step(run, intent);
    run = stepped.run;
    frames.push(stepped.frame);
    goals = stepGoals(goals, run, def, DT, { cards: run.cards.count });
  }
  // A roll to the end of the combo, as the time end does.
  for (let i = 0; i < 240 && run.combo.active; i += 1) {
    run = stepper.step(run, {}).run;
    goals = stepGoals(goals, run, def, DT, { cards: run.cards.count });
  }
  const results = computeResults(goalsJson(goals, def), def);
  return { results, frames, done: (id) => results.goals.find((g) => g.id === id).done, time: goals.time, stats: run.skater.stats };
}

// The heading of the trail at a point, the nearer of its 2 ways to `yaw`.
function trailYaw(x, z, yaw) {
  const here = travelSpot(park().level, x, z, { kinds: ["trail"] });
  if (!here) return yaw;
  return Math.abs(wrap(here.yaw - yaw)) < Math.PI / 2 ? here.yaw : wrap(here.yaw + Math.PI);
}

// Score and combo goals: on the trail, hops and TRICK taps (the next dance of
// the set) in turn. At 1,500 points the skater stops the tricks and rolls
// until the combo banks, then starts the next combo.
function scoreRun(score) {
  const { level } = park();
  const sp = travelSpot(level, -111.5, -895.5, { kinds: ["trail"] }); // the trail at Ponce City Market
  let step = 0;
  let wait = 0;
  return goalRun(startAt(sp.x, sp.z, sp.yaw), (run, t) => {
    const s = run.skater;
    if (run.combo.score >= score && !run.combo.active) return null;
    const steer = clamp(wrap(trailYaw(s.position[0], s.position[2], s.yaw) - s.yaw) * 3);
    if (t < 80) return { push: true, steer };
    if (run.combo.active && comboValue(run.combo) >= 1500) return { steer, push: s.speed < 6 };
    if (s.state !== "rolling" || s.style || wait > 0) {
      wait = Math.max(0, wait - 1);
      return { push: true, steer };
    }
    wait = 3;
    step += 1;
    return { ...(step % 2 ? { jump: true } : { trick: true }), push: true, steer };
  });
}

// The cards goal: ride the route on the strip network through the 3 cards.
function cardsRun() {
  const pts = factCards().map((c) => [c.position[0], c.position[2]]);
  const graph = stripGraph(park().level);
  const way = [];
  for (let i = 0; i + 1 < pts.length; i += 1) way.push(...route(graph, pts[i], pts[i + 1]));
  way.push(pts[pts.length - 1]);
  let next = 0;
  return goalRun(startAt(pts[0][0], pts[0][1], yawFromHeading(way[2][0] - way[0][0], way[2][1] - way[0][1])), (run) => {
    const s = run.skater;
    while (next < way.length && Math.hypot(s.position[0] - way[next][0], s.position[2] - way[next][1]) < (next === way.length - 1 ? 1.5 : 3)) next += 1;
    if (next >= way.length) return null;
    const err = wrap(yawFromHeading(way[next][0] - s.position[0], way[next][1] - s.position[2]) - s.yaw);
    return { push: Math.abs(err) < 0.6 || s.speed < 4, brake: Math.abs(err) > 1.2 && s.speed > 5, steer: clamp(err * 4) };
  });
}

// A gap goal: roll along the trail into the gap zone, JUMP at its center.
// Tries both ways of the trail and 3 run-ups; the first run that clears it.
function gapRun(goal) {
  const z = goal.zone;
  let last = null;
  for (const turn of [0, Math.PI]) {
    for (const back of [9, 6, 12]) {
      const yaw = wrap((travelSpot(park().level, z.x, z.z, { kinds: ["trail"] })?.yaw ?? 0) + turn);
      const start = startAt(z.x - Math.cos(yaw) * back, z.z + Math.sin(yaw) * back, yaw);
      last = goalRun(start, (run, t) => {
        const s = run.skater;
        if (t > 260) return null;
        if (s.state === "air") return {};
        const d = Math.hypot(s.position[0] - z.x, s.position[2] - z.z);
        return d < 2.5 && t < 200 ? { push: true, jump: true } : { push: t < 200 };
      });
      if (last.done(goal.id)) return last;
    }
  }
  return last;
}

describe("#336 one-button mode: every goal of the game level, with the movement inputs and TRICK only", () => {
  const def = goalsFor(LEVEL);
  const runs = { score: () => scoreRun(def.goals.find((g) => g.id === "score").target), combo: () => scoreRun(1500), cards: cardsRun };

  it("the goal list has the goal types of src/sim/skate/goals.js", () => {
    expect(new Set(def.goals.map((g) => g.type))).toEqual(new Set(["score", "combo", "cards", "gap"]));
  });

  for (const goal of def.goals) {
    it(`completes the goal "${goal.label}" (${goal.id}) in one run`, { timeout: 120000 }, () => {
      const r = goal.type === "gap" ? gapRun(goal) : runs[goal.type]();
      expect(r.done(goal.id)).toBe(true);
      expect(badKeys(r.frames)).toEqual([]);
      expect(r.stats.falls).toBe(0);
      expect(r.time).toBeLessThanOrEqual(def.time);
    });
  }

  it("the combo goal run and the score goal run press TRICK (they use dances, not only hops)", () => {
    const r = scoreRun(def.goals.find((g) => g.id === "score").target);
    expect(r.frames.some((f) => f.style1)).toBe(true);
  });
});

describe("#336 one-button mode: every landmark challenge, with the movement inputs and TRICK only", () => {
  const challenges = spots().filter((s) => s.challenge);

  it("has challenges of each type", () => {
    expect(new Set(challenges.map((s) => s.challenge.type))).toEqual(new Set(["combo", "grind", "line", "gap"]));
  });

  for (const s of spots().filter((x) => x.challenge)) {
    it(`claims ${s.id} (${s.challenge.type}) with no bail`, { timeout: 120000 }, () => {
      const ride = planRide(s.id, { oneButton: true });
      expect(ride.note ?? "").toBe("");
      expect(ride.claimed).toBe(true);
      expect(badKeys(ride.script)).toEqual([]);
      if (s.challenge.type === "grind" || s.id === "historic-fourth-ward-skatepark") {
        // The rail snaps come from TRICK (there is no GRIND in the script).
        expect(ride.script.some((e) => e.input.style1)).toBe(true);
      }
    });
  }
});

describe("#336 the route helper (e2e/route-ride.js)", () => {
  it("a junction never links 2 points of one strip: the route keeps the bends (CodeRabbit on PR #403)", () => {
    const level = { strips: [{ kind: "path", points: [[0, 0], [0, 3], [1, 3], [1, 0]] }] };
    const way = route(stripGraph(level, { step: 1 }), [0, 0], [1, 0]);
    expect(way.length).toBeGreaterThan(2);
    expect(way).toContainEqual([0, 3]);
    expect(way).toContainEqual([1, 3]);
  });

  it("a junction links 2 near points of different strips", () => {
    const level = { strips: [{ kind: "path", points: [[0, 0], [10, 0]] }, { kind: "path", points: [[10, 2], [20, 2]] }] };
    const way = route(stripGraph(level), [0, 0], [20, 2]);
    expect(way).not.toBeNull();
    expect(way.at(-1)).toEqual([20, 2]);
  });
});
