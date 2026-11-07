import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUND_LIGHT_GRID, LAMP_GLOBE, LAMP_HEAD, LAMP_POOL, MULCH, bakeGroundLight, groundLightGrid, isTree, lampPools, mulchFalloff, mulchPatches, poolFalloff, sampleGroundLight } from "./ground-light.js";
import { placementMatrix } from "./prop-batch.js";
import { BLOOM_THRESHOLD } from "./pbr-palette.js";

describe("the lamp pools (#196)", () => {
  it("puts the pool under the lamp head, on the arm, for every yaw", () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.5, -1.2]) {
      const p = { kind: "lamp", x: 10, z: -4, yaw };
      const [pool] = lampPools([p]);
      // The head in the template is (LAMP_HEAD.x, y, 0): the batch matrix moves it.
      const m = placementMatrix({ ...p, y: 0 });
      expect(pool.x).toBeCloseTo(m[0] * LAMP_HEAD.x + m[12], 6);
      expect(pool.z).toBeCloseTo(m[2] * LAMP_HEAD.x + m[14], 6);
    }
  });

  it("gives a pool to the lamps only", () => {
    const pools = lampPools([
      { kind: "lamp", x: 0, z: 0 },
      { kind: "bench", x: 5, z: 0 },
      { kind: "tree_round", x: 9, z: 0 },
    ]);
    expect(pools).toHaveLength(1);
  });

  it("is brightest at the center and dark at the radius and past it", () => {
    expect(poolFalloff(0)).toBe(1);
    expect(poolFalloff(LAMP_POOL.radius / 2)).toBeGreaterThan(0.4);
    expect(poolFalloff(LAMP_POOL.radius)).toBe(0);
    expect(poolFalloff(LAMP_POOL.radius * 2)).toBe(0);
    for (let d = 0; d < LAMP_POOL.radius; d += 0.5) expect(poolFalloff(d + 0.5)).toBeLessThanOrEqual(poolFalloff(d));
  });

  it("has a warm 4000 K color", () => {
    const [r, g, b] = LAMP_POOL.color;
    expect(r).toBe(1);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeLessThan(0.75);
    expect(b).toBeGreaterThan(0.25);
  });

  it("leaves dark ground between two trail lamps 24 m apart", () => {
    // Trail lamps are each 24 m (props.js); sidewalk lamps each 36 m.
    const map = bakeGroundLight([
      { kind: "lamp", x: 0, z: 0, yaw: 0 },
      { kind: "lamp", x: 24, z: 0, yaw: 0 },
    ]);
    const a = lampPools([{ kind: "lamp", x: 0, z: 0, yaw: 0 }])[0];
    expect(sampleGroundLight(map, a.x, a.z)[0]).toBeGreaterThan(0.9);
    expect(sampleGroundLight(map, a.x + 12, a.z)[0]).toBe(0);
  });
});

describe("the mulch under the trees (#197)", () => {
  it("knows the tree kinds", () => {
    expect(isTree("tree_round")).toBe(true);
    expect(isTree("tree:oak:0")).toBe(true);
    expect(isTree("lamp")).toBe(false);
    expect(isTree(undefined)).toBe(false);
  });

  it("gives each tree a patch in the radius range, the same on each load", () => {
    const trees = Array.from({ length: 40 }, (_, i) => ({ kind: "tree_round", x: i * 7.3, z: i * -3.1 }));
    const a = mulchPatches(trees);
    expect(a).toEqual(mulchPatches(trees));
    for (const p of a) {
      expect(p.r).toBeGreaterThanOrEqual(MULCH.min);
      expect(p.r).toBeLessThanOrEqual(MULCH.min + MULCH.spread);
    }
    expect(new Set(a.map((p) => p.r.toFixed(3))).size).toBeGreaterThan(30);
  });

  it("is full at the trunk and stops at its radius", () => {
    expect(mulchFalloff(0, 2)).toBe(1);
    expect(mulchFalloff(1, 2)).toBeGreaterThan(0.9);
    expect(mulchFalloff(2, 2)).toBe(0);
  });

  it("bakes the mulch into G and the lamps into R", () => {
    const map = bakeGroundLight([
      { kind: "tree_tall", x: 0, z: 0 },
      { kind: "lamp", x: 40, z: 0, yaw: 0 },
    ]);
    expect(sampleGroundLight(map, 0, 0)[1]).toBeGreaterThan(0.8);
    expect(sampleGroundLight(map, 0, 0)[0]).toBe(0);
    expect(sampleGroundLight(map, 20, 0)).toEqual([0, 0]);
    expect(map.pools).toBe(1);
    expect(map.patches).toBe(1);
  });
});

