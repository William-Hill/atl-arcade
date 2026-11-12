import { describe, expect, it } from "vitest";
import { planRide, replay, spots } from "../../e2e/landmark-rides.js";

// Every challenge of the Beltline file, with the REAL skate controller on the
// loaded level (the planner of e2e/landmark-rides.js, the rides that
// e2e/landmarks.spec.js replays in the browser). This shows that each
// challenge position can be ridden: the curb is there and long enough, the
// checkpoints are on a way the skater can ride in the time, the gap zone has
// ground to hop on, the combo zone has room for the combo.
describe("the challenges of the Beltline file with the real controller", () => {
  const claimSpots = spots().filter((s) => s.challenge);

  it("claims each of the claim spots of the file with a planned ride, with no bail", { timeout: 180000 }, () => {
    expect(claimSpots.length).toBeGreaterThan(0);
    const failed = [];
    for (const s of claimSpots) {
      const ride = planRide(s.id);
      if (!ride.claimed) failed.push(`${s.id}: ${ride.note}`);
    }
    expect(failed).toEqual([]);
  });

  it("marks the gap goal of the Freedom Parkway spot on the tick of the claim, and banks the claim points", () => {
    const ride = planRide("freedom-parkway-bridge");
    const r = replay(ride.script, ride.start);
    expect(r.gaps).toEqual(["gap-freedom-parkway"]);
    expect(r.claimSum).toBe(200);
    expect(r.state("freedom-parkway-bridge")).toBe("claimed");
  });

  it("does not claim a grind spot with a grind that is too short", () => {
    const ride = planRide("ralph-mcgill-bridge");
    expect(ride.grindMeters).toBeGreaterThanOrEqual(15);
    // The same ride, cut 30 ticks before the claim.
    let left = ride.claimTick - 30;
    const cut = [];
    for (const e of ride.script) {
      if (left <= 0) break;
      cut.push({ ...e, frames: Math.min(e.frames, left) });
      left -= e.frames;
    }
    const r = replay(cut, ride.start);
    expect(r.claimed).toEqual([]);
    expect(r.state("ralph-mcgill-bridge")).toBe("found");
  });
});
