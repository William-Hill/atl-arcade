import { describe, expect, it } from "vitest";
import { createBindings } from "./bindings.js";
import { createKeyDirs, createPadDirs, dirFields, freshDir, keyBalance, keyDirDown, keyDirUp, keyDirsClear, keyHeldDir, padDirUpdate, resolvePending, resolvePress, stickDir } from "./direction.js";
import { createInput } from "./input.js";
import { R3_ONLY, RELAXED, TRICK_INPUT, trickKnobs } from "./trick-constants.js";

const F = 1 / 60; // one sim frame
const R3 = trickKnobs({ r3Only: true });

// A keyboard and gamepad driver on the real createInput(), on frame times.
// `frame(i)` samples at t = i / 60. Events before a sample get that time.
function rig({ pads = () => [] } = {}) {
  const listeners = {};
  const target = {
    addEventListener: (type, fn) => (listeners[type] ||= []).push(fn),
    removeEventListener: () => {},
  };
  const fire = (type, code) => (listeners[type] || []).forEach((fn) => fn({ code, preventDefault() {} }));
  const input = createInput({ target, getGamepads: pads });
  return {
    input,
    down: (code) => fire("keydown", code),
    up: (code) => fire("keyup", code),
    blur: () => (listeners.blur || []).forEach((fn) => fn()),
    frame: (i) => input.sample(i * F),
  };
}

// The sim side of R3: resolve a TRICK press at frame `pressFrame`, then step
// the pending press frame by frame. Returns { dir, frame } of the resolve.
function resolveAt(r, pressFrame, k = TRICK_INPUT, after = () => {}) {
  let f = r.frame(pressFrame);
  let res = resolvePress(f.t, f.dirHist, k);
  let i = pressFrame;
  while (res.pending != null) {
    i += 1;
    after(i);
    f = r.frame(i);
    res = resolvePending(res, f.t, f.dirHist, k);
  }
  return { dir: res.dir, frame: i };
}

// Plays key events by frame: { [frame]: [["down", "KeyA"], ...] }, frames
// from `from` to `to`, sampling each frame.
function play(r, events, from, to) {
  for (let i = from; i <= to; i += 1) {
    for (const [kind, code] of events[i] || []) r[kind](code);
    r.frame(i);
  }
}

describe("#341 input contract: dir, lastDir, lastDirAt", () => {
  it("gives dir with the newest held key winning", () => {
    const r = rig();
    r.down("KeyW");
    expect(r.frame(1).dir).toBe("u");
    r.down("KeyA");
    expect(r.frame(2).dir).toBe("l");
    r.up("KeyA");
    expect(r.frame(3).dir).toBe("u");
    r.up("KeyW");
    expect(r.frame(4).dir).toBe("n");
  });

  it("keeps lastDir and lastDirAt after the key is let go", () => {
    const r = rig();
    r.down("KeyD");
    const a = r.frame(10);
    expect(a).toMatchObject({ lastDir: "r", lastDirAt: 10 * F, lastDirHeld: true });
    r.up("KeyD");
    const b = r.frame(12);
    expect(b).toMatchObject({ dir: "n", lastDir: "r", lastDirAt: 10 * F, lastDirHeld: false });
    expect(b.dirHist).toEqual([{ dir: "r", at: 10 * F, up: 12 * F }]);
  });

  it("gives the time of the sample to a key event (the sim clock)", () => {
    const r = rig();
    r.down("ArrowUp");
    expect(r.input.sample(3.5)).toMatchObject({ t: 3.5, lastDir: "u", lastDirAt: 3.5 });
  });

  it("does not make a new start event on key repeat or a second key of one action", () => {
    const r = rig();
    r.down("KeyW");
    r.frame(1);
    r.down("KeyW"); // key repeat
    r.down("ArrowUp"); // the second key of dirUp
    r.frame(5);
    expect(r.input.frame).toMatchObject({ lastDirAt: 1 * F, dir: "u" });
    r.up("KeyW");
    expect(r.frame(6).dir).toBe("u"); // ArrowUp still holds dirUp
    r.up("ArrowUp");
    expect(r.frame(7).dir).toBe("n");
  });

  it("keeps a tap inside one frame as a start event", () => {
    const r = rig();
    r.down("KeyA");
    r.up("KeyA");
    expect(r.frame(4)).toMatchObject({ dir: "n", lastDir: "l", lastDirAt: 4 * F, lastDirHeld: false });
  });

  it("lets go of every direction on blur", () => {
    const r = rig();
    r.down("KeyW");
    r.frame(1);
    r.blur();
    expect(r.frame(2)).toMatchObject({ dir: "n", lastDirHeld: false });
  });

  it("forgets old start events when the sim clock goes back (a new run)", () => {
    const r = rig();
    r.down("KeyA");
    r.up("KeyA");
    r.input.sample(100);
    expect(r.input.sample(0.1)).toMatchObject({ lastDir: "n", lastDirAt: -Infinity });
  });
});