describe("the ground light map", () => {
  it("covers the placements with a margin, at 1 m a texel", () => {
    const g = groundLightGrid([{ x: 0, z: 0 }], [{ x: 100, z: 50, r: 2 }]);
    const m = GROUND_LIGHT_GRID.margin;
    expect(g.texel).toBe(1);
    expect(g.x0).toBe(-m);
    expect(g.z0).toBe(-m);
    expect(g.width).toBe(100 + 2 * m);
    expect(g.height).toBe(50 + 2 * m);
  });

  it("grows the texel on a very large level, so no side is over the cap", () => {
    const g = groundLightGrid([{ x: 0, z: 0 }], [{ x: 9000, z: 100, r: 2 }]);
    expect(g.width).toBeLessThanOrEqual(GROUND_LIGHT_GRID.maxSide);
    expect(g.texel).toBeGreaterThan(4);
  });

  it("keeps a BeltLine-size level near 4 MB of GPU memory (RG8, no mips)", () => {
    // The Eastside props span about 1 km x 2 km (992 x 1967 texels).
    const g = groundLightGrid([{ x: -500, z: -985 }], [{ x: 470, z: 960, r: 2 }]);
    expect(g.width * g.height * 2).toBeLessThan(4.2e6);
  });

  it("is null with no lamps and no trees", () => {
    expect(bakeGroundLight([{ kind: "bench", x: 0, z: 0 }])).toBeNull();
  });

  it("stores RG8: two bytes a texel", () => {
    const map = bakeGroundLight([{ kind: "lamp", x: 0, z: 0 }]);
    const { width, height } = map.grid;
    expect(map.data).toHaveLength(width * height * 2);
  });
});
// The lamp node of the kit GLB (no Draco): its positions and vertex colors.
function kitLamp() {
  const b = readFileSync(new URL("../../assets/kit/street-kit.glb", import.meta.url));
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.toString("utf8", 20, 20 + jl));
  const bin = b.subarray(20 + jl + 8);
  const read = (ai) => {
    const a = j.accessors[ai];
    const v = j.bufferViews[a.bufferView];
    const n = { VEC3: 3, VEC4: 4 }[a.type];
    const size = { 5126: 4, 5123: 2, 5121: 1 }[a.componentType];
    const out = [];
    for (let i = 0; i < a.count; i += 1) {
      const r = [];
      for (let c = 0; c < n; c += 1) {
        const o = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + (v.byteStride ?? n * size) * i + c * size;
        r.push(size === 4 ? bin.readFloatLE(o) : size === 2 ? bin.readUInt16LE(o) / 65535 : bin[o] / 255);
      }
      out.push(r);
    }
    return out;
  };
  const node = j.nodes.find((n) => n.name === "lamp");
  const prim = j.meshes[node.mesh].primitives[0];
  return { positions: read(prim.attributes.POSITION), colors: read(prim.attributes.COLOR_0) };
}

describe("the kit lamp", () => {
  it("has its warm globe at LAMP_HEAD, in the LAMP_GLOBE color", () => {
    const { positions, colors } = kitLamp();
    const globe = positions.filter((_, i) => LAMP_GLOBE.color.every((c, k) => Math.abs(colors[i][k] - c) < 0.02));
    expect(globe.length).toBeGreaterThan(8);
    const mid = (k) => (Math.min(...globe.map((p) => p[k])) + Math.max(...globe.map((p) => p[k]))) / 2;
    expect(mid(0)).toBeCloseTo(LAMP_HEAD.x, 1);
    expect(mid(1)).toBeCloseTo(LAMP_HEAD.y, 1);
    expect(Math.abs(mid(2))).toBeLessThan(0.05);
  });

  it("makes the globe glow over the night bloom threshold", () => {
    expect(LAMP_GLOBE.night).toBeGreaterThan(BLOOM_THRESHOLD.night * 2);
  });
});
