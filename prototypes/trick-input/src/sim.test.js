import { describe, expect, it } from "vitest";
import { TRICK } from "./constants.js";
import { createInput, frameInput, padDisconnect, padSample, rebind } from "./input.js";
import { key, run, T, tap } from "./harness.js";
import { createSim, place } from "./sim.js";

// A fresh sim and input. beat: false, so the points are exact (B = 1).
const setup = (opts = {}) => ({ s: createSim({ beat: false, ...opts }), inp: createInput() });
const ofType = (s, type) => s.log.filter((e) => e.type === type);
const tricks = (s) => ofType(s, "trick");

// A ramp air of about 1 s (vy 5), placed at t = 0, far from the rail.
const rampAir = (s) => place(s, { x: 10, z: 8, yaw: 0, speed: 6, mode: "air", vy: 5, base: 100, baseName: "Ramp Air" });
const rolling = (s, speed = 6) => place(s, { x: 10, z: 8, yaw: 0, speed });

describe("R3 in the sim (keyboard)", () => {
  it("ramp air 0.3 s, A 100 ms before Q: Japan Grab at the Q frame", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(12)), key("KeyQ", true, T(18))], 18);
    expect(s.trick).toMatchObject({ id: "japan", clip: "air_japan" });
    expect(tricks(s)[0].frame).toBe(18);
  });
  it("ground Q with a right 100 ms before: The Prep; 160 ms before: Bankhead Bounce", () => {
    let { s, inp } = setup();
    rolling(s);
    run(s, inp, [key("KeyD", true, T(54)), key("KeyQ", true, T(60))], 60);
    expect(s.trick.name).toBe("The Prep");
    ({ s, inp } = setup());
    rolling(s);
    run(s, inp, [key("KeyD", true, T(50)), key("KeyQ", true, T(60))], 70);
    expect(s.trick.name).toBe("Bankhead Bounce");
  });
  it("a fresh up 1 frame after Q starts the dance at that frame; no direction: neutral 4 frames after", () => {
    let { s, inp } = setup();
    rolling(s);
    run(s, inp, [key("KeyQ", true, T(60)), key("KeyW", true, T(61))], 70);
    expect(tricks(s)[0]).toMatchObject({ name: "Swag Surf", frame: 61 });
    ({ s, inp } = setup());
    rolling(s);
    run(s, inp, [key("KeyQ", true, T(60))], 70);
    expect(tricks(s)[0]).toMatchObject({ name: "Bankhead Bounce", frame: 64 });
  });
  it("left then right before the press: right wins", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(14)), key("KeyD", true, T(16)), key("KeyQ", true, T(18))], 18);
    expect(s.trick.id).toBe("side");
  });
  it("a fresh left at Q, then up 2 frames after: the trick stays left", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(15)), key("KeyQ", true, T(18)), key("KeyW", true, T(20))], 24);
    expect(s.trick.id).toBe("japan");
  });
  it("W tapped between frame -6 and -3: Up", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [...tap("KeyW", T(12), 3 / 60), key("KeyQ", true, T(18))], 18);
    expect(s.trick.id).toBe("rocket");
  });
  it("W held 1 s, A 3 frames before Q: Left", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyW", true, 0), key("KeyA", true, T(57)), key("KeyQ", true, T(60))], 60);
    expect(s.trick.id).toBe("japan");
  });
  it("Shift held to push, Q: neutral", () => {
    const { s, inp } = setup();
    rolling(s);
    run(s, inp, [key("ShiftLeft", true, T(50)), key("KeyQ", true, T(55))], 70);
    expect(s.trick.name).toBe("Bankhead Bounce");
  });
  it("W held 1 s to push, Q on the ground: the neutral dance", () => {
    const { s, inp } = setup();
    rolling(s, 4);
    run(s, inp, [key("KeyW", true, 0), key("KeyQ", true, T(60))], 70);
    expect(s.trick.name).toBe("Bankhead Bounce");
  });
});

