import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ALBEDO, CONCRETE, GLB_CONCRETE_MAP, PLASTER_SCAN, concreteAlbedo, concreteRoughness, facadeWallAlbedo, glbConcreteTint } from "./pbr-palette.js";
import { MURAL_EDGE_CUT, withMuralEdge } from "./murals.js";
import { concreteClassPatch } from "./landmark-models.js";
import { STYLES } from "../level/geo/styles.js";
import { MURAL_FRAME } from "../level/geo/facade-kit.js";

// The albedo limits of docs/art-direction-pbr.md on the bridge and the mural
// materials (#198, #199): no surface under ALBEDO.floor or over
// ALBEDO.ceiling, concrete in its class band.
const GRAINS = [-1, -0.5, 0, 0.5, 1];

describe("the concrete class of the bridges (#199)", () => {
  it("keeps the class color in the band and under the limits", () => {
    for (const v of CONCRETE.albedo) {
      expect(v).toBeGreaterThanOrEqual(CONCRETE.range[0]);
      expect(v).toBeLessThanOrEqual(CONCRETE.range[1]);
    }
    expect(CONCRETE.range[0]).toBeGreaterThanOrEqual(0.25);
    expect(CONCRETE.range[1]).toBeLessThanOrEqual(0.5);
  });

  it("keeps every geo bridge pixel in 0.25 to 0.5 linear for any scan grain", () => {
    for (const g of [...GRAINS, -5, 5]) {
      for (const v of concreteAlbedo(g)) {
        expect(v).toBeGreaterThanOrEqual(0.25);
        expect(v).toBeLessThanOrEqual(0.5);
        expect(v).toBeGreaterThan(ALBEDO.floor);
        expect(v).toBeLessThan(ALBEDO.ceiling);
      }
    }
  });

  it("gives the grain a visible but small range", () => {
    const lo = concreteAlbedo(-1)[0];
    const hi = concreteAlbedo(1)[0];
    expect(hi / lo).toBeGreaterThan(1.15);
    expect(hi / lo).toBeLessThan(1.4);
  });

  it("keeps the roughness in 0.75 to 0.92", () => {
    for (const t of [-1, 0, 0.3, 1, 2]) {
      const r = concreteRoughness(t);
      expect(r).toBeGreaterThanOrEqual(0.75);
      expect(r).toBeLessThanOrEqual(0.92);
    }
  });

  it("keeps the tinted GLB concrete map in 0.25 to 0.5 linear", () => {
    const tint = glbConcreteTint();
    for (let i = 0; i < 3; i += 1) {
      // The map channels are within the gray min and max of the texels.
      for (const texel of [GLB_CONCRETE_MAP.min, GLB_CONCRETE_MAP.mean[i], GLB_CONCRETE_MAP.max]) {
        const v = texel * tint[i];
        expect(v).toBeGreaterThanOrEqual(0.25);
        expect(v).toBeLessThanOrEqual(0.5);
      }
    }
  });

  it("patches the GLB concrete: class tint, no metal, roughness in the band", () => {
    const m = concreteClassPatch(new THREE.MeshStandardMaterial({ name: "lm_concrete", roughnessMap: new THREE.Texture() }));
    const c = m.color.clone();
    const tint = glbConcreteTint();
    expect(c.r).toBeCloseTo(tint[0], 4);
    expect(c.g).toBeCloseTo(tint[1], 4);
    expect(c.b).toBeCloseTo(tint[2], 4);
    expect(m.metalness).toBe(0);
    const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: "", uniforms: {} };
    m.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain(`roughnessFactor = ${CONCRETE.roughness[0].toFixed(3)}`);
    expect(shader.fragmentShader).toContain(PLASTER_SCAN.mean.toFixed(4));
  });
});

describe("the mural host walls and frames (#198)", () => {
  it("keeps every style wall color with the plaster grain inside the limits", () => {
    for (const s of STYLES) {
      for (const wall of s.walls) {
        for (const g of GRAINS) {
          const c = facadeWallAlbedo(wall, s.brick ? 0 : g);
          expect(Math.max(...c), `${s.id} ${wall}`).toBeLessThanOrEqual(ALBEDO.ceiling + 1e-9);
          expect(Math.max(...c), `${s.id} ${wall}`).toBeGreaterThan(ALBEDO.floor);
        }
      }
    }
  });

  it("makes the grain visible on a plain wall", () => {
    const wall = [0.32, 0.36, 0.42];
    expect(facadeWallAlbedo(wall, 1)[1] / facadeWallAlbedo(wall, -1)[1]).toBeGreaterThan(1.15);
  });

  it("keeps the frame trim under the trim ceiling", () => {
    expect(MURAL_FRAME.ceiling).toBeLessThanOrEqual(ALBEDO.trim);
  });

  it("cuts the mural where the paint coverage is under one half", () => {
    expect(MURAL_EDGE_CUT).toBe(0.5);
    const m = withMuralEdge(new THREE.MeshStandardMaterial());
    const shader = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, vertexShader: "", uniforms: {} };
    m.onBeforeCompile(shader);
    expect(shader.fragmentShader).toContain("texture2D(roughnessMap, vRoughnessMapUv).r < 0.500) discard;");
  });
});