describe("#341 direction actions dirLeft, dirRight, dirUp, dirDown", () => {
  it("binds W/A/S/D and the arrows by default and is rebindable", () => {
    const b = createBindings();
    expect(b.keyboard).toMatchObject({ dirLeft: ["KeyA", "ArrowLeft"], dirRight: ["KeyD", "ArrowRight"], dirUp: ["KeyW", "ArrowUp"], dirDown: ["KeyS", "ArrowDown"] });
    const r = rig();
    r.input.bindings = createBindings({ keyboard: { dirUp: ["KeyI"] } });
    r.down("KeyW");
    expect(r.frame(1).dir).toBe("n");
    r.down("KeyI");
    expect(r.frame(2).dir).toBe("u");
  });

  it("gives no direction for Shift (Shift pushes only)", () => {
    const r = rig();
    r.down("ShiftLeft");
    const f = r.frame(1);
    expect(f).toMatchObject({ push: true, dir: "n", lastDir: "n" });
  });
});

describe("#341 R3 fresh direction (keyboard, 60 Hz frames)", () => {
  it("AC: a W tap that ends before the press gives Up (frame -6 to -3)", () => {
    const r = rig();
    play(r, { 94: [["down", "KeyW"]], 97: [["up", "KeyW"]] }, 90, 99);
    expect(resolveAt(r, 100).dir).toBe("u");
    // The same with the R3 rule only (toggle 7).
    const r2 = rig();
    play(r2, { 94: [["down", "KeyW"]], 97: [["up", "KeyW"]] }, 90, 99);
    expect(resolveAt(r2, 100, R3).dir).toBe("u");
  });

  it("AC: W held 1 s, then A down 3 frames before the press gives Left", () => {
    for (const k of [TRICK_INPUT, R3]) {
      const r = rig();
      play(r, { 40: [["down", "KeyW"]], 97: [["down", "KeyA"]] }, 40, 99);
      expect(resolveAt(r, 100, k).dir).toBe("l");
    }
  });

  it("AC: a fresh left at the press, then up 2 frames after, stays Left", () => {
    for (const k of [TRICK_INPUT, R3]) {
      const r = rig();
      play(r, { 98: [["down", "KeyA"]] }, 90, 99);
      const f = r.frame(100);
      const res = resolvePress(f.t, f.dirHist, k);
      expect(res).toEqual({ dir: "l", at: f.t });
      r.down("KeyW");
      r.frame(101);
      const g = r.frame(102);
      // The press resolved at its frame: a later up cannot change it.
      expect(resolvePending(res, g.t, g.dirHist, k)).toEqual(res);
    }
  });

  it("AC: Shift held to push gives neutral", () => {
    const r = rig();
    play(r, { 40: [["down", "ShiftLeft"]] }, 40, 99);
    expect(resolveAt(r, 100).dir).toBe("n");
  });

  it("AC: W held 1 s to push gives neutral (Bankhead Bounce slot)", () => {
    for (const k of [TRICK_INPUT, R3]) {
      const r = rig();
      play(r, { 40: [["down", "KeyW"]] }, 40, 99);
      expect(resolveAt(r, 100, k).dir).toBe("n");
    }
  });

  it("AC: a right 100 ms before counts; 160 ms before gives neutral", () => {
    const a = rig();
    play(a, { 94: [["down", "KeyD"]] }, 90, 99);
    expect(resolveAt(a, 100).dir).toBe("r");
    const b = rig();
    play(b, { 90: [["down", "KeyD"]] }, 85, 99); // frame -10 = 167 ms; 160 ms rounds to frame 10
    expect(resolveAt(b, 100).dir).toBe("n");
  });

  it("AC: with no fresh direction, the first direction in dirAfter sets the trick (up 20 ms after = frame 1)", () => {
    const r = rig();
    play(r, {}, 90, 99);
    const res = resolveAt(r, 100, TRICK_INPUT, (i) => i === 101 && r.down("KeyW"));
    expect(res).toEqual({ dir: "u", frame: 101 });
  });

  it("AC: with no direction, the press resolves neutral 60 ms after (frame 4)", () => {
    const r = rig();
    expect(resolveAt(r, 100)).toEqual({ dir: "n", frame: 104 });
  });

  it("AC: left and then right in the window, right wins", () => {
    for (const k of [TRICK_INPUT, R3]) {
      const r = rig();
      play(r, { 93: [["down", "KeyA"]], 96: [["up", "KeyA"], ["down", "KeyD"]] }, 90, 99);
      expect(resolveAt(r, 100, k).dir).toBe("r");
    }
  });

  it("AC: Relaxed timing counts a direction 240 ms before (frame -14)", () => {
    const relaxed = trickKnobs({ relaxed: true });
    expect(relaxed).toMatchObject(RELAXED);
    const r = rig();
    play(r, { 86: [["down", "KeyA"], ["up", "KeyA"]] }, 80, 99);
    expect(resolveAt(r, 100, relaxed).dir).toBe("l");
    const r2 = rig();
    play(r2, { 86: [["down", "KeyA"], ["up", "KeyA"]] }, 80, 99);
    expect(resolveAt(r2, 100).dir).toBe("n");
  });
});