describe("air (R4, R5, R10)", () => {
  it("a grab needs 0.1 s of air: 0.083 s no, 0.1 s yes", () => {
    let { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(4)), key("KeyQ", true, T(5))], 10);
    expect(s.air.grab).toBeNull();
    ({ s, inp } = setup());
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(5)), key("KeyQ", true, T(6))], 10);
    expect(s.air.grab.id).toBe("japan");
  });
  it("a second press in one air does not change the grab", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(10)), ...tap("KeyQ", T(12)), key("KeyW", true, T(28)), key("KeyQ", true, T(30))], 32);
    expect(s.air.grab.id).toBe("japan");
  });
  it("an air of 0.15 s with TRICK: no link (minAirTime 0.2 s)", () => {
    const { s, inp } = setup();
    place(s, { x: 10, z: 8, yaw: 0, speed: 6, mode: "air", vy: 0.735, base: 50, baseName: "Hop" });
    run(s, inp, [...tap("KeyQ", T(7), 0.03)], 20);
    expect(ofType(s, "land")).toHaveLength(1);
    expect(ofType(s, "link")).toHaveLength(0);
  });
  it("SPIN in the air does nothing", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyE", true, T(20))], 30);
    expect(tricks(s)).toHaveLength(0);
  });
  it("up and down give air_rocket and air_tuckknee", () => {
    let { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyW", true, T(10)), key("KeyQ", true, T(12))], 13);
    expect(s.trick.clip).toBe("air_rocket");
    ({ s, inp } = setup());
    rampAir(s);
    run(s, inp, [key("KeyS", true, T(10)), key("KeyQ", true, T(12))], 13);
    expect(s.trick.clip).toBe("air_tuckknee");
  });
  it("a ramp air with no press links Ramp Air for the air points only", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [], 80);
    expect(ofType(s, "link")[0]).toMatchObject({ name: "Ramp Air", earned: 100 });
  });
  it("a grab held at the touchdown is a stumble: half pay, speed 0.7 times", () => {
    const { s, inp } = setup();
    rampAir(s);
    let vBefore = 0;
    run(s, inp, [key("KeyA", true, T(10)), key("KeyQ", true, T(12))], 80, (sim) => {
      if (sim.mode === "air") vBefore = sim.speed;
    });
    const land = ofType(s, "land")[0];
    expect(land.result).toBe("stumble");
    const link = ofType(s, "link")[0];
    expect(link.earned).toBe(Math.round(link.points * TRICK.stumbleKeep));
    expect(s.speed).toBeLessThan(vBefore * 0.71);
  });
  it("TRICK let go 1 frame before the touchdown: clean", () => {
    // Find the touchdown frame first.
    const probe = setup();
    rampAir(probe.s);
    run(probe.s, probe.inp, [], 80);
    const td = ofType(probe.s, "land")[0].frame;
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(10)), key("KeyQ", true, T(12)), key("KeyQ", false, T(td - 1))], 80);
    expect(ofType(s, "land")[0].result).toBe("clean");
    expect(ofType(s, "link")[0].name).toBe("Japan Grab");
  });
  it("a grab that starts 3 frames before the touchdown is void: no grab points, clean", () => {
    const probe = setup();
    rampAir(probe.s);
    run(probe.s, probe.inp, [], 80);
    const td = ofType(probe.s, "land")[0].frame;
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(td - 6)), key("KeyQ", true, T(td - 3))], 80);
    expect(ofType(s, "grab-void")).toHaveLength(1);
    expect(ofType(s, "land")[0].result).toBe("clean");
    expect(ofType(s, "link")[0]).toMatchObject({ name: "Ramp Air", earned: 100 });
  });
  it("Relaxed timing: a grab 0.15 s (9 frames) before the touchdown is void", () => {
    const probe = setup();
    rampAir(probe.s);
    run(probe.s, probe.inp, [], 80);
    const td = ofType(probe.s, "land")[0].frame;
    const s = createSim({ beat: false, k: { ...TRICK, landingGrace: 0.2 } });
    const inp = createInput();
    rampAir(s);
    run(s, inp, [key("KeyQ", true, T(td - 9))], 80);
    expect(ofType(s, "grab-void")).toHaveLength(1);
    expect(ofType(s, "land")[0].result).toBe("clean");
  });
  it("a turn in the air is never a fault", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyD", true, T(2)), key("KeyD", false, T(32))], 80);
    expect(ofType(s, "land")[0].result).toBe("clean");
  });
});

