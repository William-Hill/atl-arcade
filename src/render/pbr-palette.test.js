import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  ALBEDO,
  CHARACTER_MIN_ROUGHNESS,
  DISTRICT_LOOKS,
  FACADE_FADE,
  GRADE_PIVOT,
  HEIGHT_FOG,
  LANDMARK_PALETTE,
  MATERIAL_CLASSES,
  TIME_GRADES,
  WINDOW_COLORS,
  albedoCeiling,
  characterRoughness,
  clampToClass,
  districtLook,
  districtWeights,
  gradePixel,
  heightFogFactor,
  hexToLinear,
  linearToHex,
  materialAudit,
  screenFade,
  timeGrade,
  windowColor,
  windowColorGlsl,
  windowMean,
} from "./pbr-palette.js";
import { STYLES } from "../level/geo/styles.js";
import { GROUND_ALBEDO } from "./look.js";
import { SURFACE_COLORS } from "../level/geo/geo-mesh.js";
import { RIM_POWER, SKATER_RIM, pbrSkater, rimWeight } from "./toon.js";

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const maxC = (c) => Math.max(...c);

describe("hex and linear", () => {
  it("round-trips a hex color", () => {
    for (const h of ["#000000", "#ffffff", "#8c4538", "#4f7a3a"]) expect(linearToHex(hexToLinear(h))).toBe(h);
  });

  it("puts the 0.6 ceiling at about #cbcbcb", () => {
    expect(linearToHex([ALBEDO.ceiling, ALBEDO.ceiling, ALBEDO.ceiling])).toBe("#cbcbcb");
  });
});

describe("albedoCeiling", () => {
  it("does not change a color under the ceiling", () => {
    expect(albedoCeiling([0.2, 0.3, 0.4])).toEqual([0.2, 0.3, 0.4]);
  });

  it("pulls today's pale wall colors under 0.6 and keeps their hue", () => {
    // The colors over the ceiling in docs/art-direction-pbr.md.
    for (const hex of ["#f2d9b3", "#fae6c2", "#e6e6e6", "#faf0d9", "#fac773", "#ffffff"]) {
      const c = hexToLinear(hex);
      const o = albedoCeiling(c);
      expect(maxC(o)).toBeCloseTo(ALBEDO.ceiling, 6);
      // The same channel ratios: the hue and the chroma ratio stay.
      expect(o[0] / o[1]).toBeCloseTo(c[0] / c[1], 6);
      expect(o[2] / o[1]).toBeCloseTo(c[2] / c[1], 6);
    }
  });

  it("brings every style wall color in the pbr shader to 0.6 or under", () => {
    // The facade shader: albedo x 0.74, a 10 % desaturation, then the
    // ceiling. The style colors are linear vertex colors.
    let over = 0;
    for (const s of STYLES) {
      for (const wall of [...s.walls, s.trim]) {
        expect(wall).toHaveLength(3);
        const c = wall.map((v) => v * 0.74);
        if (maxC(c) > ALBEDO.ceiling) over += 1;
        const l = luma(c);
        const d = c.map((v) => v + (l - v) * 0.1);
        expect(maxC(albedoCeiling(d))).toBeLessThanOrEqual(ALBEDO.ceiling + 1e-9);
      }
    }
    // Some colors were over the ceiling before (the pale stucco, the white trim).
    expect(over).toBeGreaterThan(0);
  });
});

