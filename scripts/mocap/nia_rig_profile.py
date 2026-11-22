# Writes the rig profile of a shipped skater GLB for the GVHMR retarget
# (squall01337/mixamo-llm-mocap, pipeline/retarget_smplx.py).
#
# The retarget expects a Mixamo FBX import: the armature space is Y-up and the
# character faces +Z, and the armature object turns it +90 degrees about X.
# After a GLB import, the armature of Nia has no transform: the armature space
# is the Blender world (Z-up, the character faces -Y). This script gives the
# retarget the same rest pose in a Y-up armature space: each bone rest matrix
# is multiplied by C = Rx(-90 deg), and the armature world matrix is C^-1.
#
# A constant turn of the full armature space does not change the local
# rotation of a bone relative to its parent, and the hips location of the
# retarget is in the hips bone frame. Thus the keys of motion.npz apply
# without a change to the real rig of the GLB.
#
# Run:
#   blender -b --factory-startup -P scripts/mocap/nia_rig_profile.py -- \
#     --in assets/skaters/nia/skater.glb --out rig_profiles/nia.json [--save-blend nia_rest.blend]
import argparse
import json
import os
import sys

import bpy
from mathutils import Matrix


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--save-blend", default="", help="also save the rest scene (no clips) for bl_motion.py")
    return p.parse_args(argv)


def rnd(m):
    return [[round(v, 7) for v in row] for row in m]


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if len(arms) != 1:
        raise SystemExit(f"expected 1 armature, got {len(arms)}")
    arm = arms[0]
    if any(abs(v) > 1e-6 for v in arm.matrix_world.to_euler()) or arm.matrix_world.to_translation().length > 1e-6:
        raise SystemExit(f"the armature has a transform: {arm.matrix_world}")
    names = [b.name for b in arm.data.bones]
    if len(names) != 65 or any(not n.startswith("mixamorig:") for n in names):
        raise SystemExit(f"expected 65 mixamorig: bones, got {len(names)}")
    # Facing check: the toes point to -Y and the left foot is at +X.
    lf = arm.data.bones["mixamorig:LeftFoot"]
    toe = arm.data.bones["mixamorig:LeftToe_End"].head_local
    if not (toe.y < lf.head_local.y and lf.head_local.x > 0):
        raise SystemExit("the rig does not face -Y with the left foot at +X")

    C = Matrix.Rotation(-1.5707963267948966, 4, "X")   # Blender world -> Y-up armature space

    ordered, seen = [], set()

    def walk(b):
        if b.name in seen:
            return
        seen.add(b.name)
        ordered.append(b)
        for c in b.children:
            walk(c)

    for b in arm.data.bones:
        if b.parent is None:
            walk(b)
    bones = [{"name": b.name, "parent": b.parent.name if b.parent else None,
              "matrix_local": rnd(C @ b.matrix_local),
              "tail_local": [round(v, 5) for v in (C.to_3x3() @ b.tail_local)]} for b in ordered]

    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() is arm]
    lo, hi = float("inf"), float("-inf")
    for m in meshes:
        for v in m.data.vertices:
            z = (m.matrix_world @ v.co).z      # world z = armature-space y
            lo, hi = min(lo, z), max(hi, z)
    profile = {
        "character": [m.name for m in meshes],
        "note": "Y-up copy of the GLB rest pose for retarget_smplx.py (scripts/mocap/nia_rig_profile.py)",
        "armature": arm.name,
        "armature_matrix_world": rnd(C.inverted()),
        "bones": bones,
        "mesh_floor_y": round(lo, 4),
        "mesh_height": round(hi - lo, 4),
        "meshes": [m.name for m in meshes],
    }
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        json.dump(profile, f, indent=1)
    if a.save_blend:
        for o in list(bpy.data.objects):
            if o.type == "MESH" and o not in meshes:
                bpy.data.objects.remove(o, do_unlink=True)
        if arm.animation_data:
            for t in list(arm.animation_data.nla_tracks):
                arm.animation_data.nla_tracks.remove(t)
            arm.animation_data.action = None
        for act in list(bpy.data.actions):
            bpy.data.actions.remove(act)
        bpy.context.scene.render.fps = 30
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save_blend))
        print(f"[rig-profile] saved {a.save_blend}")
    print(f"[rig-profile] {len(bones)} bones, floor {lo:.4f} m, height {hi - lo:.3f} m -> {out}")


main()