// The rail runs along x from -14 to -4 at z 0. The skater rolls in from x -20.
const toRail = (s, speed = 8) => place(s, { x: -20, z: 0, yaw: 0, speed });

describe("grind stances (R6)", () => {
  it("a snap with a fresh left: Rail Soul Grind, grind_soul", () => {
    const { s, inp } = setup();
    toRail(s);
    // The skater reaches x -14 after 0.75 s (frame 45).
    run(s, inp, [key("KeyA", true, T(40)), key("KeyA", false, T(42)), key("KeyF", true, T(44))], 50);
    expect(s.mode).toBe("grind");
    expect(s.trick).toMatchObject({ clip: "grind_soul", name: "Rail Soul Grind" });
  });
  it("a neutral snap: Rail Grind; the link adds 100 + 35 per m", () => {
    const { s, inp } = setup();
    toRail(s);
    run(s, inp, [key("KeyF", true, T(40))], 170);
    const link = ofType(s, "link")[0];
    const exit = ofType(s, "grind-exit")[0];
    expect(link.name).toMatch(/Rail Grind$/);
    expect(link.points).toBe(Math.round(100 + 35 * exit.meters));
  });
  it("a fresh up: Makio, +30", () => {
    const { s, inp } = setup();
    toRail(s);
    run(s, inp, [key("KeyW", true, T(40)), key("KeyW", false, T(42)), key("KeyF", true, T(43))], 170);
    const link = ofType(s, "link")[0];
    const exit = ofType(s, "grind-exit")[0];
    expect(link.name).toContain("Makio");
    expect(link.points).toBe(Math.round(100 + 35 * exit.meters + 30));
  });
  it("a GRIND tap 100 ms before the rail and a fresh right at the snap: Unity", () => {
    const { s, inp } = setup();
    toRail(s);
    // In range from frame 45 (x -14). Tap F at frame 39; right at frame 44.
    run(s, inp, [...tap("KeyF", T(39), 0.03), key("KeyD", true, T(44)), key("KeyD", false, T(45))], 48);
    const snapE = ofType(s, "snap")[0];
    expect(snapE.frame - 39).toBeLessThanOrEqual(9); // inside GRIND.buffer
    expect(snapE.stance).toBe("unity");
  });
  it("a new direction during the grind does not change the clip", () => {
    const { s, inp } = setup();
    toRail(s);
    run(s, inp, [key("KeyF", true, T(40)), key("KeyA", true, T(60))], 70);
    expect(s.trick.clip).toBe("grind_frontside");
  });
});

describe("dances (R7)", () => {
  it("1.4 m/s: no dance; 1.5 m/s: a dance", () => {
    let { s, inp } = setup();
    rolling(s, 1.4);
    run(s, inp, [key("KeyQ", true, T(1))], 10);
    expect(tricks(s)).toHaveLength(0);
    ({ s, inp } = setup());
    rolling(s, 1.5);
    run(s, inp, [key("KeyQ", true, T(1))], 10);
    expect(tricks(s)).toHaveLength(1);
  });
  it("Nia, E with no direction: Cross Step for 2 beats (1.2 s), 150 points", () => {
    const { s, inp } = setup();
    rolling(s);
    run(s, inp, [...tap("KeyE", T(1), 0.05)], 120);
    const link = ofType(s, "link")[0];
    expect(link).toMatchObject({ name: "Cross Step", earned: 150 });
    expect(link.frame - tricks(s)[0].frame).toBe(72);
  });
  it("E with up: ATL Rydin, 8 beats, 600", () => {
    const { s, inp } = setup();
    rolling(s, 8);
    run(s, inp, [key("KeyW", true, T(1)), key("KeyW", false, T(3)), ...tap("KeyE", T(3), 0.05)], 300);
    const link = ofType(s, "link")[0];
    expect(link).toMatchObject({ name: "ATL Rydin", earned: 600 });
    expect(link.frame - tricks(s)[0].frame).toBe(288);
  });
  it("Marcus: Q neutral is Swag Surf; with up, Drumline Count", () => {
    let s = createSim({ skater: "marcus", beat: false });
    let inp = createInput();
    rolling(s);
    run(s, inp, [...tap("KeyQ", T(1), 0.05)], 10);
    expect(tricks(s)[0].name).toBe("Swag Surf");
    s = createSim({ skater: "marcus", beat: false });
    inp = createInput();
    rolling(s);
    run(s, inp, [...tap("KeyW", T(1), 0.03), ...tap("KeyQ", T(3), 0.05)], 10);
    expect(tricks(s)[0].name).toBe("Drumline Count");
  });
});

