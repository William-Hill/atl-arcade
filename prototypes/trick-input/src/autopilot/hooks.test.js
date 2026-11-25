import { describe, expect, it } from "vitest";
import { DEFAULT_KEYS } from "../input.js";
import { controlsFromKeys, createTrickHooks, playerFromSim, steerToward } from "./hooks.js";
import { createSim, place } from "../sim.js";
import { createInput, keyDown, keyUp, frameInput } from "../input.js";
import { stepSim } from "../sim.js";
import { DT } from "../constants.js";

describe("Autopilot hooks for the trick input prototype", () => {
  it("gives the skater's feet and half height, with the heading (cos yaw, sin yaw)", () => {
    const p = playerFromSim({ x: 1, y: 0, z: 2, yaw: 0, speed: 5, mode: "ground" });
    expect(p.position).toEqual([1, 0, 2]);
    expect(p.halfHeight).toBe(0.9);
    expect(p.forward).toEqual([1, 0, 0]);
    expect(p.velocity).toEqual([5, 0, 0]);
    expect(p.onGround).toBe(true);
  });
  it("steers right (D) to turn toward +z from a +x heading, left toward -z, none when on line", () => {
    expect(steerToward(0, [0, 0, 1])).toBe("right");
    expect(steerToward(0, [0, 0, -1])).toBe("left");
    expect(steerToward(0, [1, 0, 0.01])).toBeNull();
  });
  it("lists the actions with their keys, the direction actions on the steer keys", () => {
    const c = controlsFromKeys(DEFAULT_KEYS);
    expect(c.find((a) => a.name === "dirLeft").keys).toEqual(["KeyA", "ArrowLeft"]);
    expect(c.find((a) => a.name === "style1").keys).toEqual(["KeyQ"]);
  });
  it("move: holds push and steers on the sim until the heading matches, then lets go of all keys", async () => {
    const sim = createSim({ beat: false });
    place(sim, { x: 0, z: 8, yaw: 0, speed: 3 });
    const inp = createInput();
    const ti = { sim, inp, reset() {}, pause() {}, paused: () => false };
    const keys = {
      hold: (c) => keyDown(inp, c, sim.t),
      release: (c) => keyUp(inp, c, sim.t),
      frame: async () => stepSim(sim, frameInput(inp, Math.round((sim.t + DT) * 1e9) / 1e9)),
    };
    const hooks = createTrickHooks({ ti, intents: {}, now: () => 0 });
    await hooks.move({ direction: [0, 0, 1], seconds: 1, scale: 1, keys });
    expect(Math.abs(Math.sin(sim.yaw) - 1)).toBeLessThan(0.1);
    expect(sim.speed).toBeGreaterThan(3);
    expect(inp.down.size).toBe(0);
  });
  const rig = () => {
    const sim = createSim({ beat: false });
    place(sim, { x: 0, z: 8, yaw: 0, speed: 3 });
    const inp = createInput();
    const ti = { sim, inp, reset() {}, pause() {}, paused: () => false };
    const pressed = [];
    const keys = {
      hold: (c) => (pressed.push(c), keyDown(inp, c, ti.sim.t)),
      release: (c) => keyUp(inp, c, ti.sim.t),
      frame: async () => stepSim(ti.sim, frameInput(inp, Math.round((ti.sim.t + DT) * 1e9) / 1e9)),
    };
    return { ti, inp, keys, pressed };
  };
  it("move with scale 0 presses no key", async () => {
    const { ti, keys, pressed } = rig();
    await createTrickHooks({ ti, intents: {}, now: () => 0 }).move({ direction: [0, 0, 0], seconds: 0.2, scale: 0, keys });
    expect(pressed).toEqual([]);
    expect(ti.sim.t).toBeGreaterThan(0.15);
  });
  it("a reset (a new sim) ends the move and lets go of its keys", async () => {
    const { ti, inp, keys } = rig();
    const frame = keys.frame;
    let n = 0;
    keys.frame = async () => {
      await frame();
      if (++n === 5) {
        ti.sim = createSim({ beat: false });
        place(ti.sim, { x: 0, z: 8, yaw: Math.PI, speed: 0 });
      }
    };
    await createTrickHooks({ ti, intents: {}, now: () => 0 }).move({ direction: [0, 0, 1], seconds: 2, scale: 1, keys });
    expect(n).toBe(5);
    expect(inp.down.size).toBe(0);
  });
  it("reaches only the intent log by name", () => {
    const { ti } = rig();
    const intents = { intend() {}, metrics() {} };
    expect(Object.keys(createTrickHooks({ ti, intents }).objects)).toEqual(["playtest"]);
  });
});