describe("#341 R3a axis rule (default since 2026-11-25)", () => {
  it("is the default; toggle 7 turns it off", () => {
    expect(TRICK_INPUT).toMatchObject({ axisRule: true, udHold: 0.3, udFirst: true });
    expect(R3_ONLY).toMatchObject({ axisRule: false });
  });

  it("AC: W down 15 frames (250 ms) before and still held gives Up; R3 only gives neutral", () => {
    const r = rig();
    play(r, { 85: [["down", "KeyW"]] }, 80, 99);
    expect(resolveAt(r, 100).dir).toBe("u");
    const r2 = rig();
    play(r2, { 85: [["down", "KeyW"]] }, 80, 99);
    expect(resolveAt(r2, 100, R3).dir).toBe("n");
  });

  it("AC: W tapped at frame -6, D down at frame -3 and held: Up; R3 only: Right", () => {
    const ev = { 94: [["down", "KeyW"]], 95: [["up", "KeyW"]], 97: [["down", "KeyD"]] };
    const r = rig();
    play(r, ev, 90, 99);
    expect(resolveAt(r, 100).dir).toBe("u");
    const r2 = rig();
    play(r2, ev, 90, 99);
    expect(resolveAt(r2, 100, R3).dir).toBe("r");
  });

  it("keeps the dirBefore window for an up that was let go before the press", () => {
    const r = rig();
    play(r, { 85: [["down", "KeyW"]], 90: [["up", "KeyW"]] }, 80, 99); // 250 ms before, let go
    expect(resolveAt(r, 100).dir).toBe("n");
  });

  it("on one axis the later fresh event wins", () => {
    const r = rig();
    play(r, { 92: [["down", "KeyW"]], 96: [["down", "KeyS"]] }, 90, 99);
    expect(resolveAt(r, 100).dir).toBe("d");
  });

  it("a left or right held past dirBefore is not fresh", () => {
    const r = rig();
    play(r, { 80: [["down", "KeyA"]] }, 80, 99);
    expect(resolveAt(r, 100).dir).toBe("n");
  });

  it("an up/down beats a left/right in the same frame after the press", () => {
    const hist = [
      { dir: "l", at: 1 + F, up: null },
      { dir: "u", at: 1 + F, up: null },
    ];
    expect(resolvePending({ pending: 1 }, 1 + F, hist, TRICK_INPUT).dir).toBe("u");
    expect(resolvePending({ pending: 1 }, 1 + F, hist, R3).dir).toBe("u"); // the later in the list
  });
});

