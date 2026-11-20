import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ANIM, AIR_TRICKS, CLIPS, clipNamesFor, GRINDS, DANCE_CLIPS, beatLength, beatPhase, clipFor, createAnimState, facingFor, grooveRate, measureYawRate, respawnAnim, stepAnim, stepFacing } from "./skater-anim.js";
import { SKATE, STYLE } from "../sim/skate/constants.js";
import { createSkateState, runScript, stepSkate } from "../sim/skate/controller.js";

const rolling = (extra = {}) => ({ state: "rolling", speed: 5, yaw: 0, pushCooldown: 0, style: null, ...extra });
const air = (extra = {}) => ({ state: "air", speed: 5, yaw: 0, airTime: 0.1, airFrom: "jump", style: null, ...extra });

function run(states, dt = 1 / 60) {
  let anim = createAnimState();
  const changes = [];
  for (const s of states) {
    const r = stepAnim(anim, s, dt);
    anim = r.anim;
    if (r.change) changes.push(r.change);
  }
  return { anim, changes };
}

describe("the state -> clip table", () => {
  it("covers every clip in each skater GLB", () => {
    for (const skater of ["nia", "marcus"]) {
      for (const file of ["skater.glb", "skater-1024.glb"]) {
        const buf = readFileSync(new URL(`../../assets/skaters/${skater}/${file}`, import.meta.url));
        const json = JSON.parse(buf.toString("utf8", 20, 20 + buf.readUInt32LE(12)));
        const names = json.animations.map((a) => a.name).sort();
        expect(names, `${skater}/${file}`).toEqual(clipNamesFor(skater).sort());
      }
    }
    expect(clipNamesFor("marcus").length).toBe(clipNamesFor("nia").length + 3);
  });

  it("has a clip for every dance of every style move", () => {
    for (const m of STYLE.moves) for (const d of m.dances) expect(CLIPS[d.clip]?.tempo).toBe(true);
    expect(DANCE_CLIPS).toContain("dance_bankhead");
    expect(DANCE_CLIPS).toContain("dance_walkitout");
  });

  it("maps the rolling states", () => {
    expect(clipFor(rolling({ speed: 0 }))).toBe("idle");
    expect(clipFor(rolling())).toBe("coast");
    expect(clipFor(rolling({ pushing: true }))).toBe("push");
    expect(clipFor(rolling({ pushCooldown: 0.3 }))).toBe("coast");
    expect(clipFor(rolling(), { yawRate: 1.5 })).toBe("carve_left");
    expect(clipFor(rolling(), { yawRate: -1.5 })).toBe("carve_right");
    expect(clipFor(rolling({ manual: true }))).toBe("manual");
    expect(clipFor(rolling({ backward: true }))).toBe("ride_back");
    expect(clipFor(rolling({ backward: true, pushing: true }))).toBe("ride_back");
    expect(clipFor(rolling({ backward: true, speed: 0 }))).toBe("idle");
    expect(clipFor({ ...rolling({ backward: true }), state: "grind" })).toBe("grind_frontside");
  });

  it("brakes on the brake button or a hard slow-down, forward only", () => {
    expect(clipFor(rolling({ braking: true }))).toBe("brake");
    expect(clipFor(rolling({ braking: true, pushing: true }))).toBe("brake");
    expect(clipFor(rolling({ braking: true, speed: 0.1 }))).toBe("idle");
    expect(clipFor(rolling({ braking: true, backward: true }))).toBe("ride_back");
    expect(clipFor(rolling(), { slowing: ANIM.brakeHold })).toBe("brake");
    expect(clipFor(rolling(), { slowing: 0 })).toBe("coast");
    // The roll friction and drag at the top speed do not count as a brake.
    const drag = SKATE.coastDecel + SKATE.coastDrag * SKATE.maxSpeed ** 2;
    expect(drag).toBeLessThan(ANIM.brakeDecel);
  });

  it("brakes on a hard slow-down that lasts, not on a one-tick drop", () => {
    const at = (speed, tick) => rolling({ speed, tick });
    // A one-tick drop of 1 m/s (60 m/s^2), then a steady speed: no brake.
    const drop = run([at(4, 1), at(4, 2), at(3, 3), at(3, 4), at(3, 5), at(3, 6), at(3, 7), at(3, 8), at(3, 9)]);
    expect(drop.changes.map((c) => c.to)).not.toContain("brake");
    // 8 m/s^2 for 12 ticks (0.2 s): the brake starts after 0.1 s.
    const hard = run(Array.from({ length: 14 }, (_, i) => at(8 - (8 / 60) * i, i + 1)));
    expect(hard.changes.map((c) => c.to)).toContain("brake");
  });

  it("plays the brake while the controller brakes, and holds it for its lock", () => {
    const fast = runScript(createSkateState(), [{ frames: 120, input: { push: true } }]).state;
    const { states } = runScript(fast, [{ frames: 20, input: {} }, { frames: 30, input: { brake: true } }, { frames: 20, input: {} }, { frames: 3, input: { brake: true } }, { frames: 6, input: {} }], { trace: true });
    expect(states[30].braking).toBe(true);
    let anim = createAnimState();
    const clips = [];
    for (const st of states) {
      anim = stepAnim(anim, st, 1 / 60).anim;
      clips.push(anim.clip);
    }
    expect(clips[19]).toBe("coast");
    expect(clips[25]).toBe("brake");
    expect(clips[69]).toBe("coast");
    // A short tap: six frames after the release, the 0.25 s lock still holds the brake.
    expect(clips.at(-1)).toBe("brake");
  });

  it("goes from push to coast in one tick when the player releases push at speed (#61)", () => {
    // Release in the middle of a stroke, so pushCooldown is still above 0.
    const frames = 90 + Math.round(SKATE.pushCooldown / 2 / (1 / 60));
    const held = runScript(createSkateState(), [{ frames, input: { push: true } }]).state;
    expect(held.speed).toBeGreaterThan(5);
    expect(clipFor(held)).toBe("push");
    const released = stepSkate(held, {}, 1 / 60);
    expect(released.pushCooldown).toBeGreaterThan(0);
    expect(clipFor(released)).toBe("coast");
  });

  it("maps the air, grind, bail, and style states", () => {
    expect(clipFor(air())).toBe("jump");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.1 }))).toBe("jump");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5 }))).toBe("air_mute");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5 }), { airVariant: 1 })).toBe("air_japan");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5 }), { airVariant: 2 })).toBe("air_liukang");
    expect(clipFor(air({ airFrom: "fall" }))).toBe("bail");
    expect(clipFor({ ...rolling(), state: "grind" })).toBe("grind_frontside");
    expect(clipFor({ ...rolling(), state: "grind" }, { grindVariant: 2 })).toBe("grind_unity");
    expect(clipFor(rolling({ style: { id: "groove", clip: "dance_walkitout" } }))).toBe("dance_walkitout");
    expect(clipFor(rolling({ style: { id: "spin", clip: "dance_sitspin" } }))).toBe("dance_sitspin");
    expect(clipFor(rolling({ style: { id: "groove", clip: "no_such_clip" } }))).toBe(DANCE_CLIPS[0]);
  });
});

