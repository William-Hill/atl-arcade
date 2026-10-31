import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLIPS, STYLE_CLIPS, clipFor, createAnimState, stepAnim } from "./skater-anim.js";
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
  });

  it("maps the air, grind, bail, and style states", () => {
    expect(clipFor(air())).toBe("jump");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.1 }))).toBe("jump");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5 }))).toBe("air_trick_1");
    expect(clipFor(air({ airFrom: "ramp", airTime: 0.5 }), { airVariant: 1 })).toBe("air_trick_2");
    expect(clipFor(air({ airFrom: "fall" }))).toBe("bail");
    expect(clipFor({ ...rolling(), state: "grind" })).toBe("grind");
    expect(clipFor(rolling({ style: { id: "shuffle" } }))).toBe("dance_1");
    expect(clipFor(rolling({ style: { id: "spin" } }), { styleVariant: 1 })).toBe("dance_4");
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
    expect(anim.clip).toBe("bail");
    const later = run([...states, ...Array.from({ length: 60 }, () => rolling())]);
    expect(later.anim.clip).toBe("coast");
  });

  it("alternates the air tricks and the dances", () => {
    const trick = Array.from({ length: 30 }, (_, i) => air({ airFrom: "ramp", airTime: i / 60 }));
    const land = Array.from({ length: 5 }, () => rolling());
    const tricks = run([...trick, ...land, ...trick]).changes.map((c) => c.to).filter((n) => n.startsWith("air"));
    expect(tricks).toEqual(["air_trick_1", "air_trick_2"]);

    const dance = Array.from({ length: 10 }, () => rolling({ style: { id: "shuffle" } }));
    const dances = run([...dance, ...land, ...dance]).changes.map((c) => c.to).filter((n) => n.startsWith("dance"));
    expect(dances).toEqual(["dance_1", "dance_3"]);
  });

  it("uses a short fade into a bail and a jump", () => {
    const { changes } = run([rolling(), air(), air({ airFrom: "fall" })]);
    expect(changes.find((c) => c.to === "jump").fade).toBeLessThan(0.1);
    expect(changes.find((c) => c.to === "bail").fade).toBeLessThan(0.1);
  });
});
