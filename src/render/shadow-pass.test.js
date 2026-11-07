import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { SHADOW_DROP, capsuleOutside, createShadowPass, shadowLength } from "./shadow-pass.js";
import { SHADOW_STAND_INS } from "./skin-merge.js";

// A camera at the origin looking down -z, far 100 m.
function view() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.updateMatrixWorld();
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  return { camera, planes: frustum.planes };
}

describe("shadowLength", () => {
  it("reaches SHADOW_DROP under the sphere, and is null for a light from below", () => {
    expect(shadowLength(1, -1)).toBeCloseTo(2 + SHADOW_DROP);
    expect(shadowLength(1, -0.5)).toBeCloseTo((2 + SHADOW_DROP) * 2);
    expect(shadowLength(1, 0.2)).toBe(null);
  });
});

describe("capsuleOutside", () => {
  const { planes } = view();
  const down = new THREE.Vector3(0, -1, 0);
  it("keeps a caster in view and one whose shadow falls into view", () => {
    expect(capsuleOutside(new THREE.Vector3(0, 0, -20), 1, down, 30, planes)).toBe(false);
    // Behind the camera, with a low sun from behind: the shadow runs ahead.
    const sun = new THREE.Vector3(0, -0.3, -1).normalize();
    expect(capsuleOutside(new THREE.Vector3(0, 2, 10), 1, sun, 100, planes)).toBe(false);
  });
  it("culls a caster behind the camera whose shadow falls behind it too", () => {
    const sun = new THREE.Vector3(0, -0.3, 1).normalize();
    expect(capsuleOutside(new THREE.Vector3(0, 0, 10), 1, sun, 100, planes)).toBe(true);
  });
});

describe("createShadowPass", () => {
  function setup() {
    const { camera } = view();
    const seen = [];
    const renderer = {
      shadowMap: {
        enabled: true,
        autoUpdate: true,
        needsUpdate: false,
        render(lights, scene) {
          scene.traverse((o) => o.isMesh && seen.push([o.name, o.castShadow, o.visible]));
        },
      },
    };
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight();
    sun.position.set(0, 10, -10);
    sun.target.position.set(0, 0, 0);
    scene.add(sun, sun.target);
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.computeBoundingSphere();
    const front = new THREE.Mesh(box);
    front.name = "front";
    front.position.set(0, 0, -20);
    const back = new THREE.Mesh(box);
    back.name = "back";
    back.position.set(0, 0, 40);
    const standIn = new THREE.Mesh(box);
    standIn.name = "standIn";
    standIn.visible = false;
    standIn.userData.standIn = [];
    for (const m of [front, back, standIn]) m.castShadow = true;
    scene.add(front, back, standIn);
    scene.updateMatrixWorld();
    SHADOW_STAND_INS.add(standIn);
    return { renderer, scene, camera, sun, seen, back, standIn };
  }

  it("shows the stand-ins and culls the off-screen caster only during the draw", () => {
    const { renderer, scene, camera, sun, seen, back, standIn } = setup();
    const pass = createShadowPass(renderer);
    renderer.shadowMap.render([sun], scene, camera);
    expect(seen).toEqual([
      ["front", true, true],
      ["back", false, true],
      ["standIn", true, true],
    ]);
    expect(pass.info.culled).toBe(1);
    expect(back.castShadow).toBe(true);
    expect(standIn.visible).toBe(false);
    SHADOW_STAND_INS.delete(standIn);
  });

  it("culls nothing with cull: false", () => {
    const { renderer, scene, camera, sun, seen, standIn } = setup();
    createShadowPass(renderer, { cull: false });
    renderer.shadowMap.render([sun], scene, camera);
    expect(seen.every(([, cast]) => cast)).toBe(true);
    SHADOW_STAND_INS.delete(standIn);
  });
});

describe("createShadowPass with a batch", () => {
  it("hides the off-screen instances while the batch builds its shadow list, then shows them", () => {
    const { camera } = view();
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight();
    sun.position.set(0, 10, -10);
    scene.add(sun, sun.target);
    const batch = new THREE.BatchedMesh(2, 100, 100, new THREE.MeshBasicMaterial());
    batch.castShadow = true;
    const g = batch.addGeometry(new THREE.BoxGeometry(1, 1, 1));
    const front = batch.addInstance(g);
    const back = batch.addInstance(g);
    batch.setMatrixAt(front, new THREE.Matrix4().makeTranslation(0, 0, -20));
    batch.setMatrixAt(back, new THREE.Matrix4().makeTranslation(0, 0, 40));
    scene.add(batch);
    scene.updateMatrixWorld();
    const seen = [];
    batch.onBeforeShadow = () => seen.push([batch.getVisibleAt(front), batch.getVisibleAt(back)]);
    const renderer = {
      shadowMap: {
        enabled: true,
        autoUpdate: true,
        render() {
          batch.onBeforeShadow();
        },
      },
    };
    const pass = createShadowPass(renderer);
    renderer.shadowMap.render([sun], scene, camera);
    expect(seen).toEqual([[true, false]]);
    expect(pass.info.culledInstances).toBe(1);
    expect(batch.getVisibleAt(back)).toBe(true);
  });
});
