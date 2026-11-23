# Smooths the loop of one shipped clip (the loop seam fix of the GVHMR test,
# docs/research/2026-11-21-gvhmr-mocap-test.md on PR #316).
#
# The script imports a shipped skater GLB, samples one clip at 30 fps, and
# applies a circular Gaussian filter to the local bone rotations and the hips
# location. The filter is circular, so the first frame and the last frame stay
# equal and the seam (the jump of joint speed at the loop point) goes down.
# It exports a GLB with only this clip. Then
#   node scripts/assets/graft-clips.mjs <skater.glb> <out> <skater.glb>
# replaces only this clip in a shipped GLB (do it for skater.glb and
# skater-1024.glb).
#
# The filter does not move the skates to the ground. Measure the lowest
# wheel after the splice (the audit of the GVHMR test, or the e2e lowest-
# vertex check).
#
# Run:
#   blender -b --factory-startup -P scripts/blender/skater_loop_smooth.py -- \
#     --in assets/skaters/nia/skater.glb --name nia --clip dance_walkitout \
#     --sigma-s 0.0625 --out /tmp/nia-walkitout.glb
import argparse
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Quaternion

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--clip", required=True)
    p.add_argument("--sigma-s", type=float, default=0.0625, help="seconds, the Gaussian sigma")
    p.add_argument("--out", required=True)
    return p.parse_args(argv)


def gauss_circular(x, sigma):
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = np.zeros_like(x)
    for i, w in zip(range(-r, r + 1), k):
        out += w * np.roll(x, -i, axis=0)
    return out


def main():
    a = args()
    title = a.name.capitalize()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.name, mesh.name = title + "Rig", title
    src = next((x for x in bpy.data.actions if x.name.split(".")[0] == a.clip), None)
    if src is None:
        raise SystemExit(f"clip {a.clip!r} not in {a.src}")
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
    else:
        arm.animation_data_create()
    arm.animation_data.action = src
    if src.slots:
        arm.animation_data.action_slot = src.slots[0]

    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name, "feet": (0.0, 0.0, 0.0)}}
    with open(os.path.join(HERE, "nia_clips.py")) as f:
        exec(compile(f.read(), "nia_clips.py", "exec"), g)
    paths = {(fc.data_path, fc.array_index) for bag in g["action_fcurves"](src) for fc in bag.fcurves}

    f0, f1 = (int(round(v)) for v in src.frame_range)
    n = f1 - f0                      # the last frame repeats the first
    pb = arm.pose.bones
    names = [p.name for p in pb]
    for p in pb:
        p.rotation_mode = "QUATERNION"
    q = np.empty((n + 1, len(names), 4))
    loc = np.empty((n + 1, len(names), 3))
    for i in range(n + 1):
        bpy.context.scene.frame_set(f0 + i)
        for j, p in enumerate(pb):
            q[i, j] = tuple(p.rotation_quaternion)
            loc[i, j] = tuple(p.location)
    for i in range(1, n + 1):        # one sign for each path of quaternions
        flip = np.sum(q[i] * q[i - 1], -1) < 0
        q[i, flip] *= -1
    closed = np.sum(q[n] * q[0], -1) > 0
    sigma = a.sigma_s * FPS
    sm = gauss_circular(q[:n], sigma)
    sm /= np.linalg.norm(sm, axis=-1, keepdims=True)
    q[:n, closed] = sm[:, closed]
    q[n] = q[0]
    loc[:n] = gauss_circular(loc[:n], sigma)
    loc[n] = loc[0]
    print(f"[loop-smooth] {a.clip}: {n} frames, sigma {sigma:.2f} frames, {int(closed.sum())} of {len(names)} bones")

    # A new action with one key on each frame, only on the curves of the source.
    arm.animation_data.action = None
    for x in list(bpy.data.actions):
        bpy.data.actions.remove(x)
    act = bpy.data.actions.new(a.clip)
    arm.animation_data.action = act
    for i in range(n + 1):
        for j, p in enumerate(pb):
            base = f'pose.bones["{p.name}"]'
            if any((f"{base}.rotation_quaternion", c) in paths for c in range(4)):
                p.rotation_quaternion = Quaternion(q[i, j])
                p.keyframe_insert("rotation_quaternion", frame=i)
            if any((f"{base}.location", c) in paths for c in range(3)):
                p.location = loc[i, j]
                p.keyframe_insert("location", frame=i)
    act["loop"] = True
    act.use_fake_user = True
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = a.clip
    track.strips.new(a.clip, 0, act)
    track.mute = True
    removed = g["prune_static_channels"]()
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    g["export"](out, False, export_image_format="NONE")
    print(f"[loop-smooth] wrote {out}, {os.path.getsize(out)} bytes, removed {removed} static curves")


main()
