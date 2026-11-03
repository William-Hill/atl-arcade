import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createBridge } from "./autopilot-bridge.js";
import { controlsFromBindings, createSkateHooks, movementNumbers, playerFromSkater, steerToward, SKATER_HALF_HEIGHT } from "./hooks.js";
import { createBindings } from "../input/bindings.js";
import { createSkateState } from "../sim/skate/controller.js";
import { SKATE } from "../sim/skate/constants.js";
import { GREYBOX } from "../level/greybox.js";
import { createLevelView } from "../render/level-view.js";

describe("playerFromSkater", () => {
  it("gives the heading times the speed on the ground", () => {
    const s = { ...createSkateState({ position: [1, 0, 2], yaw: 0 }), speed: 6, grind: null };
    const p = playerFromSkater(s);
    expect(p.position).toEqual([1, 0, 2]);
    expect(p.forward[0]).toBeCloseTo(1);
    expect(p.velocity[0]).toBeCloseTo(6);
    expect(p.onGround).toBe(true);
    expect(p.halfHeight).toBe(SKATER_HALF_HEIGHT);
    expect(p.state).toBe("rolling");
  });

  it("gives the simulation velocity in the air and says grinding on a rail", () => {
    const air = { ...createSkateState(), state: "air", velocity: [1, 4, 0], speed: 3, grind: null };
    expect(playerFromSkater(air).velocity).toEqual([1, 4, 0]);
    expect(playerFromSkater(air).onGround).toBe(false);
    const grinding = { ...createSkateState(), grind: { id: "rail-straight" } };
    expect(playerFromSkater(grinding).state).toBe("grinding");
  });
});

describe("controlsFromBindings", () => {
  it("lists each action with its keyboard codes", () => {
    const c = controlsFromBindings(createBindings());
    expect(c.find((a) => a.name === "jump").keys).toEqual(["Space"]);
    expect(c.find((a) => a.name === "push").keys).toContain("KeyW");
    expect(c.map((a) => a.name).sort()).toEqual(["brake", "grind", "jump", "left", "push", "right", "style1", "style2"]);
  });
});

describe("steerToward", () => {
  it("steers left for a target to the left, right for the right, none when it faces the target", () => {
    // Yaw 0 faces +x. Positive yaw turns left, toward -z.
    expect(steerToward(0, [1, 0, 0])).toBe(null);
    expect(steerToward(0, [0, 0, -1])).toBe("left");
    expect(steerToward(0, [0, 0, 1])).toBe("right");
    expect(steerToward(Math.PI / 2, [0, 0, -1])).toBe(null);
    expect(steerToward(0, [0, 0, 0])).toBe(null);
  });
});

describe("movementNumbers", () => {
  it("reads the skate constants", () => {
    const m = movementNumbers();
    expect(m.walkSpeed).toBe(SKATE.maxSpeed);
    expect(m.jumpSpeed).toBe(SKATE.jumpSpeed);
    expect(m.gravity).toBe(SKATE.gravity);
  });
});

// The vendored bridge on a real Three.js scene graph and the real greybox
// level view: paths, classes, and the kit frame.
describe("the bridge on Skate ATL's scene", () => {
  function setup() {
    const scene = new THREE.Scene();
    const levelView = createLevelView(GREYBOX);
    scene.add(levelView.root);
    const skaterObject = new THREE.Group();
    skaterObject.name = "skater";
    scene.add(skaterObject);
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500);
    camera.position.set(-6, 38, 44);
    camera.lookAt(0, 0, 2);
    scene.add(camera);
    scene.updateMatrixWorld(true);
    const skater = { ...createSkateState({ position: GREYBOX.spawn.position, yaw: GREYBOX.spawn.yaw }), grind: null };
    let resets = 0;
    const atl = {
      skater,
      ticks: 120,
      renderPaused: false,
      input: { bindings: createBindings() },
      resetSkater: () => (resets += 1),
    };
    const hooks = createSkateHooks({ atl, level: GREYBOX, skaterObject });
    const keys = [];
    const bridge = createBridge({
      scene,
      camera,
      hooks,
      canvas: null,
      document: null,
      keyTarget: { dispatchEvent: (e) => keys.push(`${e.type}:${e.code}`) },
      global: { navigator: { getGamepads: () => [] } },
      requestFrame: () => {},
    });
    return { bridge, atl, keys, resets: () => resets };
  }

  it("finds the level's rails by their kind, at kit-frame places", async () => {
    const { bridge } = setup();
    const rails = (await bridge.handle("find", { class: "rail" })).objects;
    expect(rails.length).toBe(GREYBOX.objects.filter((o) => o.kind === "rail").length);
    expect(rails.every((p) => p.startsWith(`/Scene/${GREYBOX.name}/rail-`))).toBe(true);
    const things = (await bridge.handle("find", { things: true })).objects;
    expect(things).toContain("/Scene/skater");
    expect(things).toContain(`/Scene/${GREYBOX.name}/quarter-pipe`);
    const t = (await bridge.handle("transforms", { objects: [`/Scene/${GREYBOX.name}/building-north`] })).objects;
    // building-north is centered at (0, 4, -14) m: kit X = 1400 (forward is -z), Z = 400
    const b = t[`/Scene/${GREYBOX.name}/building-north`];
    expect(b.center.X).toBeCloseTo(1400, 0);
    expect(b.center.Z).toBeCloseTo(400, 0);
  });

  it("gives the skater's pose in the kit frame and the game time from the fixed ticks", async () => {
    const { bridge } = setup();
    const pose = await bridge.handle("pose", {});
    const [x, y, z] = GREYBOX.spawn.position;
    expect(pose.path).toBe("/Scene/skater");
    expect(pose.feet).toEqual({ X: -z * 100 + 0, Y: x * 100 + 0, Z: y * 100 + 0 });
    expect(pose.at.Z).toBeCloseTo(y * 100 + 90, 5);
    expect(pose.state).toBe("rolling");
    const ping = await bridge.handle("ping", {});
    expect(ping.game_time).toBeCloseTo(2, 5);
  });

  it("presses the game's actions by their bound keys, and restarts through resetSkater", async () => {
    const { bridge, keys, resets } = setup();
    await bridge.handle("input", { action: "jump", mode: "hold" });
    await bridge.handle("input", { action: "jump", mode: "release" });
    expect(keys).toEqual(["keydown:Space", "keyup:Space"]);
    await bridge.handle("session", { action: "restart" });
    expect(resets()).toBe(1);
    const ctx = await bridge.handle("context", {});
    expect(ctx.engine).toBe("threejs");
    expect(ctx.controls.find((a) => a.name === "jump").keys).toEqual(["SpaceBar"]);
  });

  it("reads the game's state through rc", async () => {
    const { bridge } = setup();
    const r = await bridge.handle("rc", { verb: "property", body: { objectPath: "atl", propertyName: "skater.state" } });
    expect(r).toEqual({ "skater.state": "rolling" });
  });
});
