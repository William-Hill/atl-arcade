import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createCrowd, NPC_TYPES } from "../sim/npc/crowd.js";
import { createNpcView, npcGeometry } from "./npc-view.js";

const LEVEL = JSON.parse(readFileSync(new URL("../../levels/beltline-eastside/level.json", import.meta.url), "utf8"));

describe("npc view", () => {
  it("builds a low-poly figure with colors and tints for every type", () => {
    for (const type of Object.keys(NPC_TYPES)) {
      const g = npcGeometry(type);
      const tris = g.attributes.position.count / 3;
      expect(tris, type).toBeGreaterThan(20);
      expect(tris, type).toBeLessThan(1500);
      expect(g.attributes.color.count).toBe(g.attributes.position.count);
      expect(g.attributes.tint.count).toBe(g.attributes.position.count);
      // The figure stands on the ground and is no taller than 2 m.
      g.computeBoundingBox();
      expect(g.boundingBox.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(g.boundingBox.max.y).toBeLessThan(2);
    }
  });

  it("draws the crowd with one instanced mesh per type and places each NPC", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const view = createNpcView(crowd);
    const types = new Set(crowd.npcs.map((n) => n.type));
    expect(view.drawCalls).toBe(types.size);
    view.sync(crowd);
    expect(view.drawn).toBe(crowd.npcs.length);
    expect(view.meshes.reduce((a, m) => a + m.count, 0)).toBe(crowd.npcs.length);
    const n = crowd.npcs[0];
    const mesh = view.meshes.find((m) => m.name === `npcs-${n.type}`);
    const e = mesh.instanceMatrix.array;
    // The first slot of that type belongs to the first NPC of that type.
    expect(e[12]).toBeCloseTo(n.x, 4);
    expect(e[14]).toBeCloseTo(n.z, 4);
  });

  it("draws only the NPCs near the camera", () => {
    const crowd = createCrowd(LEVEL, { seed: 1 });
    const view = createNpcView(crowd, { drawDistance: 100 });
    const [x, , z] = LEVEL.spawn.position;
    view.sync(crowd, { x, z });
    const near = crowd.npcs.filter((n) => Math.hypot(n.x - x, n.z - z) <= 100).length;
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(crowd.npcs.length);
    expect(view.drawn).toBe(near);
    expect(view.meshes.reduce((a, m) => a + m.count, 0)).toBe(near);
  });
});
