import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PED_MODEL_KINDS } from "./ped-models.js";
import { PED_VARIANTS, PED_VARIANT_URLS, createLookPicker, lookTile, pedLooks, pickLook } from "./ped-variants.js";

describe("ped variants", () => {
  it("has a JPEG for every variant, and at most 3 variants per person (4 atlas tiles)", () => {
    for (const u of Object.values(PED_VARIANT_URLS)) expect(existsSync(fileURLToPath(u)), u).toBe(true);
    for (const list of Object.values(PED_VARIANTS)) expect(list.length).toBeLessThanOrEqual(3);
    expect(pedLooks(PED_MODEL_KINDS).length).toBe(PED_MODEL_KINDS.length + Object.values(PED_VARIANTS).flat().length);
  });

  it("puts each variant in its own atlas tile", () => {
    expect([0, 1, 2, 3].map(lookTile)).toEqual([
      [0, 0],
      [0.5, 0],
      [0, 0.5],
      [0.5, 0.5],
    ]);
  });

  it("picks a look that no near walker has", () => {
    const used = new Set([0, 1, 2, 3, 4, 5]);
    for (let seed = 0; seed < 50; seed += 1) expect(used.has(pickLook(seed, used, 19))).toBe(false);
    expect(pickLook(3, new Set(), 19)).toBe(pickLook(3, new Set(), 19));
  });

  it("gives a crowd of walkers different looks, and keeps a look until a respawn", () => {
    const looks = pedLooks(PED_MODEL_KINDS);
    const picker = createLookPicker(looks);
    // 15 walkers within 10 m of each other.
    const peds = Array.from({ length: 15 }, (_, id) => ({ id, live: true, spawns: 1, x: (id % 5) * 2, z: Math.floor(id / 5) * 2 }));
    picker.refresh({ peds });
    const first = peds.map((w) => picker.index(w.id));
    expect(new Set(first).size).toBe(peds.length);
    picker.refresh({ peds });
    expect(peds.map((w) => picker.index(w.id))).toEqual(first);
    peds[0].spawns = 2;
    picker.refresh({ peds });
    expect(new Set(peds.map((w) => picker.index(w.id))).size).toBe(peds.length);
  });
});