describe("manual (R8, F1, F2)", () => {
  it("F held 0.2 s at 5 m/s: manual; push is off", () => {
    const { s, inp } = setup();
    rolling(s, 5);
    run(s, inp, [key("KeyF", true, T(1)), key("ShiftLeft", true, T(1))], 13);
    expect(s.mode).toBe("manual");
    const v = s.speed;
    run(s, inp, [], 5);
    expect(s.speed).toBeLessThan(v);
  });
  it("the manual starts at manualDelay (frame 9 after the press), not before", () => {
    const { s, inp } = setup();
    rolling(s, 6);
    run(s, inp, [key("KeyF", true, T(1))], 9);
    expect(s.mode).toBe("ground");
    run(s, inp, [], 1);
    expect(s.mode).toBe("manual");
  });
  it("2.9 m/s at the delay: no manual; 3.0 m/s: manual", () => {
    for (const [v, mode] of [[2.9, "ground"], [3.0, "manual"]]) {
      const { s, inp } = setup();
      rolling(s, 5);
      run(s, inp, [key("KeyF", true, T(1))], 9);
      s.speed = v;
      run(s, inp, [], 1);
      expect(s.mode).toBe(mode);
    }
  });
  it("a fresh up at the GRIND press: Toe Roll, manual_toe, 40 + 15 m + 20", () => {
    const { s, inp } = setup();
    rolling(s, 6);
    run(s, inp, [key("KeyW", true, T(1)), key("KeyW", false, T(2)), key("KeyF", true, T(3)), key("KeyF", false, T(40))], 45);
    const end = ofType(s, "manual-end")[0];
    const link = ofType(s, "link")[0];
    expect(link.name).toBe("Toe Roll");
    expect(link.points).toBe(Math.round(40 + 15 * end.meters + 20));
  });
  it("F held from 0.1 s before the rail is in range: no manual, the grind snaps", () => {
    const { s, inp } = setup();
    toRail(s);
    run(s, inp, [key("KeyF", true, T(39))], 50);
    expect(ofType(s, "manual-start")).toHaveLength(0);
    expect(s.mode).toBe("grind");
  });
  it("F held toward a rail 2 s away: a manual, then the grind snaps", () => {
    const { s, inp } = setup();
    place(s, { x: -30, z: 0, yaw: 0, speed: 8 });
    run(s, inp, [key("KeyF", true, T(1))], 40);
    expect(s.mode).toBe("manual");
    // Balance with W/S so the manual lasts to the rail.
    run(s, inp, [], 120, (sim, f) => {
      if (sim.manual) {
        const want = sim.manual.m > 0 ? "KeyW" : "KeyS";
        inp.down.delete("KeyW");
        inp.down.delete("KeyS");
        inp.dirs = { ...inp.dirs, held: [want === "KeyW" ? "u" : "d"] };
        inp.down.add(want);
      }
      void f;
    });
    expect(ofType(s, "manual-end")[0].reason).toBe("rail");
    expect(ofType(s, "snap")).toHaveLength(1);
  });
  it("a release ends the manual clean, with no speed loss", () => {
    const { s, inp } = setup();
    rolling(s, 6);
    run(s, inp, [key("KeyF", true, T(1)), key("KeyF", false, T(30))], 30);
    const v = s.speed;
    expect(ofType(s, "manual-end")[0].reason).toBe("release");
    expect(v).toBeGreaterThan(5.8);
  });
  it("no balance input: a stumble at about 1.25 s, speed 0.7 times", () => {
    const { s, inp } = setup();
    rolling(s, 8);
    let vPrev = 0;
    run(s, inp, [key("KeyF", true, T(1))], 120, (sim) => {
      if (sim.mode === "manual") vPrev = sim.speed;
    });
    const end = ofType(s, "manual-end")[0];
    const start = ofType(s, "manual-start")[0];
    expect(end.reason).toBe("balance");
    expect(end.t - start.t).toBeGreaterThan(1.2);
    expect(end.t - start.t).toBeLessThan(1.3);
    expect(ofType(s, "link")[0].landing).toBe("stumble");
    expect(s.speed).toBeLessThan(vPrev * 0.71);
  });
  it("the grind-to-manual link: F held through the rail end starts a manual at the touchdown frame", () => {
    const { s, inp } = setup();
    toRail(s);
    run(s, inp, [key("KeyF", true, T(40))], 170);
    const land = ofType(s, "land")[0];
    const ms = ofType(s, "manual-start")[0];
    expect(ms).toBeDefined();
    expect(ms.link).toBe(true);
    expect(ms.frame).toBe(land.frame);
  });
  it("F pressed in the air with no rail: no manual on landing; a new press of 0.2 s starts one", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyF", true, T(20))], 90);
    expect(ofType(s, "manual-start")).toHaveLength(0);
    run(s, inp, [key("KeyF", false, T(91)), key("KeyF", true, T(93))], 20);
    expect(ofType(s, "manual-start")).toHaveLength(1);
  });
  it("manualFriction 0 and a balanced manual: one link of 490 at 30 m, the bank 0.8 s after the cap", () => {
    const s = createSim({ beat: false, k: { ...TRICK, manualFriction: 0, manualDrift: 0, manualGravity: 0 } });
    const inp = createInput();
    place(s, { x: -30, z: 10, yaw: 0, speed: 8 });
    run(s, inp, [key("KeyF", true, T(1))], 300);
    const links = ofType(s, "link");
    expect(links).toHaveLength(1);
    expect(links[0].earned).toBe(490);
    const bank = ofType(s, "bank")[0];
    expect(bank.t - links[0].t).toBeCloseTo(0.8, 1);
  });
  it("a manual onto the kicker: the manual link at the launch, then the air", () => {
    const { s, inp } = setup();
    place(s, { x: -2, z: 0, yaw: 0, speed: 8 });
    run(s, inp, [key("KeyF", true, T(1)), key("KeyF", false, T(80))], 90);
    expect(ofType(s, "manual-end")[0].reason).toBe("launch");
    expect(ofType(s, "launch")).toHaveLength(1);
    expect(ofType(s, "link")[0].name).toBe("Manual");
  });
});

