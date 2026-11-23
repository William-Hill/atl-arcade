import { describe, expect, it } from "vitest";
import { NO_PERF, createFrameCost, summarize } from "./frame-cost.js";

function fakeClock() {
  let t = 0;
  return { now: () => t, add: (ms) => (t += ms) };
}

describe("frame cost", () => {
  it("adds the time between begin and end to the system", () => {
    const c = fakeClock();
    const perf = createFrameCost(c.now, ["walkers", "render"]);
    perf.begin("walkers");
    c.add(2);
    perf.end("walkers");
    perf.begin("render");
    c.add(5);
    perf.end("render");
    perf.frame();
    expect(perf.report()).toEqual({ frames: 1, stepsPerFrame: 0, systems: { walkers: { meanMs: 2, p95Ms: 2 }, render: { meanMs: 5, p95Ms: 5 } } });
  });

  it("sums a system that runs several times in one frame (fixed steps)", () => {
    const c = fakeClock();
    const perf = createFrameCost(c.now, ["traffic"]);
    for (let i = 0; i < 3; i += 1) {
      perf.begin("traffic");
      c.add(1);
      perf.end("traffic");
    }
    perf.steps(3);
    perf.frame();
    expect(perf.report().systems.traffic.meanMs).toBe(3);
    expect(perf.report().systems.traffic.perStepMs).toBe(1);
    expect(perf.report().stepsPerFrame).toBe(3);
  });

  it("gives a zero cost to a frame where the system did not run", () => {
    const c = fakeClock();
    const perf = createFrameCost(c.now, ["crowd"]);
    perf.begin("crowd");
    c.add(4);
    perf.end("crowd");
    perf.frame();
    perf.frame();
    expect(perf.report().systems.crowd.meanMs).toBe(2);
  });

  it("ignores an end with no begin, and reset clears the frames", () => {
    const c = fakeClock();
    const perf = createFrameCost(c.now, ["render"]);
    perf.end("render");
    perf.frame();
    perf.reset();
    expect(perf.report().frames).toBe(0);
  });

  it("gives the 95th percentile", () => {
    const frames = Array.from({ length: 100 }, (_, i) => ({ render: i + 1 }));
    expect(summarize(frames).systems.render).toEqual({ meanMs: 50.5, p95Ms: 95 });
  });

  it("the no-op version does nothing", () => {
    NO_PERF.begin("render");
    NO_PERF.end("render");
    NO_PERF.frame();
    expect(NO_PERF.report()).toBe(null);
    expect(NO_PERF.enabled).toBe(false);
  });
});
