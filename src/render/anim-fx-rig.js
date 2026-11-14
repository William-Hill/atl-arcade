import * as THREE from "three";

// Applies the procedural layers of src/render/anim-fx.js to the bones of a
// skater (#291). The layers are additive: the rig adds them after the
// mixer update, and restore() puts the clip values back before the next
// mixer update. Thus a bone with no clip track does not collect the layers.
//
// The rig works in the armature frame (the parent of the hips). The
// rotations go about axes in that frame, so the bone roll of the model
// does not change the result.

// The bones by their Mixamo name. GLTFLoader removes the ":" of
// "mixamorig:Hips", so the match ignores the prefix.
const NAMES = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftShoulder", "RightShoulder", "LeftArm", "RightArm", "LeftForeArm", "RightForeArm"];

// The part of the lag that each bone gets.
const LAG_SHARE = { Neck: 0.45, Head: 0.55, LeftArm: 1.1, RightArm: 1.1, LeftForeArm: 0.6, RightForeArm: 0.6 };

export function findFxBones(root) {
  const out = {};
  root.traverse((o) => {
    if (!o.isBone) return;
    const short = o.name.replace(/^mixamorig[:_]?/, "");
    if (NAMES.includes(short) && !out[short]) out[short] = o;
  });
  return out;
}

const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _p = new THREE.Quaternion();
const _a = new THREE.Vector3();
const SIDES = [
  { shoulder: "LeftShoulder", arm: "LeftArm", fore: "LeftForeArm" },
  { shoulder: "RightShoulder", arm: "RightArm", fore: "RightForeArm" },
];

// Rotates `bone` by `angle` about `axis` (the armature frame). `parent` is
// the orientation of the bone parent in the armature frame.
function rotateAbout(bone, parent, axis, angle) {
  if (angle === 0) return;
  _a.copy(axis).applyQuaternion(_r.copy(parent).invert());
  _q.setFromAxisAngle(_a, angle);
  bone.quaternion.premultiply(_q);
}

// Returns null when the model has no Mixamo hips, spine, and neck.
export function createFxRig(root) {
  const b = findFxBones(root);
  if (!b.Hips || !b.Spine || !b.Spine1 || !b.Spine2 || !b.Neck || !b.Head) return null;
  const armature = b.Hips.parent;
  root.updateMatrixWorld(true);
  // The up axis and 1 m down, in the armature frame. The skater group turns
  // only about the up axis, so they stay correct after this.
  const armQ = armature.getWorldQuaternion(new THREE.Quaternion());
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(armQ.clone().invert()).normalize();
  const inv = new THREE.Matrix3().setFromMatrix4(armature.matrixWorld.clone().invert());
  const down = new THREE.Vector3(0, -1, 0).applyMatrix3(inv);

  const bones = NAMES.filter((n) => b[n]).map((n) => b[n]);
  const saved = bones.map((bone) => bone.quaternion.clone());
  const savedHips = b.Hips.position.clone();
  let applied = false;
  const chest = new THREE.Quaternion();
  const prevChest = new THREE.Quaternion();
  let havePrev = false;
  const omega = [0, 0, 0];
  const lagAxis = new THREE.Vector3();
  const chestQ = new THREE.Quaternion();

  const chain = (out) => out.copy(b.Hips.quaternion).multiply(b.Spine.quaternion).multiply(b.Spine1.quaternion).multiply(b.Spine2.quaternion);

  return {
    up: [up.x, up.y, up.z],
    // Puts the clip values back. Call it before the mixer update.
    restore() {
      if (!applied) return;
      bones.forEach((bone, i) => bone.quaternion.copy(saved[i]));
      b.Hips.position.copy(savedHips);
      applied = false;
    },
    // The chest turn rate (rad/s, the armature frame) of the clip pose.
    // Call it after the mixer update and before apply().
    measure(dt) {
      chain(chest);
      if (havePrev && dt > 0) {
        _q.copy(chest).multiply(_r.copy(prevChest).invert());
        if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
        const angle = 2 * Math.acos(Math.min(1, _q.w));
        const s = Math.sqrt(Math.max(0, 1 - _q.w * _q.w));
        const k = s > 1e-6 ? angle / s / dt : 0;
        omega[0] = _q.x * k;
        omega[1] = _q.y * k;
        omega[2] = _q.z * k;
      } else if (dt > 0) omega.fill(0);
      if (dt > 0) {
        prevChest.copy(chest);
        havePrev = true;
      }
      return omega;
    },
    // fx: the anim-fx state of this frame ({ drop, out, twistOut }).
    apply(fx) {
      bones.forEach((bone, i) => saved[i].copy(bone.quaternion));
      savedHips.copy(b.Hips.position);
      applied = true;

      if (fx.drop) b.Hips.position.addScaledVector(down, fx.drop);

      // The twist: the hips turn a little against the turn, and the three
      // spine bones turn the rest, so the chest turns by the full twist.
      const t = fx.twistOut;
      if (t) {
        const c = 0.35;
        _p.identity();
        rotateAbout(b.Hips, _p, up, -c * t);
        _p.copy(b.Hips.quaternion);
        const share = (t * (1 + c)) / 3;
        for (const bone of [b.Spine, b.Spine1, b.Spine2]) {
          rotateAbout(bone, _p, up, share);
          _p.multiply(bone.quaternion);
        }
      }

      // The follow-through: the neck, the head, and the arms turn by the lag.
      const [lx, ly, lz] = fx.out;
      const lag = Math.hypot(lx, ly, lz);
      if (lag > 1e-5) {
        lagAxis.set(lx / lag, ly / lag, lz / lag);
        chain(chestQ);
        rotateAbout(b.Neck, chestQ, lagAxis, lag * LAG_SHARE.Neck);
        _p.copy(chestQ).multiply(b.Neck.quaternion);
        rotateAbout(b.Head, _p, lagAxis, lag * LAG_SHARE.Head);
        for (const side of SIDES) {
          const arm = b[side.arm];
          if (!arm) continue;
          const sh = b[side.shoulder];
          _p.copy(chestQ);
          if (sh && arm.parent === sh) _p.multiply(sh.quaternion);
          rotateAbout(arm, _p, lagAxis, lag * LAG_SHARE[side.arm]);
          const fore = b[side.fore];
          if (fore && fore.parent === arm) rotateAbout(fore, _p.multiply(arm.quaternion), lagAxis, lag * LAG_SHARE[side.fore]);
        }
      }
    },
  };
}