describe("the Atlanta palette", () => {
  it("has a look for each district and the trail", () => {
    expect(Object.keys(DISTRICT_LOOKS).sort()).toEqual(["inman-park", "old-fourth-ward", "poncey-highland", "trail"]);
  });

  it("keeps every palette, accent and landmark color between the floor and the ceiling", () => {
    const all = [...LANDMARK_PALETTE, ...Object.values(DISTRICT_LOOKS).flatMap((d) => [...d.palette, ...d.accent])];
    for (const hex of all) {
      const c = hexToLinear(hex);
      expect(maxC(c), hex).toBeLessThanOrEqual(ALBEDO.ceiling);
      expect(maxC(c), hex).toBeGreaterThanOrEqual(ALBEDO.floor);
    }
  });

  it("keeps each district tint within 5 % of neutral", () => {
    for (const d of Object.values(DISTRICT_LOOKS)) {
      for (const t of d.grade.tint) expect(Math.abs(t - 1)).toBeLessThanOrEqual(0.05);
      expect(d.grade.saturation).toBeGreaterThanOrEqual(1);
      expect(d.grade.saturation).toBeLessThan(1.15);
    }
  });

  it("puts the pbr lawn and park in the mid green of the style sheet", () => {
    // The ground albedo: art color x 0.72 (createSurfaceMaterial) x GROUND_ALBEDO[3].
    const lo = hexToLinear("#4f7a3a");
    const hi = hexToLinear("#6f9a4a");
    for (const kind of ["ground", "park"]) {
      const c = SURFACE_COLORS[kind].map((v, i) => v * 0.72 * GROUND_ALBEDO[3][i]);
      expect(luma(c)).toBeGreaterThan(luma(lo) * 0.9);
      expect(luma(c)).toBeLessThan(luma(hi) * 1.1);
      // Green leads, blue is low: not a mint gray.
      expect(c[1]).toBeGreaterThan(c[0] * 1.8);
      expect(c[1]).toBeGreaterThan(c[2] * 3);
    }
  });

  it("makes the asphalt the darkest ground at about 0.09 linear, with no lilac cast", () => {
    const c = SURFACE_COLORS.street.map((v, i) => v * 0.72 * GROUND_ALBEDO[0][i]);
    expect(luma(c)).toBeGreaterThan(0.06);
    expect(luma(c)).toBeLessThan(0.11);
    expect(c[2] / c[1]).toBeLessThan(1.1);
  });
});

describe("material classes", () => {
  it("covers the classes of #157", () => {
    for (const k of ["brick", "stucco", "glass", "asphalt", "concrete", "skin", "cloth", "paint"]) expect(MATERIAL_CLASSES[k], k).toBeDefined();
  });

  it("has valid ranges, metal only for metal", () => {
    for (const [k, c] of Object.entries(MATERIAL_CLASSES)) {
      expect(c.roughness[0]).toBeLessThanOrEqual(c.roughness[1]);
      expect(c.roughness[0]).toBeGreaterThan(0);
      expect(c.roughness[1]).toBeLessThanOrEqual(1);
      if (k !== "metal") expect(c.metalness).toEqual([0, 0]);
    }
  });

  it("clamps a value into its class", () => {
    expect(clampToClass("skin", 0.2)).toEqual({ roughness: 0.45, metalness: 0 });
    expect(clampToClass("glass", 0.08, 0.5)).toEqual({ roughness: 0.08, metalness: 0 });
    expect(clampToClass("metal", 0.9, 1)).toEqual({ roughness: 0.6, metalness: 1 });
    expect(() => clampToClass("plastic", 0.5)).toThrow();
  });

  it("keeps character skin and cloth off plastic, and metal parts as they are", () => {
    expect(characterRoughness(0.1)).toBe(CHARACTER_MIN_ROUGHNESS);
    expect(characterRoughness(0.8)).toBe(0.8);
    expect(characterRoughness(0.3, 1)).toBe(0.3);
  });
});

describe("bold far windows", () => {
  it("has weights that sum to 1 and dark colors with one warm pane", () => {
    expect(WINDOW_COLORS.reduce((a, w) => a + w.weight, 0)).toBeCloseTo(1, 9);
    for (const w of WINDOW_COLORS) expect(maxC(hexToLinear(w.hex))).toBeLessThan(0.3);
    expect(WINDOW_COLORS.some((w) => {
      const c = hexToLinear(w.hex);
      return c[0] > c[2] * 2;
    })).toBe(true);
  });

  it("picks a color by the hash", () => {
    expect(windowColor(0)).toEqual(hexToLinear(WINDOW_COLORS[0].hex));
    expect(windowColor(0.999)).toEqual(hexToLinear(WINDOW_COLORS.at(-1).hex));
    const seen = new Set();
    for (let h = 0; h < 1; h += 0.01) seen.add(linearToHex(windowColor(h)));
    expect(seen.size).toBe(WINDOW_COLORS.length);
  });

  it("writes a GLSL function with every color and a mean under the ceiling", () => {
    const g = windowColorGlsl();
    expect(g).toContain("vec3 boldWindow(float h)");
    expect(g.match(/return vec3/g)).toHaveLength(WINDOW_COLORS.length);
    const m = windowMean();
    expect(maxC(m)).toBeLessThan(0.2);
  });
});