describe("touch (R11)", () => {
  it("a 24 px flick right on TRICK in the air: the Side Grab in that frame", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [{ kind: "touchDown", id: 1, button: "trick", x: 300, y: 300, t: T(20) }, { kind: "touchMove", id: 1, x: 324, y: 300, t: T(22) }], 22);
    expect(tricks(s)[0]).toMatchObject({ id: "side", frame: 22 });
  });
  it("a lift at 50 ms with under 24 px: the Mute Grab", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [{ kind: "touchDown", id: 1, button: "trick", x: 300, y: 300, t: T(20) }, { kind: "touchMove", id: 1, x: 310, y: 300, t: T(21) }, { kind: "touchUp", id: 1, t: T(23) }], 24);
    expect(tricks(s)[0]).toMatchObject({ id: "mute", frame: 23 });
  });
  it("120 ms with no drag: the Mute Grab at the 120 ms frame", () => {
    const { s, inp } = setup();
    rampAir(s);
    run(s, inp, [{ kind: "touchDown", id: 1, button: "trick", x: 300, y: 300, t: T(20) }], 30);
    expect(tricks(s)[0]).toMatchObject({ id: "mute", frame: 20 + 8 }); // 120 ms = 7.2 frames -> frame 28
  });
  it("GRIND: the press reaches the sim at the touch-down; a 24 px up flick after the snap changes the stance to Makio once", () => {
    const { s, inp } = setup();
    toRail(s);
    const frames = [];
    run(s, inp, [{ kind: "touchDown", id: 2, button: "grind", x: 500, y: 300, t: T(46) }], 47, (sim, f) => frames.push(f.grind));
    expect(frames[45]).toBe(true); // frame 46
    expect(s.mode).toBe("grind");
    expect(s.grind.dir).toBe("n");
    run(s, inp, [{ kind: "touchMove", id: 2, x: 500, y: 276, t: T(49) }, { kind: "touchMove", id: 2, x: 530, y: 276, t: T(50) }], 5);
    expect(s.grind.dir).toBe("u");
    expect(ofType(s, "stance-change")).toHaveLength(1);
    expect(ofType(s, "stance-change")[0].frame).toBe(49);
  });
  it("GRIND held away from a rail with a 30 px up flick 50 ms after the touch-down: Toe Roll", () => {
    const { s, inp } = setup();
    rolling(s, 6);
    run(s, inp, [{ kind: "touchDown", id: 2, button: "grind", x: 500, y: 300, t: T(1) }, { kind: "touchMove", id: 2, x: 500, y: 270, t: T(1) + 0.05 }], 20);
    expect(s.mode).toBe("manual");
    expect(s.manual.toe).toBe(true);
  });
});

