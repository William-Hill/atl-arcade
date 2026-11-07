import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MATERIAL_GRADE, SKY_SH, gradeValues, installMaterialGrade, installSkySh, setSkySh, validSkySh } from "./pbr-look.js";
import { shFromCubeFaces } from "./look.js";
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

describe("sky SH (#191)", () => {
  const size = 8;
  const face = (rgb) => {
    const a = new Float32Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) a.set([...rgb, 1], i * 4);
    return a;
  };
  // three's SphericalHarmonics3: radiance and irradiance from 27 numbers.
  const asSh = (c) => {
    const sh = new THREE.SphericalHarmonics3();
    sh.coefficients.forEach((v, i) => v.set(c[i * 3], c[i * 3 + 1], c[i * 3 + 2]));
    return sh;
  };

  it("projects a uniform sky to radiance L and irradiance PI L in every direction", () => {
    const c = shFromCubeFaces(Array.from({ length: 6 }, () => face([0.2, 0.4, 0.8])), size);
    const sh = asSh(c);
    for (const d of [new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0)]) {
      const l = sh.getAt(d, new THREE.Vector3());
      const e = sh.getIrradianceAt(d, new THREE.Vector3());
      expect(l.x).toBeCloseTo(0.2, 2);
      expect(l.z).toBeCloseTo(0.8, 2);
      expect(e.y).toBeCloseTo(Math.PI * 0.4, 2);
    }
  });

  it("puts a bright top face (+y, face 2) above a dark ground (face 3)", () => {
    const faces = [0, 1, 2, 3, 4, 5].map((f) => face(f === 2 ? [1, 1, 1] : f === 3 ? [0, 0, 0] : [0.5, 0.5, 0.5]));
    const sh = asSh(shFromCubeFaces(faces, size));
    const up = sh.getIrradianceAt(new THREE.Vector3(0, 1, 0), new THREE.Vector3()).x;
    const down = sh.getIrradianceAt(new THREE.Vector3(0, -1, 0), new THREE.Vector3()).x;
    expect(up).toBeGreaterThan(down + 0.5);
  });

  it("puts each side face on its own axis (+x face 0, +z face 4 for CubeCamera)", () => {
    for (const [f, axis] of [[0, "x"], [4, "z"]]) {
      const faces = [0, 1, 2, 3, 4, 5].map((i) => face(i === f ? [1, 1, 1] : [0.2, 0.2, 0.2]));
      const sh = asSh(shFromCubeFaces(faces, size));
      const at = (v) => sh.getIrradianceAt(new THREE.Vector3(...v), new THREE.Vector3()).x;
      const pos = axis === "x" ? [1, 0, 0] : [0, 0, 1];
      const neg = pos.map((v) => -v);
      const side = axis === "x" ? [0, 0, 1] : [1, 0, 0];
      expect(at(pos)).toBeGreaterThan(at(neg) + 0.3);
      expect(at(pos)).toBeGreaterThan(at(side) + 0.1);
    }
  });

  it("refuses a failed read (zeros, NaN, wrong length)", () => {
    expect(validSkySh(new Array(27).fill(0))).toBe(false);
    expect(validSkySh([NaN, ...new Array(26).fill(1)])).toBe(false);
    expect(validSkySh(new Array(9).fill(1))).toBe(false);
    expect(validSkySh(undefined)).toBe(false);
    expect(validSkySh(new Array(27).fill(0.3))).toBe(true);
  });

  it("swaps both env lookups for the SH and shares one array with the materials", () => {
    installSkySh();
    const chunk = THREE.ShaderChunk.envmap_physical_pars_fragment;
    expect(chunk).toContain("pbrShIrradiance( envMapRotation * worldNormal )");
    expect(chunk).toContain("pbrShRadiance( skyDir )");
    // The retro and anisotropy variants (not used by the game) keep the map.
    expect(chunk.match(/textureCubeUV/g).length).toBe(1);
    expect(THREE.ShaderLib.standard.uniforms.pbrSkySh.value).toBe(SKY_SH);
    expect(THREE.ShaderLib.physical.uniforms.pbrSkySh.value).toBe(SKY_SH);
    setSkySh(Array.from({ length: 27 }, (_, i) => i));
    expect(SKY_SH.c2.toArray()).toEqual([6, 7, 8]);
    const m = new THREE.MeshStandardMaterial();
    const u = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    expect(u.pbrSkySh.value.c2).toBe(SKY_SH.c2);
    m.dispose();
  });
});
