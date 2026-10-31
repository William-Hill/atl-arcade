import * as THREE from "three";
import { SKATER_BODY } from "../sim/skate/constants.js";
import { CLIPS, beatPhase, createAnimState, grooveRate, stepAnim, stepFacing } from "./skater-anim.js";

// The skater bound to the controller output. It starts as a capsule (the
// nose cone shows the facing). attachModel() swaps in a GLB skater and plays
// its clips from the state -> clip table in skater-anim.js.
export function createSkaterView() {
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

  function play(name, fade) {
    const next = actions.get(name);
    if (!next || next === current) return;
    next.reset();
    if (CLIPS[name]?.beat) {
      next.timeScale = grooveRate(bpm);
      next.time = beatPhase(clock, next.getClip().duration, bpm);
    } else if (CLIPS[name]?.tempo) {
      next.timeScale = grooveRate(bpm);
    }
    next.play();
    if (current) current.crossFadeTo(next, fade, false);
    current = next;
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
    // The effective weight of each running clip, for the tests.
    get weights() {
      const out = {};
      for (const [name, a] of actions) if (a.isRunning()) out[name] = Number(a.getEffectiveWeight().toFixed(3));
      return out;
    },
    // loaded: the result of loadSkaterModel().
    attachModel(loaded) {
      model = loaded;
      body.visible = false;
      nose.visible = false;
      pivot.add(loaded.root);
      mixer = new THREE.AnimationMixer(loaded.root);
      for (const clip of loaded.animations) {
        const action = mixer.clipAction(clip);
        if (CLIPS[clip.name]?.once) {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        actions.set(clip.name, action);
      }
      anim = createAnimState();
      current = null;
      facing = 0;
      pivot.rotation.y = 0;
      play(anim.clip, 0);
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
      group.rotation.set(grindLean(state), state.yaw + spin, rock, "YXZ");
      if (mixer) {
        if (beat && Number.isFinite(beat.time)) {
          clock = beat.time;
          bpm = beat.bpm;
        } else clock += dt;
        const r = stepAnim(anim, state, dt);
        anim = r.anim;
        if (r.change) play(r.change.to, r.change.fade);
        facing = stepFacing(facing, anim.facing, dt);
        pivot.rotation.y = facing;
        mixer.update(dt);
      }
    },
  };
}

// On a rail the capsule leans with the balance meter, toward the side the
// skater falls off: a positive balance falls to the right (+z at yaw 0), and
// a positive rotation about the forward axis tilts the top toward +z.
export function grindLean(state) {
  return state.state === "grind" && state.grind ? state.grind.balance * 0.6 : 0;
}
