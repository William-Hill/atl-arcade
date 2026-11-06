import * as THREE from "three";
import { SKATER_BODY } from "../sim/skate/constants.js";
import { cheer, createFaceState, stepFace } from "./face-anim.js";
import { CLIPS, beatPhase, createAnimState, grooveRate, stepAnim, stepFacing } from "./skater-anim.js";
import { createBlend, leanLayers, leanTarget, rollFor, startBlend, stepBlend, stepLean } from "./anim-blend.js";
import { ikWanted, legBoneNames, planFeet, solveTwoBone, stepIkWeight } from "./foot-ik.js";

// The skater bound to the controller output. It starts as a capsule (the
// nose cone shows the facing). attachModel() swaps in a GLB skater and plays
// its clips from the state -> clip table in skater-anim.js.
//
// Options (#107):
// - lean: the body banks into a carve, and the carve clips add a lean pose
//   on top of the coast and the push.
// - footIk: the skates touch the ground (stairs, ramps). It needs
//   `sampleGround(x, z, y)`, the level ground sampler.
export function createSkaterView({ lean: leanOn = true, footIk = false, sampleGround = null } = {}) {
  const group = new THREE.Group();
  group.name = "skater";
  const bodyLength = SKATER_BODY.height - 2 * SKATER_BODY.radius;
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(SKATER_BODY.radius, bodyLength, 4, 12),
    new THREE.MeshStandardMaterial({ color: 0xff5fb2, roughness: 0.5 }),
  );
  body.position.y = SKATER_BODY.height / 2;
  body.castShadow = true;
  group.add(body);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.15, 0.4, 8),
    new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.5 }),
  );
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(SKATER_BODY.radius + 0.1, 0.5, 0);
  group.add(nose);

  let model = null;
  let mixer = null;
  // The model turns inside this pivot to ride backward.
  const pivot = new THREE.Group();
  pivot.name = "skater-facing";
  group.add(pivot);
  let facing = 0;
  // The beat clock (s since beat 0). Groove clips play in phase with it.
  let clock = 0;
  let bpm;
  const actions = new Map();
  let anim = createAnimState();
  let current = null;
  let faceState = createFaceState();
  let heldFace = null;

  // The clip weights (anim-blend.js). A clip that fades out keeps its time,
  // so a change back to it in the middle of the fade does not pop.
  let blend = null;
  // The carve lean: the bank angle (rad) and the additive lean poses.
  let lean = 0;
  const leanActions = new Map();
  // Foot IK: the leg bones, the IK weight, and the cost of the last frame.
  let ikOn = footIk;
  let ground = sampleGround;
  let legs = null;
  let ikWeight = 0;
  let ikMs = 0;
  let ikPlan = null;
  // The bone values before the IK of the last frame. They go back before
  // the next mixer update, so a bone with no clip track does not drift.
  const saved = [];

  function enter(name, fade) {
    const next = actions.get(name);
    if (!next) return;
    const w0 = blend?.weights[name] ?? 0;
    // A clip with no weight starts again. A clip that still fades out
    // keeps its time. A one-time clip (a jump, a landing) always starts
    // again.
    if (w0 <= 0 || CLIPS[name]?.once) {
      next.reset();
      if (CLIPS[name]?.beat) {
        next.timeScale = grooveRate(bpm);
        next.time = beatPhase(clock, next.getClip().duration, bpm);
      } else if (CLIPS[name]?.tempo) {
        next.timeScale = grooveRate(bpm);
      }
    }
    if (!next.isScheduled()) next.play();
    blend = blend ? startBlend(blend, name, fade) : createBlend(name);
    current = next;
  }

  function applyWeights() {
    for (const [name, a] of actions) {
      const w = blend.weights[name] ?? 0;
      if (w > 0) {
        if (!a.isScheduled()) a.play();
        a.enabled = true;
        a.setEffectiveWeight(w);
      } else if (a.isScheduled()) a.stop();
    }
  }

  function applyLean() {
    const layers = leanLayers(leanOn ? lean : 0, anim.clip);
    // A base clip fades in: the layers fade with its weight.
    const baseWeight = blend.weights[anim.clip] ?? 0;
    for (const [name, a] of leanActions) {
      const w = (layers[name] ?? 0) * baseWeight;
      if (w > 1e-3) {
        if (!a.isScheduled()) a.play();
        a.setEffectiveWeight(w);
      } else if (a.isScheduled()) a.stop();
    }
  }

  function restoreBones() {
    for (const s of saved) {
      s.bone.position.copy(s.position);
      s.bone.quaternion.copy(s.quaternion);
    }
    saved.length = 0;
  }

  function saveBone(bone) {
    saved.push({ bone, position: bone.position.clone(), quaternion: bone.quaternion.clone() });
  }

  // Turns a bone so that the direction `from` (world) goes to `to`.
  function turnBone(bone, from, to) {
    _q.setFromUnitVectors(from.normalize(), to.normalize());
    bone.getWorldQuaternion(_qa);
    _qa.premultiply(_q);
    bone.parent.getWorldQuaternion(_qb).invert();
    bone.quaternion.copy(_qb.multiply(_qa));
    bone.updateMatrixWorld(true);
  }

  function applyFootIk(state) {
    const t0 = performance.now();
    group.updateMatrixWorld(true);
    const pos = (bone) => bone.getWorldPosition(_v).toArray();
    const feet = {};
    for (const side of ["left", "right"]) {
      const l = legs[side];
      feet[side] = { ankle: pos(l.foot), toe: l.toe ? pos(l.toe) : null };
    }
    const plan = planFeet({ rootY: state.position[1], feet, sample: ground, weight: ikWeight });
    for (const b of legs.all) saveBone(b);
    if (plan.pelvis) {
      legs.hips.getWorldPosition(_v);
      _v.y += plan.pelvis;
      legs.hips.parent.worldToLocal(_v);
      legs.hips.position.copy(_v);
      legs.hips.updateMatrixWorld(true);
    }
    for (const side of ["left", "right"]) {
      const l = legs[side];
      // The foot orientation of the clip, before the leg turns.
      l.foot.getWorldQuaternion(_qf);
      const hip = pos(l.upLeg);
      const knee = pos(l.leg);
      const ankle = pos(l.foot);
      const sol = solveTwoBone(hip, knee, ankle, plan[side].target, knee);
      turnBone(l.upLeg, _a.fromArray(knee).sub(_b.fromArray(hip)), _c.fromArray(sol.knee).sub(_b));
      l.leg.getWorldPosition(_b);
      l.foot.getWorldPosition(_a);
      turnBone(l.leg, _a.sub(_b), _c.fromArray(sol.ankle).sub(_b));
      // The skate tilts toward the ground normal.
      const tilt = plan[side].tilt;
      _q.setFromAxisAngle(_a.fromArray(tilt.axis), tilt.angle);
      _qf.premultiply(_q);
      l.foot.parent.getWorldQuaternion(_qb).invert();
      l.foot.quaternion.copy(_qb.multiply(_qf));
      l.foot.updateMatrixWorld(true);
    }
    ikPlan = plan;
    ikMs = performance.now() - t0;
  }

  return {
    group,
    body,
    get model() {
      return model;
    },
    get clip() {
      return model ? anim.clip : null;
    },
    get facing() {
      return facing;
    },
    // The face decal state: { eyes, mouth }, or null without a face.
    get face() {
      return model?.face ? { eyes: model.face.eyes, mouth: model.face.mouth } : null;
    },
    // Holds the face in one state ({ eyes, mouth }), for the tests. null
    // gives the face back to the animation.
    holdFace(state) {
      heldFace = state ? { eyes: state.eyes, mouth: state.mouth } : null;
    },
    // Stops the clips (true) or plays them again (false), for the tests.
    freezePose(frozen) {
      if (mixer) mixer.timeScale = frozen ? 0 : 1;
    },
    // A banked combo: Nia cheers.
    cheer() {
      faceState = cheer(faceState);
    },
    // The effective weight of each clip in the mixer, for the tests. The
    // lean poses have the keys "lean:carve_left" and "lean:carve_right".
    get weights() {
      const out = {};
      for (const [name, a] of actions) if (a.isScheduled()) out[name] = Number(a.getEffectiveWeight().toFixed(3));
      for (const [name, a] of leanActions) if (a.isScheduled()) out[`lean:${name}`] = Number(a.getEffectiveWeight().toFixed(3));
      return out;
    },
    // The bank angle (rad) of the carve lean.
    get lean() {
      return lean;
    },
    // Foot IK: on or off, the IK weight (0 to 1), and the time (ms) of the
    // last IK frame.
    get footIk() {
      return { on: ikOn && Boolean(legs) && Boolean(ground), weight: ikWeight, ms: ikMs, plan: ikPlan };
    },
    setFootIk(on) {
      ikOn = Boolean(on);
      if (!ikOn) {
        restoreBones();
        ikWeight = 0;
      }
    },
    setGround(sample) {
      ground = sample;
    },
    setLean(on) {
      leanOn = Boolean(on);
    },
    // loaded: the result of loadSkaterModel().
    attachModel(loaded) {
      model = loaded;
      body.visible = false;
      nose.visible = false;
      pivot.add(loaded.root);
      mixer = new THREE.AnimationMixer(loaded.root);
      actions.clear();
      leanActions.clear();
      saved.length = 0;
      for (const clip of loaded.animations) {
        const action = mixer.clipAction(clip);
        if (CLIPS[clip.name]?.once) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions.set(clip.name, action);
      }
      // The lean poses: the carve clips less the coast, as additive layers.
      const coast = loaded.animations.find((c) => c.name === "coast");
      for (const side of ["carve_left", "carve_right"]) {
        const carve = loaded.animations.find((c) => c.name === side);
        if (!coast || !carve) continue;
        const clip = THREE.AnimationUtils.makeClipAdditive(poseClip(carve, `lean_${side}`), 0, poseClip(coast, "lean_ref"));
        const action = mixer.clipAction(clip);
        leanActions.set(side, action);
      }
      // The leg bones for the foot IK, by name.
      const bones = loaded.skinnedMesh.skeleton.bones;
      const names = legBoneNames(bones.map((b) => b.name));
      const byName = (n) => bones.find((b) => b.name === n) ?? null;
      legs = null;
      if (names) {
        const side = (k) => ({ upLeg: byName(names[k].upLeg), leg: byName(names[k].leg), foot: byName(names[k].foot), toe: names[k].toe ? byName(names[k].toe) : null });
        legs = { hips: byName(names.hips), left: side("left"), right: side("right") };
        legs.all = [legs.hips, ...["left", "right"].flatMap((k) => [legs[k].upLeg, legs[k].leg, legs[k].foot])];
      }
      anim = createAnimState();
      faceState = createFaceState();
      current = null;
      blend = null;
      lean = 0;
      ikWeight = 0;
      facing = 0;
      pivot.rotation.y = 0;
      enter(anim.clip, 0);
      applyWeights();
    },
    // Moves the group to the state position and heading only, with no clip,
    // lean or IK update. A view out of the camera uses it (#189), so its
    // body and its shadow do not stay at an old place.
    place(state) {
      group.position.set(state.position[0], state.position[1], state.position[2]);
      group.rotation.y = state.yaw;
    },
    // beat: optional { time, bpm } from the game beat clock. Without it the
    // view counts its own time at the default BPM.
    sync(state, dt = 1 / 60, beat = null) {
      group.position.set(state.position[0], state.position[1], state.position[2]);
      let spin = 0;
      let rock = 0;
      // Style moves: "spin" turns the body once. The capsule rocks for "tilt";
      // the model dances instead.
      if (state.style) {
        const p = Math.min(state.style.time / state.style.duration, 1);
        if (state.style.anim === "tilt" && !model) rock = Math.sin(p * Math.PI * 4) * 0.45;
        else if (state.style.anim === "spin") spin = p * Math.PI * 2;
      }
      if (mixer) {
        if (beat && Number.isFinite(beat.time)) {
          clock = beat.time;
          bpm = beat.bpm;
        } else clock += dt;
        const r = stepAnim(anim, state, dt);
        anim = r.anim;
        if (r.change) enter(r.change.to, r.change.fade);
      } else anim = stepAnim(anim, state, dt).anim; // The capsule leans too.
      const timeScale = mixer ? mixer.timeScale : 1;
      lean = stepLean(lean, leanOn ? leanTarget(state, anim.yawRate) : 0, dt * timeScale);
      group.rotation.set(grindLean(state) + rollFor(lean), state.yaw + spin, rock, "YXZ");
      if (mixer) {
        blend = stepBlend(blend, dt * mixer.timeScale);
        applyWeights();
        applyLean();
        facing = stepFacing(facing, anim.facing, dt);
        pivot.rotation.y = facing;
        restoreBones();
        mixer.update(dt);
        const ikReady = ikOn && legs && ground;
        ikWeight = ikReady ? stepIkWeight(ikWeight, ikWanted(state, anim.clip), dt) : 0;
        if (ikReady && ikWeight > 0) applyFootIk(state);
        if (model.face) {
          faceState = stepFace(faceState, anim.clip, dt);
          const f = heldFace ?? faceState;
          model.face.set(f.eyes, f.mouth);
        }
      }
    },
  };
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qf = new THREE.Quaternion();

// One pose of a clip: the rotation of each bone at the middle key, as a
// clip of one key. The lean layers use the pose, not the motion.
function poseClip(clip, name) {
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.ValueTypeName !== "quaternion") continue;
    const n = t.getValueSize();
    const i = Math.floor(t.times.length / 2);
    tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0], Array.from(t.values.slice(i * n, i * n + n))));
  }
  return new THREE.AnimationClip(name, 1, tracks);
}

// On a rail the capsule leans with the balance meter, toward the side the
// skater falls off: a positive balance falls to the right (+z at yaw 0), and
// a positive rotation about the forward axis tilts the top toward +z.
export function grindLean(state) {
  return state.state === "grind" && state.grind ? state.grind.balance * 0.6 : 0;
}