describe("gamepad disconnect", () => {
  it("a controller that disconnects with the stick left and GRIND held stops the steer and the hold", () => {
    const inp = createInput();
    const buttons = Array.from({ length: 16 }, (_, i) => (i === 7 ? 1 : 0));
    padSample(inp, [-0.9, 0], buttons, 1);
    expect(frameInput(inp, 1)).toMatchObject({ steer: -0.9, grind: true });
    padDisconnect(inp, 1.1);
    const f = frameInput(inp, 1.1);
    expect(f).toMatchObject({ steer: 0, grind: false, dir: "n" });
    expect(inp.padState).toBeNull();
  });
});

describe("one device, one trick", () => {
  it("left on the keyboard, a simulated gamepad, and touch gives the same grab", () => {
    const ids = [];
    let { s, inp } = setup();
    rampAir(s);
    run(s, inp, [key("KeyA", true, T(16)), key("KeyQ", true, T(18))], 18);
    ids.push(s.trick.id);
    ({ s, inp } = setup());
    rampAir(s);
    const pad = (ax, ay, btn, t) => ({ kind: "pad", axes: [ax, ay], buttons: Array.from({ length: 16 }, (_, i) => (i === btn ? 1 : 0)), t });
    run(s, inp, [pad(-0.8, 0, -1, T(16)), pad(-0.8, 0, 3, T(18))], 18);
    ids.push(s.trick.id);
    ({ s, inp } = setup());
    rampAir(s);
    run(s, inp, [{ kind: "touchDown", id: 1, button: "trick", x: 300, y: 300, t: T(17) }, { kind: "touchMove", id: 1, x: 270, y: 300, t: T(18) }], 18);
    ids.push(s.trick.id);
    expect(ids).toEqual(["japan", "japan", "japan"]);
  });
  it("the gamepad stick up 0.64 in a manual moves the lean down, and X does not push", () => {
    const { s, inp } = setup();
    rolling(s, 6);
    const btn = (on) => Array.from({ length: 16 }, (_, i) => (on.includes(i) ? 1 : 0));
    run(s, inp, [{ kind: "pad", axes: [0, 0], buttons: btn([7]), t: T(1) }], 12);
    expect(s.mode).toBe("manual");
    s.manual.m = 0.9;
    s.manual.side = 1;
    const v = s.speed;
    run(s, inp, [{ kind: "pad", axes: [0, -0.64], buttons: btn([7, 2]), t: T(13) }], 1);
    expect(s.manual.m).toBeLessThan(0.9);
    expect(s.speed).toBeLessThanOrEqual(v);
  });
});

