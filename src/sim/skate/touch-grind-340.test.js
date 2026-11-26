import { describe, expect, it } from "vitest";
import { createInput } from "../../input/input.js";
import { createTouchTricks, touchTrickDown, touchTrickMove, touchTricksFrame } from "../../input/flick.js";
import { TRICK_INPUT } from "../../input/trick-constants.js";
import { DT, fr, rig, straightGrindable } from "./trick-rig.js";

// #340: a touch GRIND press goes from the touch layer through createInput()
// to the sim, as in the game loop (src/main.js). The press is at the
// touch-down; the stance comes at the flick resolve, once, after the snap.

// A touch overlay in the shape of src/input/touch.js on the pure flick state.
function touchStub() {
  let st = createTouchTricks();
  const api = {
    events: [],
    sample(t) {
      for (const e of api.events) st = e(st, t * 1000);
      api.events = [];
      const f = touchTricksFrame(st, t * 1000, TRICK_INPUT, (DT * 1000) / 2);
      st = f.state;
      return { steer: 0, push: false, brake: false, jump: false, grind: f.out.grind, style1: f.out.style1, style2: f.out.style2, switch: false, flick: f.out.flick, grindFlick: f.out.grindFlick, dirs: { lastDir: st.lastDir, lastDirAt: st.lastDirAt, hist: st.hist, held: false }, balance: 0 };
    },
    touching: false,
  };
  return api;
}
const target = () => ({ addEventListener() {}, removeEventListener() {} });

function game() {
  const g = straightGrindable("ledge:test", 0, 20);
  const r = rig({ grindables: [g], speed: 6, position: [-1, 0, 0] });
  const touch = touchStub();
  const input = createInput({ target: target(), getGamepads: () => [], touch });
  // One game frame: the input samples at the time of the step (as sampleInput(run.time + dt)).
  const frame = (extra = {}) => {
    const f = input.sample(r.s.time + DT);
    return { f, run: r.step({ ...f, ...extra }) };
  };
  return { r, touch, frame };
}

describe("#340 touch GRIND in the sim", () => {
  it("AC: the press reaches the sim at the touch-down frame, and a flick up after the snap gives Makio at that frame, once", () => {
    const { r, touch, frame } = game();
    touch.events.push((s, t) => touchTrickDown(s, "grind", 2, 0, 0, t));
    const first = frame();
    expect(first.f).toMatchObject({ grind: true, grindFlick: true, flick: { grind: null } });
    expect(r.s.state).toBe("grind"); // the snap is at the touch-down frame
    expect(r.s.trick.id).toBe("edge");
    // 3 frames with the finger still: the stance waits.
    for (let i = 0; i < 3; i += 1) frame();
    expect(r.s.trick.id).toBe("edge");
    // The finger moves 24 px up: the flick resolves at this frame.
    touch.events.push((s, t) => touchTrickMove(s, 2, 0, -24, t));
    const res = frame();
    expect(res.f.flick.grind).toBe("u");
    expect(r.s.state).toBe("grind");
    expect(r.s.trick).toMatchObject({ kind: "grind", id: "makio", clip: "grind_makio", name: "Ledge Makio Grind" });
    // Later moves do not change the stance.
    touch.events.push((s, t) => touchTrickMove(s, 2, -40, -24, t));
    for (let i = 0; i < 5; i += 1) frame();
    expect(r.s.trick.id).toBe("makio");
  });

  it("with no flick, the stance resolves neutral at flickMaxMs and stays neutral", () => {
    const { r, touch, frame } = game();
    touch.events.push((s, t) => touchTrickDown(s, "grind", 2, 0, 0, t));
    frame();
    let at = null;
    for (let i = 1; i <= fr(200); i += 1) {
      const { f } = frame();
      if (f.flick.grind != null && at == null) at = i;
    }
    expect(at).toBe(fr(TRICK_INPUT.flickMaxMs));
    expect(r.s.trick.id).toBe("edge");
  });
});
