import { describe, expect, it } from "vitest";
import { PBR_SKY, pbrFairChance, pbrSkyColor, pbrSkyDay } from "./sky.js";

// The weather sky colors (src/sim/weather.js PALETTE), linear.
const DAY = { zenith: [0.1, 0.38, 0.8], horizon: [0.62, 0.8, 0.98] };
const DUSK = { zenith: [0.14, 0.16, 0.38], horizon: [1.0, 0.52, 0.26] };
const NIGHT = { zenith: [0.008, 0.016, 0.04], horizon: [0.09, 0.1, 0.158] };
const NOON_SUN = 0.95; // the sun y at 13.5 h in June (about 72°)
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// The old (toon) gradient of the shader.
const flat = (y, z, h) => h.map((v, i) => v + (z[i] - v) * Math.pow(Math.max(y, 0), 0.55));

describe("pbrSkyDay", () => {
  it("is 0 with the sun under the horizon and 1 in the day", () => {
    expect(pbrSkyDay(-0.2)).toBe(0);
    expect(pbrSkyDay(-0.02)).toBe(0);
    expect(pbrSkyDay(0.3)).toBe(1);
    expect(pbrSkyDay(NOON_SUN)).toBe(1);
  });
});

describe("pbrSkyColor (#201)", () => {
  const at = (y) => pbrSkyColor(y, DAY.zenith, DAY.horizon, NOON_SUN);

  it("goes from a deeper blue at the top to a bright pale band at the horizon", () => {
    const top = at(1);
    const low = at(0);
    expect(luma(top)).toBeLessThan(luma(DAY.zenith));
    expect(top[2]).toBeGreaterThan(top[0] * 4);
    expect(luma(low)).toBeGreaterThan(luma(DAY.horizon) * 1.1);
    // The luma falls from the horizon to the zenith.
    let prev = Infinity;
    for (let y = 0; y <= 1.0001; y += 0.05) {
      const l = luma(at(y));
      expect(l).toBeLessThanOrEqual(prev + 1e-9);
      prev = l;
    }
  });

  it("makes the horizon band warm (less blue than the weather horizon)", () => {
    const low = at(0);
    expect(low[0] / low[2]).toBeGreaterThan(1);
    expect(DAY.horizon[0] / DAY.horizon[2]).toBeLessThan(1);
  });

  it("keeps the band narrow: at 30° up the sky is near the old gradient", () => {
    const y = Math.sin(Math.PI / 6);
    const band = Math.exp(-y / PBR_SKY.bandWidth);
    expect(band).toBeLessThan(0.01);
  });

  it("does not change the dusk and the night sky", () => {
    for (const [s, sunY] of [
      [DUSK, -0.03],
      [NIGHT, -0.4],
    ]) {
      for (const y of [0, 0.2, 0.6, 1]) {
        const c = pbrSkyColor(y, s.zenith, s.horizon, sunY);
        const o = flat(y, s.zenith, s.horizon);
        c.forEach((v, i) => expect(v).toBeCloseTo(o[i], 9));
      }
    }
  });

  it("keeps the mean wall light from the sky within 10 % (the env map)", () => {
    // The cosine-weighted mean over the upper half sphere in front of a
    // wall: the env light on a wall from the sky part of the env map.
    const mean = (f) => {
      let s = 0;
      let w = 0;
      for (let i = 0; i < 200; i++) {
        const y = (i + 0.5) / 200;
        const k = Math.sqrt(1 - y * y); // the cosine weight of a vertical wall, mean over azimuth
        s += luma(f(y)) * k;
        w += k;
      }
      return s / w;
    };
    const now = mean(at);
    const old = mean((y) => flat(y, DAY.zenith, DAY.horizon));
    expect(Math.abs(now / old - 1)).toBeLessThan(0.1);
  });
});

describe("pbrFairChance (#201)", () => {
  it("keeps a few fair-weather clouds on a clear day", () => {
    expect(pbrFairChance(0, NOON_SUN)).toBe(PBR_SKY.fairChance);
    // A few: under half of the cells, and each cloud is smaller than its cell.
    expect(PBR_SKY.fairChance).toBeLessThan(0.5);
    expect(PBR_SKY.fairSize[1]).toBeLessThan(0.5);
  });

  it("fades out under a weather cover and at night", () => {
    expect(pbrFairChance(0.6, NOON_SUN)).toBe(0);
    expect(pbrFairChance(0.4, NOON_SUN)).toBeLessThan(PBR_SKY.fairChance);
    expect(pbrFairChance(0, -0.3)).toBe(0);
  });
});
