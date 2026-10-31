import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ANIM, AIR_TRICKS, CLIPS, GRINDS, STYLE_CLIPS, beatLength, beatPhase, clipFor, createAnimState, facingFor, grooveRate, stepAnim, stepFacing } from "./skater-anim.js";
import { STYLE } from "../sim/skate/constants.js";

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
  it("covers every clip in the GLB", () => {
    const buf = readFileSync(new URL("../../assets/skaters/nia/skater.glb", import.meta.url));
    const json = JSON.parse(buf.toString("utf8", 20, 20 + buf.readUInt32LE(12)));
    const names = json.animations.map((a) => a.name).sort();
    expect(names).toEqual(Object.keys(CLIPS).sort());
  });

  it("has two dances for every style move", () => {
    for (const m of STYLE.moves) expect(STYLE_CLIPS[m.id]).toHaveLength(2);
  });

  it("maps the rolling states", () => {
    expect(clipFor(rolling({ speed: 0 }))).toBe("idle");
    expect(clipFor(rolling())).toBe("coast");
    expect(clipFor(rolling({ pushCooldown: 0.3 }))).toBe("push");
    expect(clipFor(rolling(), { yawRate: 1.5 })).toBe("carve_left");
    expect(clipFor(rolling(), { yawRate: -1.5 })).toBe("carve_right");
    expect(clipFor(rolling({ manual: true }))).toBe("manual");
    expect(clipFor(rolling({ backward: true }))).toBe("ride_back");
    expect(clipFor(rolling({ backward: true, pushCooldown: 0.3 }))).toBe("ride_back");
    expect(clipFor(rolling({ backward: true, speed: 0 }))).toBe("idle");
    expect(clipFor({ ...rolling({ backward: true }), state: "grind" })).toBe("grind_frontside");
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
    expect(clipFor(rolling({ style: { id: "shuffle" } }))).toBe("dance_prep");
    expect(clipFor(rolling({ style: { id: "spin" } }), { styleVariant: 1 })).toBe("dance_sitspin");
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

    const dance = Array.from({ length: 10 }, () => rolling({ style: { id: "shuffle" } }));
    const dances = run([...dance, ...land, ...dance]).changes.map((c) => c.to).filter((n) => n.startsWith("dance"));
    expect(dances).toEqual(["dance_prep", "dance_crisscross"]);
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
