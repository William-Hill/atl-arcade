import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { HEAD_TOP, PED_ROUGHNESS, WALK, createPedsView, patchPedVertex, pedGeometry, pedStride } from "./peds-view.js";
import { POSE } from "../sim/ped-activity.js";
import { MATERIAL_CLASSES } from "./pbr-palette.js";

describe("peds view", () => {
  it("builds one figure with every part, about 1.77 m to the top of the head", () => {
    const g = pedGeometry();
    const n = g.attributes.position.count;
    for (const name of ["normal", "color", "pedPart", "pedInfo"]) expect(g.attributes[name].count, name).toBe(n);
    g.computeBoundingBox();
    expect(g.boundingBox.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(HEAD_TOP).toBeCloseTo(1.77, 2);
    // A low-poly figure: under 1500 triangles with every optional part.
    expect(n / 3).toBeLessThan(1500);
    // The vertex attributes, with the 10 instance slots (matrix 4, color,
    // skin, pants, hair, accent, anim), stay inside 16.
    expect(Object.keys(g.attributes).length + 10).toBeLessThanOrEqual(16);
  });

  it("swings the limbs with the walk, more for a jog, and not in a pose (#133)", () => {
    expect(pedStride({ speed: 0, pose: POSE.walk })).toBe(0);
    expect(pedStride({ speed: 1.1, pose: POSE.walk })).toBe(1);
    expect(pedStride({ speed: 3, pose: POSE.walk })).toBe(1);
    expect(pedStride({ speed: 3, pose: POSE.jog })).toBe(WALK.jog);
    expect(pedStride({ speed: 2.4, pose: POSE.jog })).toBeGreaterThan(1);
    for (const pose of [POSE.sit, POSE.cheer, POSE.talk]) expect(pedStride({ speed: 1.2, pose })).toBe(0);
    // A walker from an old state with no pose walks.
    expect(pedStride({ speed: 1.1 })).toBe(1);
  });

  it("marks the parts under the knee, so a seated walker's shins hang down (#133)", () => {
    const g = pedGeometry();
    const part = g.attributes.pedPart;
    const pos = g.attributes.position;
    let lower = 0;
    for (let i = 0; i < part.count; i += 1) {
      if (part.getZ(i) >= 0) continue;
      lower += 1;
      // A lower leg vertex: a leg side, below the knee joint.
      expect(Math.abs(part.getX(i))).toBe(1);
      expect(pos.getY(i)).toBeLessThan(WALK.knee + 0.03);
    }
    expect(lower).toBeGreaterThan(0);
  });

  it("patches the main and the override materials", () => {
    for (const lib of ["normal", "toon", "standard"]) {
      const shader = { vertexShader: THREE.ShaderLib[lib].vertexShader };
      patchPedVertex(shader);
      expect(shader.vertexShader, lib).toContain("bool pedIs");
      expect(shader.vertexShader, lib).toContain("if (!pedOn) transformed = vec3(0.0);");
      // The pose (#133) is the 4th value of the anim attribute.
      expect(shader.vertexShader, lib).toContain("attribute vec4 pedAnim;");
      expect(shader.vertexShader, lib).toContain("pedAnim.w");
      expect(shader.vertexShader, lib).not.toContain("#include <begin_vertex>");
    }
  });

  it("gives the pbr walkers skin roughness on the skin and cloth roughness elsewhere (#157)", () => {
    const within = (v, [a, b]) => v >= a && v <= b;
    expect(within(PED_ROUGHNESS.skin, MATERIAL_CLASSES.skin.roughness)).toBe(true);
    expect(within(PED_ROUGHNESS.cloth, MATERIAL_CLASSES.cloth.roughness)).toBe(true);
    const view = createPedsView({ peds: [] }, { look: "pbr" });
    const mat = view.group.children[0].material;
    expect(mat.type).toBe("MeshStandardMaterial");
    expect(mat.roughness).toBe(PED_ROUGHNESS.cloth);
    expect(mat.metalness).toBe(0);
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
    mat.onBeforeCompile(shader);
    expect(shader.vertexShader).toContain("varying float vPedSkin;");
    expect(shader.vertexShader).toContain("vPedSkin = pedCh == 3 ? 1.0 : 0.0;");
    expect(shader.fragmentShader).toContain("varying float vPedSkin;");
    expect(shader.fragmentShader).toContain(`roughnessFactor = mix(roughnessFactor, ${PED_ROUGHNESS.skin.toFixed(3)}, vPedSkin);`);
  });

  it("keeps the toon walkers on the toon ramp, with no roughness patch", () => {
    const mat = createPedsView({ peds: [] }, { look: "toon" }).group.children[0].material;
    expect(mat.type).toBe("MeshToonMaterial");
    const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader };
    mat.onBeforeCompile(shader);
    expect(shader.vertexShader).not.toContain("vPedSkin");
    expect(shader.fragmentShader).not.toContain("vPedSkin");
  });
});
