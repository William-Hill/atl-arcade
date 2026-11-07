import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SURFACE_COLORS, stripColor } from "../level/geo/geo-mesh.js";
import { DETAIL_NORMAL, GROUND_ALBEDO } from "./look.js";
import { ALBEDO, MATERIAL_CLASSES } from "./pbr-palette.js";
import { GROUND_LAYERS, GROUND_ROUGHNESS_FLOOR, LAWN, PBR_GROUND_OF, groundAlbedo, groundBudget, groundFiles, lawnTone, pbrGroundTier } from "./pbr-ground.js";
import sets from "../../assets/ground/pbr/sets.json";

const ROOT = new URL("../../", import.meta.url);

// Width and height of a lossy WebP (the VP8 frame header).
function webpSize(path) {
  const b = readFileSync(new URL(path, ROOT));
  expect(b.toString("ascii", 0, 4)).toBe("RIFF");
  expect(b.toString("ascii", 12, 16)).toBe("VP8 ");
  return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
}

describe("the pbr ground sets (#158)", () => {
  it("has the five layers in the toon order, then brick", () => {
    expect(GROUND_LAYERS).toEqual(["asphalt", "concrete", "trail", "grass", "brick"]);
    expect(GROUND_ALBEDO).toHaveLength(GROUND_LAYERS.length);
    expect(DETAIL_NORMAL.ground).toHaveLength(GROUND_LAYERS.length);
    expect(sets.sets.map((s) => s.id)).toEqual(GROUND_LAYERS);
  });

  it("keeps the high tier near 2 MB and the small tier far under it", () => {
    const high = groundBudget("high");
    const small = groundBudget("small");
    expect(high.bytes).toBeLessThan(2.1e6);
    expect(small.bytes).toBeLessThan(0.5e6);
    expect(small.gpuBytes).toBeLessThan(high.gpuBytes / 3);
  });

  it("gives the high tier 1024 px albedo and normal layers, and the small tier 512 px and no normal map", () => {
    const n = GROUND_LAYERS.length;
    const high = groundFiles("high");
    const small = groundFiles("small");
    expect(webpSize(`assets/ground/pbr/${high.albedo}`)).toEqual([1024, 1024 * n]);
    expect(webpSize(`assets/ground/pbr/${high.normal}`)).toEqual([1024, 1024 * n]);
    expect(webpSize(`assets/ground/pbr/${high.orm}`)).toEqual([512, 512 * n]);
    expect(webpSize(`assets/ground/pbr/${small.albedo}`)).toEqual([512, 512 * n]);
    expect(webpSize(`assets/ground/pbr/${small.orm}`)).toEqual([512, 512 * n]);
    expect(small.normal).toBeUndefined();
  });

  it("puts the high tier on the high quality and the small one on phone and low", () => {
    expect(pbrGroundTier("high")).toBe("high");
    expect(pbrGroundTier("phone")).toBe("small");
    expect(pbrGroundTier("low")).toBe("small");
    expect(pbrGroundTier("high", false)).toBeNull();
  });

  it("has a provenance file for each set, with the tool, the source, the credits, the license, and the date", () => {
    for (const id of GROUND_LAYERS) {
      const p = JSON.parse(readFileSync(new URL(`assets/ground/${id}/provenance.json`, ROOT), "utf8"));
      expect(p.tool, id).toMatch(/ground-textures-pbr\.py/);
      expect(p.source, id).toMatch(/^https:\/\/polyhaven\.com\/a\//);
      expect(Object.keys(p.credits ?? {}).length, id).toBeGreaterThan(0);
      expect(p.license, id).toBe("CC0 1.0");
      expect(p.date, id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("picked each set from 2 to 4 candidates (grass keeps its one scan), with no baked light and no seam", () => {
    for (const s of sets.sets) {
      if (s.id !== "grass") {
        expect(s.candidates.length, s.id).toBeGreaterThanOrEqual(2);
        expect(s.candidates.length, s.id).toBeLessThanOrEqual(4);
      }
      const picked = s.candidates.filter((c) => c.picked);
      expect(picked, s.id).toHaveLength(1);
      expect(picked[0].rejected, s.id).toEqual([]);
      expect(s.scoresAfter.light, s.id).toBeLessThan(0.06);
      expect(s.scoresAfter.seam, s.id).toBeLessThan(1.6);
    }
  });

  it("keeps every ground albedo inside the pbr palette limits", () => {
    for (const kind of Object.keys(PBR_GROUND_OF)) {
      const c = groundAlbedo(kind);
      expect(Math.max(...c), kind).toBeLessThanOrEqual(ALBEDO.ceiling);
      expect(Math.max(...c), kind).toBeGreaterThanOrEqual(ALBEDO.floor);
    }
  });

  it("makes the brick pavers red-brown and darker than the sidewalk", () => {
    const [r, g, b] = groundAlbedo("brick");
    expect(r).toBeGreaterThan(2 * g);
    expect(g).toBeGreaterThan(b);
    const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(luma(groundAlbedo("brick"))).toBeLessThan(luma(groundAlbedo("sidewalk")));
  });

  it("keeps the roughness of each layer in its material class", () => {
    const cls = { asphalt: "asphalt", concrete: "concrete", trail: "concrete", grass: "grass", brick: "brick" };
    sets.sets.forEach((s, i) => {
      const [lo, hi] = MATERIAL_CLASSES[cls[s.id]].roughness;
      expect(GROUND_ROUGHNESS_FLOOR[i], s.id).toBe(lo);
      // The scan mean after the floor, with a margin for the grain.
      expect(Math.max(s.roughMean, lo), s.id).toBeLessThanOrEqual(hi + 0.05);
    });
  });
});

describe("the brick path color", () => {
  const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

  it("is a path in the toon look and its own kind in the pbr shader", () => {
    const d = dist(SURFACE_COLORS.brick, SURFACE_COLORS.path);
    expect(d).toBeGreaterThan(0.01);
    expect(d).toBeLessThan(0.02);
  });

  it("goes to a strip with a brick surface only", () => {
    expect(stripColor({ kind: "path", surface: "brick" })).toBe(SURFACE_COLORS.brick);
    expect(stripColor({ kind: "path" })).toBe(SURFACE_COLORS.path);
    expect(stripColor({ kind: "street", surface: "asphalt" })).toBe(SURFACE_COLORS.street);
  });
});

describe("the pbr lawn (#197)", () => {
  const LIN = (h) => [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(1 + i, 3 + i), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // HSV saturation of a linear color, in sRGB.
  const sat = (c) => {
    const s = c.map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
    return 1 - Math.min(...s) / Math.max(...s);
  };

  it("keeps the mean lawn albedo a mid green in the doc range (#4f7a3a to #6f9a4a)", () => {
    for (const kind of ["ground", "park"]) {
      const c = groundAlbedo(kind);
      expect(luma(c), kind).toBeGreaterThan(luma(LIN("#4f7a3a")) * 0.95);
      expect(luma(c), kind).toBeLessThan(luma(LIN("#6f9a4a")));
      expect(c[1], kind).toBeGreaterThan(c[0]);
      expect(sat(c), kind).toBeLessThanOrEqual(sat(LIN("#4f7a3a")) + 0.02);
    }
  });

  it("makes the lawn less saturated and darker than the bare scan, and leaves other layers alone", () => {
    const c = [0.1, 0.28, 0.05];
    const t = lawnTone(c);
    expect(sat(t)).toBeLessThan(sat(c));
    expect(luma(t)).toBeCloseTo(luma(c) * LAWN.value, 6);
    expect(groundAlbedo("street")).toEqual(SURFACE_COLORS.street.map((v, i) => v * 0.72 * GROUND_ALBEDO[0][i]));
  });

  it("swings the value about 10 % and keeps every lawn and bed inside the albedo limits", () => {
    expect(LAWN.valueSwing).toBeCloseTo(0.1, 2);
    expect(LAWN.hueSwing).toBeLessThan(0.1);
    expect(Math.min(...LAWN.scales)).toBeGreaterThanOrEqual(10);
    for (const kind of ["ground", "park"]) {
      const c = groundAlbedo(kind);
      const hi = (1 + LAWN.valueSwing) * (1 + LAWN.hueSwing);
      expect(Math.max(...c) * hi, kind).toBeLessThanOrEqual(ALBEDO.ceiling);
      expect(Math.max(...c) * (1 - LAWN.valueSwing) * (1 - LAWN.hueSwing), kind).toBeGreaterThanOrEqual(ALBEDO.floor);
    }
    for (const bed of [LAWN.mulch, LAWN.soil]) {
      expect(Math.max(...bed)).toBeGreaterThanOrEqual(ALBEDO.floor);
      expect(bed[0]).toBeGreaterThan(bed[1]);
      expect(bed[1]).toBeGreaterThan(bed[2]);
    }
  });
});
