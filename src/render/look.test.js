import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { BRICK_TONE, DETAIL_NORMAL, GROUND_ALBEDO, sunElevation, ENV_LIGHT, ENV_SKY, GRADE, LOOKS, ROUGHNESS, WALL_AO, brickTone, desaturate, detailNormal, gradeColor, litMaterial, lookFor, toneMappingOf, wallOcclusion, wallSkyLight } from "./look.js";
import { SKY } from "./sky.js";
import { SURFACE_COLORS } from "../level/geo/geo-mesh.js";
import { STYLES } from "../level/geo/styles.js";

describe("lookFor", () => {
  it("gives pbr to the high tier and toon to the others", () => {
    expect(lookFor(null, "high")).toBe("pbr");
    expect(lookFor(null, "phone")).toBe("toon");
    expect(lookFor(null, "low")).toBe("toon");
  });

  it("lets the URL value win", () => {
    expect(lookFor("toon", "high")).toBe("toon");
    expect(lookFor("pbr", "low")).toBe("pbr");
  });

  it("ignores an unknown value", () => {
    expect(lookFor("photo", "high")).toBe("pbr");
    expect(lookFor("", "low")).toBe("toon");
  });
});

describe("wallOcclusion", () => {
  it("is darkest at the base and full light from about one floor up", () => {
    expect(wallOcclusion(0)).toBeCloseTo(WALL_AO.base);
    expect(wallOcclusion(WALL_AO.floors)).toBe(1);
    expect(wallOcclusion(5)).toBe(1);
  });

  it("grows with the height", () => {
    const a = wallOcclusion(0.2);
    const b = wallOcclusion(0.5);
    expect(a).toBeGreaterThan(WALL_AO.base);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThan(1);
  });

  it("clamps a negative height", () => {
    expect(wallOcclusion(-1)).toBeCloseTo(WALL_AO.base);
  });
});

describe("litMaterial", () => {
  it("gives a toon material with the ramp for the toon look", () => {
    const ramp = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const m = litMaterial("toon", { vertexColors: true }, { gradientMap: ramp });
    expect(m.isMeshToonMaterial).toBe(true);
    expect(m.gradientMap).toBe(ramp);
    expect(m.vertexColors).toBe(true);
  });

  it("gives a rough, non-metal standard material for the pbr look", () => {
    const m = litMaterial("pbr", { vertexColors: true }, { roughness: ROUGHNESS.ground, envLight: ENV_LIGHT.ground });
    expect(m.isMeshStandardMaterial).toBe(true);
    expect(m.roughness).toBe(ROUGHNESS.ground);
    expect(m.envMapIntensity).toBe(ENV_LIGHT.ground);
    expect(m.metalness).toBe(0);
    expect(m.vertexColors).toBe(true);
  });
});

describe("LOOKS", () => {
  it("keeps the art colors with the neutral curve on both looks", () => {
    expect(toneMappingOf("pbr")).toBe(THREE.NeutralToneMapping);
    expect(toneMappingOf("toon")).toBe(THREE.NeutralToneMapping);
  });

  it("lights pbr mostly from the environment, not the hemisphere light", () => {
    expect(LOOKS.pbr.environment).toBeGreaterThan(0);
    expect(LOOKS.pbr.hemisphere).toBeLessThan(LOOKS.toon.hemisphere);
    expect(LOOKS.toon.environment).toBe(0);
  });

  it("gives the ground less sky reflection than a wall", () => {
    expect(ENV_LIGHT.ground).toBeLessThan(ENV_LIGHT.wall);
  });

  it("keeps glass much smoother than a wall", () => {
    expect(ROUGHNESS.glass).toBeLessThan(ROUGHNESS.wall / 5);
  });
});

describe("brickTone", () => {
  it("is neutral at the middle hash", () => {
    expect(brickTone(0.5)).toEqual([1, 1, 1]);
  });

  it("stays a small shift at the two ends", () => {
    for (const h of [0, 1]) for (const v of brickTone(h)) {
      expect(v).toBeGreaterThanOrEqual(0.91 - 1e-9);
      expect(v).toBeLessThanOrEqual(1.09 + 1e-9);
    }
  });

  it("keeps the mean at 1 on every channel, so the palette stays", () => {
    const sum = [0, 0, 0];
    for (let i = 0; i <= 100; i += 1) brickTone(i / 100).forEach((v, k) => (sum[k] += v));
    for (const s of sum) expect(Math.abs(s / 101 - 1)).toBeLessThan(0.001);
  });

  it("makes the light faces a little warmer", () => {
    expect(brickTone(1)[0]).toBeGreaterThan(brickTone(1)[2]);
    expect(BRICK_TONE.warm).toBeLessThan(BRICK_TONE.value);
  });
});

