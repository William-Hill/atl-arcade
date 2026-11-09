import { describe, expect, it } from "vitest";
import { LATE_GROUPS, createLateLoads, lateLoadPlan } from "./late-load.js";

const tick = () => new Promise((r) => setTimeout(r, 0));

function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}

describe("lateLoadPlan", () => {
  it("defers every group on the pbr look", () => {
    const plan = lateLoadPlan({ look: "pbr" });
    expect(Object.keys(plan)).toEqual(LATE_GROUPS);
    expect(Object.values(plan).every(Boolean)).toBe(true);
  });

  it("defers nothing on the toon look", () => {
    expect(Object.values(lateLoadPlan({ look: "toon" })).some(Boolean)).toBe(false);
  });

  it("defers nothing with ?lateload=0", () => {
    expect(Object.values(lateLoadPlan({ look: "pbr", lateload: "0" })).some(Boolean)).toBe(false);
    expect(Object.values(lateLoadPlan({ look: "pbr", lateload: "1" })).every(Boolean)).toBe(true);
  });
});

describe("createLateLoads", () => {
  it("starts a deferred group only after the first frame", async () => {
    const ff = gate();
    let t = 0;
    const late = createLateLoads(lateLoadPlan({ look: "pbr" }), ff.promise, { now: () => t });
    const calls = [];
    const p = late.run("props", () => {
      calls.push("props");
      return "kit";
    });
    await tick();
    expect(calls).toEqual([]);
    expect(late.info().started.props).toBeUndefined();
    t = 120;
    ff.open();
    expect(await p).toBe("kit");
    expect(calls).toEqual(["props"]);
    const info = late.info();
    expect(info.firstFrameMs).toBe(120);
    expect(info.started.props).toBe(120);
    expect(info.done.props).toBe(120);
  });

  it("starts a group that is not deferred at once", async () => {
    const ff = gate();
    let t = 5;
    const late = createLateLoads(lateLoadPlan({ look: "toon" }), ff.promise, { now: () => t });
    const p = late.run("ground", () => {
      t = 9;
      return 1;
    });
    expect(await p).toBe(1);
    expect(late.info().started.ground).toBe(5);
    expect(late.info().done.ground).toBe(9);
    expect(late.info().firstFrameMs).toBe(null);
  });

  it("records a failed load and passes the error on", async () => {
    const late = createLateLoads(lateLoadPlan({ look: "toon" }), new Promise(() => {}));
    await expect(late.run("murals", () => Promise.reject(new Error("404")))).rejects.toThrow("404");
    expect(late.info().failed.murals).toMatch(/404/);
    expect(late.info().done.murals).toBeUndefined();
  });

  it("keeps the first start and the first done of a group", async () => {
    let t = 1;
    const late = createLateLoads(lateLoadPlan({ look: "toon" }), Promise.resolve(), { now: () => t });
    await late.run("ground", () => null);
    t = 50;
    await late.run("ground", () => null);
    late.loaded("ground");
    expect(late.info().started.ground).toBe(1);
    expect(late.info().done.ground).toBe(1);
  });
});