describe("screenFade", () => {
  it("is 0 for a large cell, 1 for a small one, and falls with the size", () => {
    for (const pair of [FACADE_FADE.bold, FACADE_FADE.fine]) {
      expect(pair[0]).toBeGreaterThan(pair[1]);
      expect(screenFade(200, pair)).toBe(0);
      expect(screenFade(2, pair)).toBe(1);
      let last = -1;
      for (let px = 100; px >= 1; px -= 1) {
        const f = screenFade(px, pair);
        expect(f).toBeGreaterThanOrEqual(last);
        last = f;
      }
    }
  });

  it("fades the fine detail before the windows go bold", () => {
    expect(FACADE_FADE.fine[0]).toBeGreaterThan(FACADE_FADE.bold[0]);
  });
});

describe("district weights", () => {
  const anchors = [
    { id: "poncey-highland", x: 0, z: 0, radius: 380 },
    { id: "inman-park", x: 2000, z: 0, radius: 380 },
  ];
  const sum = (w) => Object.values(w).reduce((a, b) => a + b, 0);

  it("is the district at its anchor and the trail far away", () => {
    expect(districtWeights(0, 0, anchors)).toEqual({ "poncey-highland": 1, trail: 0 });
    expect(districtWeights(1000, 0, anchors)).toEqual({ trail: 1 });
    expect(districtWeights(0, 0, [])).toEqual({ trail: 1 });
  });

  it("blends over the border and always sums to 1", () => {
    let last = 1;
    for (let x = 300; x <= 560; x += 20) {
      const w = districtWeights(x, 0, anchors);
      expect(sum(w)).toBeCloseTo(1, 9);
      const k = w["poncey-highland"] ?? 0;
      expect(k).toBeLessThanOrEqual(last);
      last = k;
    }
    const mid = districtWeights(440, 0, anchors);
    expect(mid["poncey-highland"]).toBeGreaterThan(0);
    expect(mid.trail).toBeGreaterThan(0);
  });

  it("shares two overlapping anchors", () => {
    const w = districtWeights(0, 0, [...anchors, { id: "old-fourth-ward", x: 10, z: 0, radius: 520 }]);
    expect(sum(w)).toBeCloseTo(1, 9);
    expect(w["poncey-highland"]).toBeCloseTo(0.5, 9);
    expect(w["old-fourth-ward"]).toBeCloseTo(0.5, 9);
  });

  it("ignores an anchor with no district look", () => {
    expect(districtWeights(0, 0, [{ id: "downtown", x: 0, z: 0, radius: 500 }])).toEqual({ trail: 1 });
  });

  it("blends the district looks by weight", () => {
    const a = districtLook({ trail: 1 });
    expect(a.tint).toEqual(DISTRICT_LOOKS.trail.grade.tint);
    const b = districtLook({ trail: 0.5, "inman-park": 0.5 });
    expect(b.saturation).toBeCloseTo((DISTRICT_LOOKS.trail.grade.saturation + DISTRICT_LOOKS["inman-park"].grade.saturation) / 2, 9);
    expect(b.fog.every((v) => v > 0 && v < 1)).toBe(true);
  });
});

describe("timeGrade", () => {
  it("gives the key grades at the key elevations", () => {
    expect(timeGrade(60)).toEqual(TIME_GRADES.day);
    expect(timeGrade(4).warm).toBeCloseTo(TIME_GRADES.golden.warm, 9);
    expect(timeGrade(-4).warm).toBeCloseTo(TIME_GRADES.dusk.warm, 9);
    expect(timeGrade(-20)).toEqual(TIME_GRADES.night);
  });

  it("makes the golden hour warmer than noon and the dusk cool", () => {
    expect(timeGrade(8).warm).toBeGreaterThan(timeGrade(50).warm);
    expect(timeGrade(-4).warm).toBeLessThan(0);
  });

  it("changes with no jump over the day", () => {
    let prev = timeGrade(-30);
    for (let e = -29.75; e <= 70; e += 0.25) {
      const g = timeGrade(e);
      for (const k of Object.keys(g)) expect(Math.abs(g[k] - prev[k]), `${k} at ${e}`).toBeLessThan(0.08);
      prev = g;
    }
  });

  it("softens the warm split under clouds", () => {
    expect(Math.abs(timeGrade(40, 1).warm)).toBeLessThan(Math.abs(timeGrade(40, 0).warm));
  });
});

