import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ANIM, CLIPS, clipNamesFor, DANCE_CLIPS, GRAB_CLIPS, GRIND_CLIPS, MANUAL_CLIPS, beatLength, landingResult, beatPhase, clipFor, createAnimState, facingFor, grooveRate, measureYawRate, respawnAnim, stepAnim, stepFacing } from "./skater-anim.js";
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
    expect(clipFor(air({ airFrom: "fall" }))).toBe("bail");
    expect(clipFor({ ...rolling(), state: "grind" })).toBe("grind_frontside");
    expect(clipFor(rolling({ style: { id: "groove", clip: "dance_walkitout" } }))).toBe("dance_walkitout");
    expect(clipFor(rolling({ style: { id: "spin", clip: "dance_sitspin" } }))).toBe("dance_sitspin");
    expect(clipFor(rolling({ style: { id: "groove", clip: "no_such_clip" } }))).toBe(DANCE_CLIPS[0]);
  });
});

// The trick input (#329, docs/gdd/trick-input.md): the sim picks the trick
// in state.trick (#327); the renderer plays state.trick.clip.
const trick = (kind, clip) => ({ kind, id: clip, name: clip, clip, dir: "n", held: true });

describe("the trick clips (state.trick.clip)", () => {
  it("plays the grab of state.trick in the air", () => {
    for (const clip of GRAB_CLIPS) {
      expect(clipFor(air({ airFrom: "ramp", airTime: 0.5, trick: trick("grab", clip) }))).toBe(clip);
      expect(clipFor(air({ airFrom: "jump", airTime: 0.1, trick: trick("grab", clip) }))).toBe(clip);
    }
  });

  it("plays jump for a ramp air with no grab, at any air time", () => {
    for (const airTime of [0.1, 0.25, 0.5, 2]) expect(clipFor(air({ airFrom: "ramp", airTime }))).toBe("jump");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5, trick: null }))).toBe("jump");
  });

  it("plays the stance of state.trick on a rail, and the edge grind with none", () => {
    for (const clip of GRIND_CLIPS) expect(clipFor({ ...rolling(), state: "grind", trick: trick("grind", clip) })).toBe(clip);
    expect(clipFor({ ...rolling(), state: "grind", trick: null })).toBe("grind_frontside");
  });

  it("plays the manual or the toe roll of state.trick", () => {
    expect(clipFor(rolling({ manual: { balance: 0, meters: 0 } }))).toBe("manual");
    for (const clip of MANUAL_CLIPS) expect(clipFor(rolling({ manual: { balance: 0, meters: 0 }, trick: trick("manual", clip) }))).toBe(clip);
  });

  it("plays a clip of state.trick only in the group of the state", () => {
    // A grab clip on a rail, a grind clip in the air, and an unknown clip fall back.
    expect(clipFor({ ...rolling(), state: "grind", trick: trick("grab", "air_rocket") })).toBe("grind_frontside");
    expect(clipFor(air({ trick: trick("grind", "grind_makio") }))).toBe("jump");
    expect(clipFor(air({ trick: trick("grab", "air_no_such") }))).toBe("jump");
    expect(clipFor(rolling({ manual: { balance: 0 }, trick: trick("grab", "air_mute") }))).toBe("manual");
    // On the ground with no manual, a trick left in the state does not change the clip.
    expect(clipFor(rolling({ trick: trick("grab", "air_mute") }))).toBe("coast");
    // A fall is a bail, with or without a grab.
    expect(clipFor(air({ airFrom: "fall", trick: trick("grab", "air_mute") }))).toBe("bail");
  });

  it("changes the grab when the sim changes state.trick, with the trick fade", () => {
    const states = [rolling(), air({ airFrom: "ramp" }), air({ airFrom: "ramp", trick: trick("grab", "air_rocket") }), air({ airFrom: "ramp", trick: trick("grab", "air_tuckknee") })];
    const { changes } = run(states);
    expect(changes.map((c) => c.to)).toEqual(["coast", "jump", "air_rocket", "air_tuckknee"]);
    expect(changes[2].fade).toBe(0.15); // jump -> trick
    expect(changes[3].fade).toBe(0.15); // trick -> trick
  });

  it("lands with land, or with land_stumble when the sim reports a stumble", () => {
    const grab = Array.from({ length: 20 }, () => air({ airFrom: "ramp", trick: trick("grab", "air_rocket") }));
    const clean = run([rolling(), ...grab, rolling({ landing: "clean" })]);
    expect(clean.changes.map((c) => c.to)).toEqual(["coast", "air_rocket", "land"]);
    const stumble = run([rolling(), ...grab, rolling({ landing: "stumble" })]);
    expect(stumble.changes.map((c) => c.to)).toEqual(["coast", "air_rocket", "land_stumble"]);
    expect(stumble.changes.at(-1).fade).toBe(0.05); // the impact reads at once, as land
    const asObject = run([rolling(), ...grab, rolling({ landing: { result: "stumble" } })]);
    expect(asObject.anim.clip).toBe("land_stumble");
    // No landing result: a clean land.
    expect(run([rolling(), ...grab, rolling()]).anim.clip).toBe("land");
  });

  it("plays land_stumble once when a manual ends in a stumble (R8, R10)", () => {
    for (const clip of MANUAL_CLIPS) {
      const manual = Array.from({ length: 20 }, () => rolling({ manual: { balance: 0.9 }, trick: trick("manual", clip) }));
      const out = run([rolling(), ...manual, ...Array.from({ length: 10 }, () => rolling({ landing: "stumble" }))]);
      expect(out.changes.map((c) => c.to)).toEqual(["coast", clip, "land_stumble"]);
      // The landing result stays in the state: the clip does not start again.
      const long = run([rolling(), ...manual, ...Array.from({ length: 120 }, () => rolling({ landing: "stumble" }))]);
      expect(long.changes.map((c) => c.to)).toEqual(["coast", clip, "land_stumble", "coast"]);
    }
    // An old "stumble" from an air landing does not play on a clean manual exit.
    const grab = Array.from({ length: 20 }, () => air({ airFrom: "ramp", trick: trick("grab", "air_mute") }));
    const stale = Array.from({ length: 60 }, () => rolling({ landing: "stumble" }));
    const manualStale = Array.from({ length: 20 }, () => rolling({ landing: "stumble", manual: { balance: 0 }, trick: trick("manual", "manual") }));
    const exit = run([rolling(), ...grab, ...stale, ...manualStale, rolling({ landing: "stumble" })]);
    expect(exit.changes.map((c) => c.to)).toEqual(["coast", "air_mute", "land_stumble", "coast", "manual", "coast"]);
    // A new landing object on the exit frame plays it.
    const fresh = run([rolling(), ...manualStale, rolling({ landing: { result: "stumble" } })]);
    expect(fresh.anim.clip).toBe("land_stumble");
    // A manual that ends with no stumble rolls on.
    const clean = run([rolling(), ...Array.from({ length: 20 }, () => rolling({ manual: { balance: 0 } })), rolling()]);
    expect(clean.anim.clip).toBe("coast");
  });

  it("holds land_stumble for its lock, then rolls on", () => {
    const grab = Array.from({ length: 20 }, () => air({ airFrom: "ramp", trick: trick("grab", "air_mute") }));
    const after = (n) => run([rolling(), ...grab, rolling({ landing: "stumble" }), ...Array.from({ length: n }, () => rolling())]).anim.clip;
    expect(after(Math.floor(CLIPS.land_stumble.lock * 60) - 2)).toBe("land_stumble");
    expect(after(Math.ceil(CLIPS.land_stumble.lock * 60) + 2)).toBe("coast");
    expect(CLIPS.land_stumble.lock).toBeGreaterThan(CLIPS.land.lock);
  });

  it("reads the landing result as a string or as { result }", () => {
    expect(landingResult({})).toBe(null);
    expect(landingResult({ landing: "stumble" })).toBe("stumble");
    expect(landingResult({ landing: { result: "perfect" } })).toBe("perfect");
    expect(landingResult({ landing: null })).toBe(null);
  });

  it("keeps the toe roll facing forward in the backward ride", () => {
    expect(facingFor("manual_toe", { backward: true })).toBe(0);
    expect(facingFor("coast", { backward: true })).toBe(Math.PI);
  });

  it("has no variant counters (the sim picks the trick)", () => {
    const a = createAnimState();
    for (const k of ["airVariant", "grindVariant", "wasAirTrick", "wasGrind"]) expect(a).not.toHaveProperty(k);
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

  it("does not cycle the air tricks or the grind stances, and changes the dances", () => {
    // Before #329 the renderer cycled the grabs and the stances. Now an air
    // with no trick is always jump, and a rail with no stance is always the edge grind.
    const ramp = Array.from({ length: 30 }, (_, i) => air({ airFrom: "ramp", airTime: i / 60 }));
    const land = Array.from({ length: 5 }, () => rolling());
    const airs = run([...ramp, ...land, ...ramp, ...land, ...ramp]).changes.map((c) => c.to).filter((n) => n.startsWith("air") || n === "jump");
    expect(airs).toEqual(["jump", "jump", "jump"]);

    const rail = Array.from({ length: 10 }, () => ({ ...rolling(), state: "grind" }));
    const off = Array.from({ length: 30 }, () => rolling());
    const grinds = run([...rail, ...off, ...rail, ...off, ...rail]).changes.map((c) => c.to).filter((n) => n.startsWith("grind"));
    expect(grinds).toEqual(["grind_frontside", "grind_frontside", "grind_frontside"]);

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
