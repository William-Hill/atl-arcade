import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { CROWD_FRAMES, bakePose, createPedCrowd, crowdFrame, crowdGrow, crowdLod, staticMeshes } from "./ped-crowd.js";

// A two-bone strip: the lower vertices follow bone 0, the upper ones bone 1.
function strip() {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  g.setIndex([0, 1, 2, 2, 1, 3]);
  const b0 = new THREE.Bone();
  const b1 = new THREE.Bone();
  b1.position.y = 1;
  b0.add(b1);
  const mesh = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
  mesh.name = "walker_lod1";
  const root = new THREE.Group();
  root.add(b0, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([b0, b1]));
  return { root, mesh, b1 };
}

describe("the baked walker crowd", () => {
  it("picks the walk pose from the stride phase and the idle pose when slow", () => {
    expect(crowdFrame(0, 1.2)).toBe(0);
    expect(crowdFrame(Math.PI, 1.2)).toBe(CROWD_FRAMES / 2);
    expect(crowdFrame(Math.PI * 2 * 3 + 0.01, 1.2)).toBe(0);
    expect(crowdFrame(Math.PI * 2 - 1e-6, 1.2)).toBe(CROWD_FRAMES - 1);
    expect(crowdFrame(1, 0.05)).toBe(CROWD_FRAMES);
    expect(crowdFrame(1, NaN)).toBe(CROWD_FRAMES);
  });

  it("grows the walkers in over the outer band of the pool", () => {
    expect(crowdGrow(0, 0, [0, 0], 200)).toBe(1);
    expect(crowdGrow(185, 0, [0, 0], 200)).toBeCloseTo(0.5);
    expect(crowdGrow(250, 0, [0, 0], 200)).toBe(0);
  });

  it("picks the LOD from the distance, as the rigs do", () => {
    expect(crowdLod(3, [0, 25])).toBe(0);
    expect(crowdLod(25, [0, 25])).toBe(1);
    expect(crowdLod(80, [0, 25])).toBe(1);
    expect(crowdLod(80, [0])).toBe(0);
  });

  it("bakes the bone pose into static positions and normals", () => {
    const { root, mesh, b1 } = strip();
    const rest = bakePose(mesh, root).attributes.position.array;
    expect([...rest]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0].map((v) => expect.closeTo(v, 6)));
    b1.rotation.x = Math.PI / 2;
    const bent = bakePose(mesh, root);
    const p = bent.attributes.position;
    // The upper vertices turn about the bone at y = 1: (0, 1, 0) stays, the
    // lower ones do not move, and the upper normals turn with them.
    expect(p.getY(0)).toBeCloseTo(0);
    expect(p.getY(2)).toBeCloseTo(1);
    expect(p.getZ(2)).toBeCloseTo(0);
    expect(bent.attributes.normal.getY(2)).toBeCloseTo(-1);
    expect(bent.attributes.normal.getZ(0)).toBeCloseTo(1);
    expect(bent.index.count).toBe(6);
    expect(bent.attributes.skinIndex).toBeUndefined();
  });

  it("draws each live walker once, not the ones drawn as rigged people", async () => {
    const { root } = strip();
    const clip = new THREE.AnimationClip("walk", 1, [new THREE.NumberKeyframeTrack(".position[x]", [0, 1], [0, 0])]);
    const gltf = { scene: root, animations: [clip] };
    const crowd = await createPedCrowd({ walker: gltf }, { people: ["walker"], kindOf: () => "walker", size: 4 });
    const peds = [0, 1, 2, 3].map((id) => ({ id, live: id !== 3, x: id, y: 0, z: 0, fx: 0, fz: 1, speed: 1.2, phase: id }));
    const eye = { x: 0, y: 1.7, z: 0 };
    crowd.update({ peds, focus: [0, 0], radius: 200 }, new Set([1]), eye);
    expect(crowd.stats.drawn).toBe(2);
    crowd.update({ peds, focus: [0, 0], radius: 200 }, new Set(), eye);
    expect(crowd.stats.drawn).toBe(3);
  });

  it("bakes a static LOD with its child meshes (the stroller wheels)", () => {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    body.name = "stroller_lod0";
    body.position.set(0, 1, 0);
    const wheels = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    wheels.name = "stroller_wheels_front";
    wheels.position.set(0, -1, 0);
    body.add(wheels);
    root.add(body);
    const g = staticMeshes(body, root);
    expect(g.attributes.position.count).toBe(48);
    g.computeBoundingBox();
    expect(g.boundingBox.min.y).toBeCloseTo(-0.5);
    expect(g.boundingBox.max.y).toBeCloseTo(1.5);
  });

  it("culls each walker, not the whole batch", async () => {
    const { root } = strip();
    const crowd = await createPedCrowd({ walker: { scene: root, animations: [] } }, { people: ["walker"], kindOf: () => "walker", size: 2 });
    const mesh = crowd.group.children[0];
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.perObjectFrustumCulled).toBe(true);
  });
});