describe("gradePixel", () => {
  it("keeps a neutral pixel at the pivot", () => {
    const o = gradePixel([GRADE_PIVOT, GRADE_PIVOT, GRADE_PIVOT], { contrast: 1.2, saturation: 1.2 });
    for (const v of o) expect(v).toBeCloseTo(GRADE_PIVOT, 6);
  });

  it("darkens the shadows and lifts the lights with contrast", () => {
    const g = { contrast: 1.15 };
    expect(luma(gradePixel([0.05, 0.05, 0.05], g))).toBeLessThan(0.05);
    expect(luma(gradePixel([0.6, 0.6, 0.6], g))).toBeGreaterThan(0.6);
  });

  it("keeps the luma with saturation", () => {
    const c = [0.4, 0.2, 0.1];
    expect(luma(gradePixel(c, { saturation: 1.3 }))).toBeCloseTo(luma(c), 6);
  });

  it("warms the lights and cools the shadows with a warm split", () => {
    const light = gradePixel([0.7, 0.7, 0.7], { warm: 1 });
    expect(light[0]).toBeGreaterThan(light[2]);
    const shadow = gradePixel([0.02, 0.02, 0.02], { warm: 1 });
    expect(shadow[2]).toBeGreaterThan(shadow[0]);
  });

  it("is the identity with the default values", () => {
    const c = [0.3, 0.5, 0.1];
    gradePixel(c).forEach((v, i) => expect(v).toBeCloseTo(c[i], 9));
  });
});

describe("heightFogFactor", () => {
  const near = 260;
  const far = 900;

  it("is clear near and full fog at the far end at every height", () => {
    expect(heightFogFactor(10, 0, near, far)).toBe(0);
    for (const dy of [0, 50, 200]) expect(heightFogFactor(far, dy, near, far)).toBeCloseTo(1, 9);
  });

  it("is thinner high up than near the ground in the middle", () => {
    const low = heightFogFactor(600, 0, near, far);
    const high = heightFogFactor(600, 80, near, far);
    expect(high).toBeLessThan(low);
    expect(high).toBeGreaterThan(0);
  });

  it("adds a light ground haze before the distance fog", () => {
    const d = near * 0.9;
    expect(heightFogFactor(d, 0, near, far)).toBeGreaterThan(0);
    expect(heightFogFactor(d, 0, near, far)).toBeLessThanOrEqual(HEIGHT_FOG.haze);
  });

  it("grows with the distance", () => {
    let last = -1;
    for (let d = 0; d <= far; d += 20) {
      const k = heightFogFactor(d, 10, near, far);
      expect(k).toBeGreaterThanOrEqual(last - 1e-12);
      last = k;
    }
  });
});

describe("materialAudit", () => {
  it("counts the materials once and names the toon ones", () => {
    const scene = new THREE.Scene();
    const std = new THREE.MeshStandardMaterial();
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), std));
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(), std));
    const toon = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshToonMaterial());
    toon.name = "left-over";
    scene.add(toon);
    const a = materialAudit(scene);
    expect(a.counts).toEqual({ MeshStandardMaterial: 1, MeshToonMaterial: 1 });
    expect(a.toon).toEqual(["left-over"]);
  });
});

describe("the skater rim (pbr look)", () => {
  it("is 0 facing the eye and full at the edge", () => {
    expect(rimWeight(1)).toBe(0);
    expect(rimWeight(0)).toBe(1);
    expect(rimWeight(0.5)).toBeCloseTo(Math.pow(0.5, RIM_POWER), 9);
  });

  it("adds the rim, keeps an earlier hook, and sets a roughness floor", () => {
    const skin = new THREE.MeshStandardMaterial({ roughness: 0.2 });
    let outfit = 0;
    skin.onBeforeCompile = () => {
      outfit += 1;
    };
    skin.customProgramCacheKey = () => "npc-outfit";
    const plate = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 1 });
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), skin));
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), plate));
    pbrSkater({ root });
    expect(skin.roughness).toBe(CHARACTER_MIN_ROUGHNESS);
    expect(plate.roughness).toBe(0.3);
    expect(skin.customProgramCacheKey()).toBe("npc-outfit-skater-rim");
    const shader = { uniforms: {}, fragmentShader: "#include <common>\n#include <opaque_fragment>", vertexShader: "" };
    skin.onBeforeCompile(shader, null);
    expect(outfit).toBe(1);
    expect(shader.uniforms.uRimStrength).toBe(SKATER_RIM.uRimStrength);
    expect(shader.fragmentShader).toContain("uRimColor");
    // A second call does not stack a second rim.
    pbrSkater({ root });
    expect(skin.customProgramCacheKey()).toBe("npc-outfit-skater-rim");
  });
});