// The light on a wall in shade in the pbr look: the environment map and the
// hemisphere light (three.js divides the hemisphere light by pi).
function shadeLight({ ground = ENV_SKY.ground, saturation = ENV_SKY.saturation, wall = ENV_LIGHT.wall, sky = LOOKS.pbr.hemisphereSky } = {}) {
  const lin = (hex) => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  const env = wallSkyLight({ zenith: [SKY.zenith.r, SKY.zenith.g, SKY.zenith.b], horizon: [SKY.horizon.r, SKY.horizon.g, SKY.horizon.b], ground: lin(ground), saturation });
  const hs = lin(sky);
  const hg = lin(LOOKS.pbr.hemisphereGround);
  return env.map((v, k) => v * LOOKS.pbr.environment * wall + (LOOKS.pbr.hemisphere * (hs[k] + hg[k])) / 2 / Math.PI);
}
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

describe("desaturate", () => {
  it("keeps the luma and scales the chroma", () => {
    const c = [0.03, 0.27, 0.81];
    const d = desaturate(c, 0.5);
    expect(luma(d)).toBeCloseTo(luma(c), 10);
    expect(d[2] - d[0]).toBeCloseTo((c[2] - c[0]) * 0.5, 10);
    expect(desaturate(c, 1)).toEqual(c);
  });
});

describe("the shade light of the pbr look", () => {
  const brickLoft = STYLES.find((s) => s.id === "brick-loft");

  it("turned the cream trim blue-gray with the old sky map (the r1 fault)", () => {
    const old = shadeLight({ ground: 0x6b6a5c, saturation: 1, wall: 1, sky: 0xcfe8ff });
    const px = brickLoft.trim.map((v, k) => v * old[k]);
    expect(px[2] / px[0]).toBeGreaterThan(1.5);
  });

  it("keeps the cream trim cream: blue / red is at most 1.05", () => {
    const light = shadeLight();
    const px = brickLoft.trim.map((v, k) => v * light[k]);
    expect(px[2] / px[0]).toBeLessThanOrEqual(1.05);
    expect(px[2] / px[0]).toBeGreaterThan(0.9);
  });

  it("keeps the sage frame green, not blue", () => {
    const light = shadeLight();
    const px = brickLoft.frame.map((v, k) => v * light[k]);
    expect(px[1]).toBeGreaterThan(px[2]);
    expect(px[1]).toBeGreaterThan(px[0]);
  });

  it("keeps the shade value of a wall within 10 % of the old value", () => {
    const old = shadeLight({ ground: 0x6b6a5c, saturation: 1, wall: 1, sky: 0xcfe8ff });
    expect(Math.abs(luma(shadeLight()) / luma(old) - 1)).toBeLessThan(0.1);
  });

  it("keeps a little sky in the shade: it is still a bit cooler than the sun", () => {
    const light = shadeLight();
    expect(light[2]).toBeGreaterThan(light[0]);
  });

  it("does not change the visible sky colors", () => {
    expect(SKY.zenith.getHex()).toBe(0x2f8fe8);
    expect(SKY.horizon.getHex()).toBe(0xbfe4ff);
  });

  it("keeps the toon hemisphere light as it was", () => {
    expect(LOOKS.toon.hemisphereSky).toBe(0xcfe8ff);
    expect(LOOKS.toon.hemisphereGround).toBe(0x5a6a48);
  });
});

describe("detailNormal", () => {
  const n = [0, 0, 1];
  const tu = [1, 0, 0];
  const tv = [0, 1, 0];

  it("keeps the normal for a flat map sample or a zero strength", () => {
    expect(detailNormal(n, tu, tv, [0.5, 0.5, 1], 1)).toEqual([0, 0, 1]);
    const r = detailNormal(n, tu, tv, [0.9, 0.2, 0.8], 0);
    expect(r[0]).toBeCloseTo(0, 6);
    expect(r[1]).toBeCloseTo(0, 6);
  });

  it("tilts toward u and v as the map says, more with more strength", () => {
    const a = detailNormal(n, tu, tv, [0.7, 0.4, 0.9], 1);
    expect(a[0]).toBeGreaterThan(0);
    expect(a[1]).toBeLessThan(0);
    const b = detailNormal(n, tu, tv, [0.7, 0.4, 0.9], 2);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect(Math.hypot(...b)).toBeCloseTo(1, 6);
  });

  it("works with a tangent that is not square to the normal", () => {
    const r = detailNormal(n, [1, 0, 0.5], [0, 1, -0.3], [0.5, 0.5, 1], 1);
    expect(r[2]).toBeCloseTo(1, 6);
  });
});

