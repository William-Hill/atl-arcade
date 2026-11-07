import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MATERIAL_GRADE, gradeValues, installMaterialGrade } from "./pbr-look.js";
import { districtLook, timeGrade } from "./pbr-palette.js";

describe("gradeValues (#195)", () => {
  it("multiplies the time saturation by the district saturation and keeps the tint", () => {
    const g = { contrast: 1.14, saturation: 1.06, warm: 0.35, lift: 0.01 };
    const d = { saturation: 1.1, tint: [1.03, 1, 0.96] };
    const v = gradeValues(g, d);
    expect(v.contrast).toBe(1.14);
    expect(v.sat).toBeCloseTo(1.166, 6);
    expect(v.warm).toBe(0.35);
    expect(v.lift).toBe(0.01);
    expect(v.tint).toEqual([1.03, 1, 0.96]);
    // A copy: a later change to the district does not change the values.
    d.tint[0] = 2;
    expect(v.tint[0]).toBe(1.03);
  });

  it("gives the day grade for a noon sun in a neutral district", () => {
    const v = gradeValues(timeGrade(60, 0), districtLook({}));
    expect(v.contrast).toBeGreaterThan(1);
    expect(v.lift).toBe(0);
  });
});

describe("installMaterialGrade (#195)", () => {
  it("adds the grade before the tone mapping, only in a draw with tone mapping", () => {
    installMaterialGrade();
    const C = THREE.ShaderChunk;
    expect(C.tonemapping_pars_fragment).toContain("uniform PbrMaterialGrade pbrMaterialGrade;");
    expect(C.tonemapping_pars_fragment).toContain("vec3 pbrGrade(");
    const f = C.tonemapping_fragment;
    expect(f.trim().startsWith("#if defined( TONE_MAPPING )")).toBe(true);
    expect(f.indexOf("pbrGrade(")).toBeLessThan(f.indexOf("toneMapping("));
    // A material with no uniform value reads 0: the grade is off.
    expect(f).toContain("pbrMaterialGrade.on > 0.5");
  });

  it("gives every built-in material the one shared value object", () => {
    installMaterialGrade();
    for (const shader of Object.values(THREE.ShaderLib)) expect(shader.uniforms.pbrMaterialGrade.value).toBe(MATERIAL_GRADE);
    // Three.js clones the ShaderLib uniforms per material; a plain object
    // stays a reference, so a write to MATERIAL_GRADE reaches each material.
    const copy = THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms);
    expect(copy.pbrMaterialGrade.value).toBe(MATERIAL_GRADE);
  });

  it("changes the chunks one time only", () => {
    installMaterialGrade();
    const once = THREE.ShaderChunk.tonemapping_pars_fragment;
    installMaterialGrade();
    expect(THREE.ShaderChunk.tonemapping_pars_fragment).toBe(once);
    expect(once.match(/struct PbrMaterialGrade/g)).toHaveLength(1);
  });
});
