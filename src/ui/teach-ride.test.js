import { describe, expect, it } from "vitest";
import { linkRide, pinRide } from "../../e2e/teach-ride.js";
import { park } from "../../e2e/skatepark-ride.js";
import { simTricks } from "../input/trick-constants.js";
import { createRun, stepRun } from "../sim/skate/run.js";
import { createTeach, stepTeach } from "./teach-steps.js";

// The grind pin of the teach prompts (#76) leads to a real feature: a player
// who rides from the BeltLine Eastside spawn to the point the pin shows and
// holds grind snaps onto the skatepark rail, and the combo tip can end.
describe("teach grind pin ride (BeltLine Eastside)", () => {
  function replay(ride) {
    const { level, env, skaterEnv } = park();
    let run = createRun(level, ride.start);
    let teach = { ...createTeach(), done: { push: true, steer: true, jump: true, dance: true } };
    let snapTick = null;
    let tick = 0;
    for (const entry of ride.script) {
      for (let i = 0; i < entry.frames; i += 1) {
        const before = run.skater;
        run = stepRun(run, entry.input, 1 / 60, env, skaterEnv);
        teach = stepTeach(teach, before, run.skater, entry.input, run.combo);
        tick += 1;
        if (run.skater.justSnapped && snapTick === null) snapTick = tick;
      }
    }
    return { teach, snapTick, run };
  }

  it("from the spawn, the pin points at the end rail and the ride snaps in under 12 s", () => {
    const ride = pinRide();
    expect(ride.target.id).toBe("rail:skatepark:h4w-skatepark:end-rail:top");
    expect(ride.target.distance).toBeGreaterThan(55);
    expect(ride.target.distance).toBeLessThan(70);
    expect(ride.snapAt / 60).toBeLessThan(12);
    expect(ride.links).toEqual(["Rail Grind", "Hop", "Toe Spin"]);
    const { teach, snapTick } = replay(ride);
    expect(snapTick).toBe(ride.snapAt);
    expect(teach.done.grind).toBe(true);
    // The rail ride has no grab, a neutral stance, and no manual: the trick steps (#331) come next.
    expect(teach.step).toBe("grab");
    expect(teach.finished).toBe(false);
  }, 30000);

  it("the short ride of the browser test starts 25 m out and gets the same combo", () => {
    const ride = pinRide({ approach: 25 });
    expect(ride.links).toEqual(["Rail Grind", "Hop", "Toe Spin"]);
    expect(replay(ride).teach.done.grind).toBe(true);
  }, 30000);
});

// The stance and the manual link steps (#331) in the skatepark: the ride of
// e2e/teach-ride.js linkRide, with the trick rules on as in the game.
describe("teach trick steps ride (#331)", () => {
  function replay(ride, start = "stance") {
    const { level, env, skaterEnv: base } = park();
    const skaterEnv = { ...base, tricks: simTricks({}) };
    let run = createRun(level, ride.start);
    let teach = createTeach(start);
    const order = [];
    for (const entry of ride.script) {
      for (let i = 0; i < entry.frames; i += 1) {
        const before = run.skater;
        run = stepRun(run, entry.input, 1 / 60, env, skaterEnv);
        teach = stepTeach(teach, before, run.skater, entry.input, run.combo);
        order.push(...teach.justDone);
      }
    }
    return { teach, order, run };
  }

  it("a Soul Grind, GRIND held off the bar into a manual, and a jump finish the stance, the link, and the combo tip", () => {
    const ride = linkRide();
    expect(ride.stance).toBe("l");
    expect(ride.manualFrom).toBe("link");
    expect(ride.launch).toMatchObject({ state: "air", reason: "jump" });
    expect(ride.links.slice(0, 3)).toEqual(["Rail Soul Grind", "Hop", "Manual"]);
    const { teach, order } = replay(ride);
    expect(order).toEqual(["stance", "link", "combo"]);
    expect(teach.finished).toBe(true);
  }, 30000);

  it("a neutral stance does not finish the stance step, and the manual link still counts", () => {
    const ride = linkRide({ stance: "n" });
    expect(ride.stance).toBe("n");
    const { teach } = replay(ride);
    expect(teach.done.stance).toBeUndefined();
    expect(teach.done.link).toBe(true);
    expect(teach.step).toBe("stance");
  }, 30000);
});