describe("the pbr detail and the ink", () => {
  it("gives a normal strength to every ground set", () => {
    expect(DETAIL_NORMAL.ground).toHaveLength(5);
    for (const k of [DETAIL_NORMAL.brick, DETAIL_NORMAL.stone, ...DETAIL_NORMAL.ground]) expect(k).toBeGreaterThan(0);
  });

  it("gives an albedo factor under 1 to every ground set, and the darkest gray ground to grass", () => {
    expect(GROUND_ALBEDO).toHaveLength(DETAIL_NORMAL.ground.length);
    for (const rgb of GROUND_ALBEDO) {
      expect(rgb).toHaveLength(3);
      for (const c of rgb) {
        expect(c).toBeGreaterThan(0.1);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    const mean = (rgb) => (rgb[0] + rgb[1] + rgb[2]) / 3;
    // The brick pavers (index 4) are a colored ground, not a gray one.
    expect(mean(GROUND_ALBEDO[3])).toBe(Math.min(...GROUND_ALBEDO.slice(0, 4).map(mean)));
  });

  it("makes the asphalt much darker than the sidewalk slabs", () => {
    const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const asphalt = SURFACE_COLORS.street.map((c, i) => c * GROUND_ALBEDO[0][i]);
    const slab = SURFACE_COLORS.sidewalk.map((c, i) => c * GROUND_ALBEDO[1][i]);
    expect(luma(slab) / luma(asphalt)).toBeGreaterThan(3);
  });

  it("draws a lighter ink in the pbr look than in the toon look", () => {
    expect(LOOKS.pbr.ink).toBeLessThan(LOOKS.toon.ink);
    expect(LOOKS.pbr.grade).toBe(true);
    expect(LOOKS.toon.grade).toBe(false);
  });
});

describe("gradeColor", () => {
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  it("keeps black at black", () => {
    expect(gradeColor([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("adds contrast around the mid gray", () => {
    expect(luma(gradeColor([0.5, 0.5, 0.5]))).toBeGreaterThan(0.5 * 1.02);
    expect(luma(gradeColor([0.05, 0.05, 0.05]))).toBeLessThan(0.05);
  });

  it("adds saturation to a color", () => {
    const c = [0.4, 0.2, 0.1];
    const g = gradeColor(c, { ...GRADE, contrast: 1, shadowTint: [1, 1, 1], lightTint: [1, 1, 1] });
    expect(g[0] - g[2]).toBeGreaterThan(c[0] - c[2]);
    expect(luma(g)).toBeCloseTo(luma(c), 6);
  });

  it("makes a shadow cool and a light warm", () => {
    const s = gradeColor([0.02, 0.02, 0.02]);
    const l = gradeColor([0.8, 0.8, 0.8]);
    expect(s[2]).toBeGreaterThan(s[0]);
    expect(l[0]).toBeGreaterThan(l[2]);
  });
});

describe("the sun of each look", () => {
  it("keeps the toon sun, and gives the pbr look a lower sun from the same azimuth", () => {
    expect(sunElevation("toon")).toBeCloseTo(54.2, 1);
    expect(sunElevation("pbr")).toBeGreaterThan(20);
    expect(sunElevation("pbr")).toBeLessThan(35);
    const az = (o) => Math.atan2(o[2], o[0]);
    expect(az(LOOKS.pbr.sunOffset)).toBeCloseTo(az(LOOKS.toon.sunOffset), 2);
  });

  it("gives the pbr sun a warmer color than the toon sun", () => {
    const rb = (c) => ((c >> 16) & 255) - (c & 255);
    expect(rb(LOOKS.pbr.sunColor)).toBeGreaterThan(rb(LOOKS.toon.sunColor));
  });
});

describe("the pbr sun scale (#160)", () => {
  it("brightens the weather sun in the pbr look only, so a sunlit wall gets a highlight", () => {
    expect(LOOKS.pbr.sunScale).toBeGreaterThan(1);
    expect(LOOKS.pbr.sunScale).toBeLessThan(2);
    expect(LOOKS.toon.sunScale).toBeUndefined();
    // A 0.6 albedo wall in the weather noon sun (3.0), with the exposure at
    // noon (1.05 x 1.05): its radiance before the tone curve.
    const radiance = (sun) => (0.6 / Math.PI) * sun * 1.05 * 1.05;
    expect(radiance(3.0)).toBeLessThan(0.7);
    expect(radiance(3.0 * LOOKS.pbr.sunScale)).toBeGreaterThan(0.8);
  });
});
