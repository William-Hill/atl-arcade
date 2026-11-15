# Keys the clips again on a shipped skater GLB (#290).
#
# The source .blend files are not in git (assets/skaters/*/raw/). This script
# imports the shipped skater.glb, removes its clips, keys all clips with
# scripts/blender/nia_clips.py, and exports a GLB. Then
# scripts/skater-clips-splice.mjs copies the clips into the shipped GLBs. The
# mesh, the skin, and the textures of the shipped GLBs do not change.
#
# Run:
#   blender -b --factory-startup -P scripts/blender/skater_reclip.py -- \
#     --in assets/skaters/nia/skater.glb --name nia --out /tmp/nia-clips.glb
import argparse
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--clips", default="", help="comma-separated clip names (default: all)")
    return p.parse_args(argv)


def main():
    a = args()
    title = a.name.capitalize()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    if len(arms) != 1 or len(meshes) != 1:
        raise SystemExit(f"expected 1 armature and 1 mesh, got {len(arms)} and {len(meshes)}")
    arm, mesh = arms[0], meshes[0]
    if any(abs(v) > 1e-6 for v in arm.matrix_world.to_euler()) or arm.matrix_world.to_translation().length > 1e-6:
        raise SystemExit(f"the armature has a transform: {arm.matrix_world}")
    arm.name = title + "Rig"
    mesh.name = title

    # Remove the imported clips. nia_clips.build_all removes all actions too.
    if arm.animation_data:
        arm.animation_data.action = None

    left = arm.data.bones["mixamorig:LeftFoot"].head_local
    right = arm.data.bones["mixamorig:RightFoot"].head_local
    feet = (round(left.x, 3), round(right.x, 3), round((left.y + right.y) / 2, 3))
    print(f"[reclip] rest feet {feet}")
    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name, "feet": feet}}
    with open(os.path.join(HERE, "nia_clips.py")) as f:
        exec(compile(f.read(), "nia_clips.py", "exec"), g)
    names = [n for n in a.clips.split(",") if n] or None
    clips = g["build_all"](names)
    removed = g["prune_static_channels"]()
    print(f"[reclip] {len(clips)} clips, removed {removed} static curves")

    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    # Only the clips are used, so the export has no Draco and no images.
    g["export"](out, False, export_image_format="NONE")
    print(f"[reclip] wrote {out}, {os.path.getsize(out)} bytes")


main()