describe("transitions", () => {
  it("crossfades from coast to carve and back", () => {
    let yaw = 0;
    const states = [];
    for (let i = 0; i < 10; i += 1) states.push(rolling({ yaw }));
    for (let i = 0; i < 30; i += 1) states.push(rolling({ yaw: (yaw += 0.04) }));
    for (let i = 0; i < 10; i += 1) states.push(rolling({ yaw }));
    const { changes } = run(states);
    expect(changes.map((c) => c.to)).toEqual(["coast", "carve_left", "coast"]);
    for (const c of changes) expect(c.fade).toBeGreaterThan(0);
  });

  it("holds the bail after the skater lands", () => {
    const states = [rolling(), air({ airFrom: "fall" }), ...Array.from({ length: 20 }, () => rolling())];
    const { anim, changes } = run(states);
    expect(changes.map((c) => c.to)).toEqual(["coast", "bail"]);
    expect(changes.map((c) => c.to)).not.toContain("land");
    expect(anim.clip).toBe("bail");
    const later = run([...states, ...Array.from({ length: 60 }, () => rolling())]);
    expect(later.anim.clip).toBe("coast");
  });

  it("alternates the air tricks and the dances", () => {
    const trick = Array.from({ length: 30 }, (_, i) => air({ airFrom: "ramp", airTime: i / 60 }));
    const land = Array.from({ length: 5 }, () => rolling());
    const tricks = run([...trick, ...land, ...trick, ...land, ...trick, ...land, ...trick]).changes.map((c) => c.to).filter((n) => n.startsWith("air"));
    expect(tricks).toEqual([...AIR_TRICKS, AIR_TRICKS[0]]);

    const rail = Array.from({ length: 10 }, () => ({ ...rolling(), state: "grind" }));
    const off = Array.from({ length: 30 }, () => rolling());
    const grinds = run([...rail, ...off, ...rail, ...off, ...rail]).changes.map((c) => c.to).filter((n) => n.startsWith("grind"));
    expect(grinds).toEqual(GRINDS);

    const dance = (clip) => Array.from({ length: 10 }, () => rolling({ style: { id: "groove", clip } }));
    const dances = run([...dance("dance_bankhead"), ...land, ...dance("dance_walkitout")]).changes.map((c) => c.to).filter((n) => n.startsWith("dance"));
    expect(dances).toEqual(["dance_bankhead", "dance_walkitout"]);
  });

  it("uses a short fade into a bail and a jump", () => {
    const { changes } = run([rolling(), air(), air({ airFrom: "fall" })]);
    expect(changes.find((c) => c.to === "jump").fade).toBeLessThan(0.1);
    expect(changes.find((c) => c.to === "bail").fade).toBeLessThan(0.1);
  });
});

