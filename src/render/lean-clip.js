import * as THREE from "three";

// The additive lean poses for the carve (#107).
//
// A lean pose is the carve pose less the coast pose. THREE's
// makeClipAdditive() subtracts only the tracks that the reference clip also
// has, and it keeps every other target track as an absolute value. The
// Blender export removes a track that stays at the rest pose for the whole
// clip, so the coast has no Hips rotation track. Without a reference, the
// carve Hips rotation (with the -90 degree rest yaw of the Mixamo hips)
// went into the layer as a delta, and the skater turned up to 48 degrees
// off the travel direction (the "sideways" bug).
//
// leanClip() gives each carve track with no coast track the rest value of
// its bone as the reference. A track with no reference and no rest value
// is removed.
//
// The layer bends the body only. The legs (and their skates on the ground)
// come from the base clip: a carve crouch added on top of a push stride
// would lift a skate off the ground.
const LEG = /(UpLeg|Leg|Foot|ToeBase|Toe_End)\.quaternion$/;

// One pose of a clip: the rotation of each bone at the middle key, as a
// clip of one key. The lean layers use the pose, not the motion.
export function poseClip(clip, name) {
  const tracks = [];
  for (const t of clip.tracks) {
    if (t.ValueTypeName !== "quaternion") continue;
    const n = t.getValueSize();
    const i = Math.floor(t.times.length / 2);
    tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0], Array.from(t.values.slice(i * n, i * n + n))));
  }
  return new THREE.AnimationClip(name, 1, tracks);
}

// restOf(trackName): the rest quaternion [x, y, z, w] of the bone that the
// track animates, or null.
export function leanClip(carve, coast, restOf, name = `lean_${carve.name}`) {
  const target = poseClip(carve, name);
  const reference = poseClip(coast, "lean_ref");
  const have = new Set(reference.tracks.map((t) => t.name));
  target.tracks = target.tracks.filter((t) => {
    if (LEG.test(t.name)) return false;
    if (have.has(t.name)) return true;
    const rest = restOf(t.name);
    if (!rest) return false;
    reference.tracks.push(new THREE.QuaternionKeyframeTrack(t.name, [0], Array.from(rest)));
    return true;
  });
  return THREE.AnimationUtils.makeClipAdditive(target, 0, reference);
}

// The rest quaternion of a track's bone, from a model root at its rest pose.
export function restFrom(root) {
  return (trackName) => {
    const { nodeName } = THREE.PropertyBinding.parseTrackName(trackName);
    const node = root.getObjectByName(nodeName);
    return node ? node.quaternion.toArray() : null;
  };
}
