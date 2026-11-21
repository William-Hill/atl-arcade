import { describe, expect, it } from "vitest";
import { pinRide } from "../../e2e/teach-ride.js";
import { park } from "../../e2e/skatepark-ride.js";
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
    expect(teach.finished).toBe(true);
  }, 30000);

  it("the short ride of the browser test starts 25 m out and gets the same combo", () => {
    const ride = pinRide({ approach: 25 });
    expect(ride.links).toEqual(["Rail Grind", "Hop", "Toe Spin"]);
    expect(replay(ride).teach.finished).toBe(true);
  }, 30000);
});
