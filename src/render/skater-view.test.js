import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { createSkaterView, grindLean } from "./skater-view.js";
import { CLIPS } from "./skater-anim.js";

describe("place (#189)", () => {
  it("moves the group to the state position and heading, with no clip step", () => {
    const view = createSkaterView({ lean: false });
    view.place({ position: [3, 1.5, -7], yaw: 1.2 });
    expect(view.group.position.toArray()).toEqual([3, 1.5, -7]);
    expect(view.group.rotation.y).toBeCloseTo(1.2);
  });
});

// The spawn state of a new run: standing, speed 0, the first tick.
const spawn = (yaw) => ({ state: "rolling", speed: 0, yaw, position: [337, 24, -1.3], tick: 0, backward: false, style: null });
const FIVE_DEG = (5 * Math.PI) / 180;

describe("respawn (#231)", () => {
  it("faces the new heading at once, after a carve on the old heading", () => {
    const view = createSkaterView();
    // Ride and carve to the left on the old heading.
    for (let t = 1; t <= 30; t += 1) view.sync({ state: "rolling", speed: 6, yaw: -2 + t * 0.04, position: [t, 0, 0], tick: t, pushing: true, style: null }, 1 / 60);
    expect(Math.abs(view.lean)).toBeGreaterThan(0);
    view.respawn(spawn(1.464));
    expect(Math.abs(view.group.rotation.y - 1.464)).toBeLessThan(FIVE_DEG);
    expect(view.group.rotation.x).toBe(0);
    expect(view.group.rotation.z).toBe(0);
    expect(view.lean).toBe(0);
    expect(view.group.position.toArray()).toEqual([337, 24, -1.3]);
    // The next frame measures no turn from the old heading.
    view.sync(spawn(1.464), 1 / 60);
    expect(Math.abs(view.group.rotation.y - 1.464)).toBeLessThan(FIVE_DEG);
    expect(Math.abs(view.lean)).toBeLessThan(1e-6);
  });
});

// A small rig for the view: hips and two legs with Mixamo names, a skinned
// mesh, empty clips, and a face that records its last state.
function fakeModel() {
  const root = new THREE.Group();
  const bone = (name, y, parent) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(0, y, 0);
    parent.add(b);
    return b;
  };
  const hips = bone("Hips", 0.95, root);
  const bones = [hips];
  for (const [side, x] of [["Left", 0.1], ["Right", -0.1]]) {
    const up = bone(`${side}UpLeg`, 0, hips);
    up.position.x = x;
    const leg = bone(`${side}Leg`, -0.45, up);
    const foot = bone(`${side}Foot`, -0.42, leg);
    bones.push(up, leg, foot);
  }
  const geo = new THREE.BoxGeometry();
  const n = geo.attributes.position.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
  const skinnedMesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  root.add(skinnedMesh);
  skinnedMesh.bind(new THREE.Skeleton(bones));
  const face = {
    eyes: "open",
    mouth: "neutral",
    set(eyes, mouth) {
      this.eyes = eyes;
      this.mouth = mouth;
    },
  };
  // An empty clip for each clip name, so the view has an action to blend.
  const animations = Object.keys(CLIPS).map((name) => new THREE.AnimationClip(name, 1, []));
  return { root, animations, skinnedMesh, face };
}

describe("respawn: the face and the foot IK of the old run (review of #232)", () => {
  it("drops the cheer face and the old IK plan", () => {
    // Flat ground 0.1 m over the skater root, so the IK has a plan.
    const view = createSkaterView({ footIk: true, sampleGround: () => ({ height: 0.1, normal: [0, 1, 0] }) });
    view.attachModel(fakeModel());
    const ride = (t) => ({ state: "rolling", speed: 4, yaw: 0, position: [t * 0.1, 0, 0], tick: t, pushing: false, style: null });
    view.cheer();
    for (let t = 1; t <= 20; t += 1) view.sync(ride(t), 1 / 60);
    expect(view.footIk.plan).not.toBe(null);
    const cheering = { ...view.face };
    view.respawn(spawn(1.464));
    expect(view.footIk.plan).toBe(null);
    // The next frame has the face of a new run, not the cheer.
    const fresh = createSkaterView({ footIk: true, sampleGround: () => ({ height: 0.1, normal: [0, 1, 0] }) });
    fresh.attachModel(fakeModel());
    fresh.sync(spawn(1.464), 1 / 60);
    view.sync(spawn(1.464), 1 / 60);
    expect(view.face).toEqual(fresh.face);
    expect(cheering).not.toEqual(fresh.face);
  });
});

// Axes: yaw 0 faces +x and positive yaw turns left (toward -z), so +z is the
// skater's right. A positive balance makes the skater fall off the right.
function upAfterLean(balance) {
  const g = new THREE.Object3D();
  g.rotation.set(grindLean({ state: "grind", grind: { balance } }), 0, 0, "YXZ");
  return new THREE.Vector3(0, 1, 0).applyEuler(g.rotation);
}

describe("grind lean", () => {
  it("tilts the capsule toward the side it will fall off", () => {
    expect(upAfterLean(0.5).z).toBeGreaterThan(0.1); // right
    expect(upAfterLean(-0.5).z).toBeLessThan(-0.1); // left
  });

  it("is zero off the rail", () => {
    expect(grindLean({ state: "rolling", grind: null })).toBe(0);
  });
});
