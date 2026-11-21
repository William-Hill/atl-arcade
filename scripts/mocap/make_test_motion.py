# Makes a test motion.npz from a shipped clip, for a check of
# scripts/mocap/nia_mocap_clip.py without a GPU. The file has the same keys as
# the output of retarget_smplx.py (bone_names, quat, hips_location, fps).
#
# The clip repeats, and the script adds the faults of a video capture:
# forward travel, a heading drift, rotation noise on each bone, and a sink of
# the body into the ground. It is test data only. Do not ship it.
#
# Run:
#   blender -b --factory-startup -P scripts/mocap/make_test_motion.py -- \
#     --in assets/skaters/nia/skater.glb --clip push --out /tmp/test_motion.npz
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--clip", default="push")
    p.add_argument("--out", required=True)
    p.add_argument("--repeats", type=int, default=5)
    p.add_argument("--speed", type=float, default=3.0, help="m/s forward")
    p.add_argument("--drift", type=float, default=8.0, help="deg/s heading drift to the left")
    p.add_argument("--noise", type=float, default=1.5, help="deg, rotation noise on each bone")
    p.add_argument("--sink", type=float, default=0.025, help="m, the body goes down this much")
    p.add_argument("--seed", type=int, default=7)
    return p.parse_args(argv)


def main():
    a = args()
    rng = np.random.default_rng(a.seed)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    if arm.animation_data:
        for t in arm.animation_data.nla_tracks:
            t.mute = True
    act = bpy.data.actions[a.clip]
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]
    f0, f1 = (int(round(v)) for v in act.frame_range)
    period = f1 - f0
    pb = arm.pose.bones
    names = [p.name for p in pb]
    hb = arm.data.bones["mixamorig:Hips"]
    R0 = hb.matrix_local.to_3x3()
    T = period * a.repeats + 1
    quat = np.zeros((T, len(names), 4))
    hips = np.zeros((T, 3))
    fps = bpy.context.scene.render.fps
    for t in range(T):
        bpy.context.scene.frame_set(f0 + t % period)
        sec = t / fps
        yaw = math.radians(a.drift) * sec
        Rz = Matrix.Rotation(yaw, 3, "Z")
        for i, p in enumerate(pb):
            p.rotation_mode = "QUATERNION"
            q = p.rotation_quaternion.copy()
            if p.name == "mixamorig:Hips":
                D = R0 @ q.to_matrix() @ R0.transposed()
                q = (R0.transposed() @ Rz @ D @ R0).to_quaternion()
            axis = Vector(rng.normal(size=3)).normalized()
            q = Quaternion(axis, math.radians(a.noise) * rng.normal()) @ q
            quat[t, i] = (q.w, q.x, q.y, q.z)
        loc = pb["mixamorig:Hips"].location.copy()
        world = R0 @ loc
        world = Rz @ world + Rz @ Vector((0, -a.speed * sec, 0)) - Vector((0, 0, a.sink))
        hips[t] = np.array(R0.transposed() @ world)
    np.savez_compressed(a.out, bone_names=np.array(names), quat=quat, hips_location=hips,
                        fps=np.array(float(fps)))
    print(f"[test-motion] {a.clip}: {T} frames ({a.repeats} x {period}), {a.speed} m/s, "
          f"drift {a.drift} deg/s, noise {a.noise} deg, sink {a.sink} m -> {a.out}")


main()