describe("ATL rhythm and the backward ride", () => {
  it("plays every groove clip in phase with the game beat", () => {
    // The clips are keyed at 0.8 s per beat. The game click is 100 BPM (0.6 s).
    expect(beatLength(100)).toBeCloseTo(0.6);
    expect(grooveRate(100)).toBeCloseTo(4 / 3);
    expect(grooveRate(75)).toBeCloseTo(1);
    // Beat 3 of the game clock is clip beat 3: 2.4 s into a 3.2 s clip.
    expect(beatPhase(3 * 0.6, 3.2, 100)).toBeCloseTo(2.4);
    expect(beatPhase(-0.6, 1.6, 100)).toBeCloseTo(0.8);
    for (const [name, c] of Object.entries(CLIPS)) if (c.beat) expect(c.once, name).toBeFalsy();
  });

  it("rides backward while the switch is on, and faces forward in the air", () => {
    const back = Array.from({ length: 10 }, () => rolling({ backward: true }));
    const { anim, changes } = run([rolling(), ...back]);
    expect(changes.map((c) => c.to)).toEqual(["coast", "ride_back"]);
    expect(anim.facing).toBeCloseTo(Math.PI);
    expect(facingFor("idle", { backward: true })).toBeCloseTo(Math.PI);
    expect(facingFor("jump", { backward: true })).toBe(0);
    expect(facingFor("grind_soul", { backward: true })).toBe(0);
    expect(facingFor("coast", {})).toBe(0);
  });

  it("turns the facing at a fixed rate", () => {
    let f = 0;
    const steps = Math.ceil(ANIM.turnTime * 60);
    for (let i = 0; i < steps - 2; i += 1) f = stepFacing(f, Math.PI, 1 / 60);
    expect(f).toBeLessThan(Math.PI);
    for (let i = 0; i < 4; i += 1) f = stepFacing(f, Math.PI, 1 / 60);
    expect(f).toBe(Math.PI);
  });

  it("lands from a jump with the land clip, then rides", () => {
    const states = [rolling(), ...Array.from({ length: 20 }, () => air()), ...Array.from({ length: 40 }, () => rolling())];
    expect(run(states).changes.map((c) => c.to)).toEqual(["coast", "jump", "land", "coast"]);
  });
});

describe("the yaw rate per simulation tick", () => {
  // A steady left carve: 1.5 rad/s, one tick every 1/60 s.
  const carve = (tick) => rolling({ tick, yaw: tick * (1.5 / 60) });

  it("keeps the carve clip at 120 Hz, when half the frames have no tick", () => {
    const frames = [];
    for (let t = 1; t <= 60; t += 1) frames.push(carve(t), carve(t)); // two render frames per tick
    const { changes } = run(frames, 1 / 120);
    // The first frame has no rate yet (coast); after that the carve holds,
    // with no switch back to coast on the frames without a tick.
    expect(changes.map((c) => c.to)).toEqual(["coast", "carve_left"]);
  });

  it("measures the rate over the ticks, not the frame time", () => {
    const a = { ...createAnimState(), prevYaw: carve(10).yaw, prevTick: 10, yawRate: 0 };
    expect(measureYawRate(a, carve(12), 1 / 240)).toBeCloseTo(1.5, 6);
    expect(measureYawRate({ ...a, yawRate: 1.5 }, carve(10), 1 / 240)).toBe(1.5);
    expect(measureYawRate(a, carve(3), 1 / 60)).toBe(0); // a reset
  });
});

describe("respawnAnim (#231)", () => {
  it("starts on the clip and facing of the new state, with no turn from the old yaw", () => {
    const a = respawnAnim({ state: "rolling", speed: 0, yaw: 1.464, tick: 0, style: null });
    expect(a.clip).toBe("idle");
    expect(a.facing).toBe(0);
    expect(a.prevYaw).toBe(1.464);
    const r = stepAnim(a, { state: "rolling", speed: 0, yaw: 1.464, tick: 1, style: null }, 1 / 60);
    expect(r.change).toBeNull();
    expect(r.anim.yawRate).toBe(0);
  });

  it("takes the facing from the new state, not from the old run", () => {
    expect(respawnAnim({ state: "rolling", speed: 0, yaw: 0, tick: 0, backward: false, style: null }).facing).toBe(0);
    expect(respawnAnim({ state: "rolling", speed: 0, yaw: 0, tick: 0, backward: true, style: null }).facing).toBeCloseTo(Math.PI);
  });
});