describe("one-button mode (R12.1)", () => {
  it("a TRICK press with a rail in range snaps", () => {
    const s = createSim({ beat: false, oneButton: true });
    const inp = createInput();
    toRail(s);
    run(s, inp, [key("KeyQ", true, T(46))], 48);
    expect(s.mode).toBe("grind");
  });
  it("a tap on the ground starts the next dance at the release; a 0.5 s hold starts a manual and no dance", () => {
    let s = createSim({ beat: false, oneButton: true });
    let inp = createInput();
    rolling(s);
    run(s, inp, [...tap("KeyQ", T(2), 0.2)], 20);
    expect(tricks(s)[0]).toMatchObject({ kind: "dance", name: "Bankhead Bounce", frame: 14 });
    s = createSim({ beat: false, oneButton: true });
    inp = createInput();
    rolling(s);
    run(s, inp, [key("KeyQ", true, T(2))], 40);
    expect(s.mode).toBe("manual");
    expect(tricks(s).filter((e) => e.kind === "dance")).toHaveLength(0);
  });
  it("3 airs with TRICK held at each touchdown: Mute, Japan, Side, all clean; the 6th is Mute again", () => {
    const s = createSim({ beat: false, oneButton: true });
    const inp = createInput();
    for (let i = 0; i < 6; i++) {
      rampAir(s);
      const t0 = s.t;
      run(s, inp, [key("KeyQ", true, t0 + T(20)), key("KeyQ", false, t0 + T(75))], 80);
    }
    const grabs = tricks(s).map((e) => e.name);
    expect(grabs).toEqual(["Mute Grab", "Japan Grab", "Side Grab", "Rocket Grab", "Tuck Knee", "Mute Grab"]);
    expect(ofType(s, "land").every((e) => e.result === "clean")).toBe(true);
  });
  it("11 taps on the ground: the 10 Nia slots in order, then Bankhead Bounce", () => {
    const s = createSim({ beat: false, oneButton: true });
    const inp = createInput();
    const names = [];
    for (let i = 0; i < 11; i++) {
      rolling(s, 6);
      const t0 = s.t;
      run(s, inp, [...tap("KeyQ", t0 + T(1), 0.1)], 12);
      names.push(s.trick.name);
      s.dance = null;
    }
    expect(names).toEqual(["Bankhead Bounce", "Walk It Out", "The Prep", "Swag Surf", "Snap Lean", "Cross Step", "Toe Spin", "Smooth Quad", "ATL Rydin", "Sit Spin", "Bankhead Bounce"]);
  });
});

describe("rebind (R12.2)", () => {
  it("refuses a second action on one key", () => {
    const inp = createInput();
    expect(rebind(inp, "grind", "KeyG").ok).toBe(true);
    expect(rebind(inp, "jump", "KeyG").ok).toBe(false);
    expect(inp.keys.grind).toEqual(["KeyG"]);
    expect(inp.keys.jump).toEqual(["Space"]);
  });
});

describe("playtest toggles", () => {
  it("carve guard: D held from 8 frames before Q gives the neutral grab; off, it gives Side Grab", () => {
    for (const [carveGuard, id] of [[0.1, "mute"], [null, "side"]]) {
      const s = createSim({ beat: false, k: { ...TRICK, carveGuard } });
      const inp = createInput({ k: { ...TRICK, carveGuard } });
      rampAir(s);
      run(s, inp, [key("KeyD", true, T(10)), key("KeyQ", true, T(18))], 24);
      expect(s.air.grab.id).toBe(id);
    }
  });
  it("short flick: an 18 px drag is a flick at 16 px and a tap-timeout at 24 px", () => {
    for (const [flickMin, id] of [[16, "side"], [24, "mute"]]) {
      const kk = { ...TRICK, flickMin };
      const s = createSim({ beat: false, k: kk });
      const inp = createInput({ k: kk });
      rampAir(s);
      run(s, inp, [{ kind: "touchDown", id: 1, button: "trick", x: 300, y: 300, t: T(20) }, { kind: "touchMove", id: 1, x: 318, y: 300, t: T(21) }], 30);
      expect(s.air.grab.id).toBe(id);
    }
  });
});