describe("#341 gamepad direction (R2)", () => {
  const padOf = (x, y, pressed = []) => ({ id: "pad", connected: true, axes: [x, y, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) });

  it("AC: stick x 0.49 is neutral; 0.5 is a side; x 0.6 y 0.7 gives up or down", () => {
    expect(stickDir(0.49, 0)).toBe("n");
    expect(stickDir(0.5, 0)).toBe("r");
    expect(stickDir(-0.5, 0)).toBe("l");
    expect(stickDir(0.6, 0.7)).toBe("u");
    expect(stickDir(0.6, -0.7)).toBe("d");
    expect(stickDir(0.7, 0.7)).toBe("u"); // a tie goes to up or down
  });

  it("makes a start event when the stick crosses 0.5 on a new axis side, and a d-pad press", () => {
    let p = padOf(0, 0);
    const r = rig({ pads: () => [p] });
    expect(r.frame(1).lastDir).toBe("n");
    p = padOf(-0.4, 0);
    expect(r.frame(2).lastDir).toBe("n");
    p = padOf(-0.8, 0);
    expect(r.frame(3)).toMatchObject({ dir: "l", lastDir: "l", lastDirAt: 3 * F, lastDirHeld: true });
    p = padOf(-0.9, 0.1);
    expect(r.frame(4).lastDirAt).toBe(3 * F); // same side: no new event
    // The browser gives up as negative.
    p = padOf(0, -0.9);
    expect(r.frame(5)).toMatchObject({ dir: "u", lastDir: "u", lastDirAt: 5 * F });
    p = padOf(0, 0, [13]);
    expect(r.frame(6)).toMatchObject({ dir: "d", lastDir: "d" });
    p = padOf(0, 0);
    expect(r.frame(7)).toMatchObject({ dir: "n", lastDirHeld: false });
  });

  it("gives a fresh stick direction to the R3 rule", () => {
    let p = padOf(0, 0);
    const r = rig({ pads: () => [p] });
    for (let i = 90; i <= 95; i += 1) r.frame(i);
    p = padOf(0.9, 0);
    expect(resolveAt(r, 96).dir).toBe("r");
  });

  it("gives the same direction on the keyboard and the gamepad", () => {
    let p = padOf(0, 0);
    const pr = rig({ pads: () => [p] });
    pr.frame(95);
    p = padOf(0, -1);
    pr.frame(96);
    const kr = rig();
    kr.down("KeyW");
    kr.frame(96);
    expect(resolveAt(pr, 98).dir).toBe(resolveAt(kr, 98).dir);
  });

  it("gives the balance from the stick y with the sign changed after the deadzone", () => {
    const r = rig({ pads: () => [padOf(0, -0.7)] });
    expect(r.frame(1).balance).toBeCloseTo((0.7 - 0.15) / 0.85, 5);
    const d = rig({ pads: () => [padOf(0, 0, [12])] });
    expect(d.frame(1).balance).toBe(1);
  });

  it("clears the pad direction when the pad goes away", () => {
    let pads = [padOf(0.9, 0)];
    const r = rig({ pads: () => pads });
    expect(r.frame(1).dir).toBe("r");
    pads = [];
    expect(r.frame(2)).toMatchObject({ dir: "n", lastDirHeld: false });
  });
});

describe("#341 pure trackers", () => {
  it("keyboard balance: newest of up and down wins, else 0", () => {
    let k = createKeyDirs();
    expect(keyBalance(k)).toBe(0);
    k = keyDirDown(k, "u", 0);
    expect(keyBalance(k)).toBe(1);
    k = keyDirDown(k, "l", 0.1);
    expect(keyBalance(k)).toBe(1);
    k = keyDirDown(k, "d", 0.2);
    expect(keyBalance(k)).toBe(-1);
    k = keyDirUp(k, "d", 0.3);
    expect(keyBalance(k)).toBe(1);
    expect(keyHeldDir(k)).toBe("l");
    k = keyDirsClear(k, 0.4);
    expect(k.held).toEqual([]);
    expect(k.hist.every((e) => e.up != null)).toBe(true);
  });

  it("dirFields takes the newest start event of all devices", () => {
    const k = keyDirDown(createKeyDirs(), "l", 1);
    const p = padDirUpdate(createPadDirs(), "u", 2);
    expect(dirFields(k, p)).toMatchObject({ dir: "l", lastDir: "u", lastDirAt: 2, lastDirHeld: true });
    expect(dirFields(k, p).dirHist.map((e) => e.dir)).toEqual(["l", "u"]);
  });

  it("freshDir with no history is neutral", () => {
    expect(freshDir([], 1)).toBe("n");
    expect(freshDir(undefined, 1, R3)).toBe("n");
  });

  it("resolvePress with dirAfter 0 gives neutral at once", () => {
    expect(resolvePress(1, [], { ...TRICK_INPUT, dirAfter: 0 })).toEqual({ dir: "n", at: 1 });
  });
});
