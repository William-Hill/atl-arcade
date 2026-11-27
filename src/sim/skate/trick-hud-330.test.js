// The sim data of the trick HUD (#330, docs/ux/trick-hud.md section 11):
// each combo link has the direction that chose it, and a TRICK or SPIN press
// during a dance gives the `ignored` event (the Busy cue).
import { describe, expect, it } from "vitest";
import { GRIND } from "./constants.js";
import { fr, rig, straightGrindable, vyFor } from "./trick-rig.js";

const BAL = GRIND.balanceDrift / GRIND.balanceCorrect;

describe("#330 the direction of each combo link", () => {
  it("a grab keeps its direction; a dance keeps its direction", () => {
    const r = rig({ speed: 6 }).air({ vy: vyFor(0.8) });
    r.steps(fr(200), { push: true });
    r.step({ style1: true, flick: { style1: "l" } });
    r.steps(fr(1000), {}, (run) => run.skater.state === "rolling");
    const grab = r.moves.find((m) => m.name === "Japan Grab");
    expect(grab).toMatchObject({ dir: "l" });
    expect(r.run.combo.links.at(-1)).toMatchObject({ name: "Japan Grab", dir: "l" });

    const d = rig({ speed: 5 });
    d.step({ style2: true, flick: { style2: "r" } });
    d.steps(fr(1300), { push: true }, (run) => run.skater.justStyled != null);
    expect(d.run.combo.links.at(-1)).toMatchObject({ name: "Smooth Quad", dir: "r" });
  });

  it("an air with no grab has no direction", () => {
    const r = rig({ speed: 6 }).air({ vy: vyFor(0.6) });
    r.steps(fr(1000), {}, (run) => run.skater.state === "rolling");
    expect(r.run.combo.links.at(-1)).toMatchObject({ name: "Ramp Air", dir: null });
  });

  it("a grind keeps its stance as the direction", () => {
    const g = straightGrindable("ledge:test", 0, 6);
    const r = rig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
    r.step({ grind: true, flick: { grind: "u" } });
    r.steps(200, { grind: true, steer: BAL }, (run) => run.skater.justExited);
    expect(r.run.combo.links.at(-1)).toMatchObject({ name: "Ledge Makio Grind", dir: "u" });
  });

  it("in one-button mode no link has a direction", () => {
    const r = rig({ speed: 6, tricks: { oneButton: true } }).air({ vy: vyFor(0.8) });
    r.steps(fr(200), { push: true });
    r.step({ style1: true });
    r.steps(fr(1000), { style1: false }, (run) => run.skater.state === "rolling");
    const link = r.run.combo.links.at(-1);
    expect(link.name).toBe("Mute Grab");
    expect(link.dir).toBeNull();
  });
});

describe("#330 the Busy cue: a press during a dance", () => {
  it("a TRICK or SPIN press while a dance runs gives `ignored` with the dance name, and starts nothing", () => {
    const r = rig({ speed: 5 });
    r.step({ style2: true, flick: { style2: "n" } });
    expect(r.s.style.name).toBe("Cross Step");
    r.steps(5, { push: true });
    expect(r.s.ignored).toBeNull();
    r.step({ push: true, style1: true });
    expect(r.s.ignored).toMatchObject({ name: "Cross Step", seq: 1 });
    expect(r.s.style.name).toBe("Cross Step");
    r.steps(3, { push: true });
    r.step({ push: true, style2: true });
    expect(r.s.ignored).toMatchObject({ name: "Cross Step", seq: 2 });
  });

  it("a press with no dance gives no `ignored` event", () => {
    const r = rig({ speed: 5 });
    r.step({ style2: true, flick: { style2: "n" } });
    expect(r.s.ignored).toBeNull();
  });

  it("not in one-button mode", () => {
    const r = rig({ speed: 5, tricks: { oneButton: true } });
    r.step({ style2: true, flick: { style2: "n" } });
    expect(r.s.style).not.toBeNull();
    r.steps(3, { push: true });
    r.step({ push: true, style2: true });
    expect(r.s.ignored).toBeNull();
  });
});
