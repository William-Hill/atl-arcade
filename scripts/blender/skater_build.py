# Builds a shipped skater GLB from a raw Tripo export (M1-10, #42).
#
# The steps are the M1-01 and M1-02 steps for Nia, in one script:
#   1. Import the raw Tripo GLB (Mixamo rig, 65 mixamorig: joints).
#   2. Remove the Tripo empties and keep the world transform of the armature.
#   3. Scale the skater to the dossier height. Put the wheels on z = 0.
#   4. Resize the textures and set the specular tint to white.
#   5. Key the M1-02 clips with scripts/blender/nia_clips.py.
#   6. Export a Draco GLB with all clips, and a .blend file.
#
# Run:
#   blender -b --factory-startup -P scripts/blender/skater_build.py -- \
#     --in assets/skaters/marcus/raw/marcus-tripo.glb --name marcus --height 1.78 \
#     --out assets/skaters/marcus/skater.glb
import argparse
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--height", type=float, required=True)
    p.add_argument("--out", required=True)
    return p.parse_args(argv)


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_raw(path):
    bpy.ops.import_scene.gltf(filepath=path)
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    # The importer adds an Icosphere mesh as the bone display shape. The
    # skater is the one mesh with an armature modifier.
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    if len(arms) != 1 or len(meshes) != 1:
        raise SystemExit(f"expected 1 armature and 1 mesh, got {len(arms)} and {len(meshes)}")
    return arms[0], meshes[0]


def remove_empties(arm):
    world = arm.matrix_world.copy()
    arm.parent = None
    arm.matrix_world = world
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)


def mesh_bounds(mesh):
    deps = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(deps)
    pts = [ev.matrix_world @ v.co for v in ev.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def apply_transforms(objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def fit_height(arm, mesh, height):
    apply_transforms([arm, mesh])
    lo, hi = mesh_bounds(mesh)
    s = height / (hi.z - lo.z)
    centre = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    arm.location = -centre * s
    arm.scale = (s, s, s)
    bpy.context.view_layer.update()
    apply_transforms([arm, mesh])
    lo, hi = mesh_bounds(mesh)
    print(f"[build] scale {s:.4f}, bounds {tuple(round(v, 3) for v in lo)} to {tuple(round(v, 3) for v in hi)}")
    return s


def resize_textures():
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        name = img.name.lower()
        target = 2048 if ("base" in name or "color" in name or "diffuse" in name) else 1024
        if img.size[0] > target:
            img.scale(target, target)
        print(f"[build] texture {img.name}: {img.size[0]}x{img.size[1]}")
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for n in mat.node_tree.nodes:
            if n.type == "BSDF_PRINCIPLED":
                tint = n.inputs.get("Specular Tint")
                if tint is not None and not tint.is_linked:
                    tint.default_value = (1.0, 1.0, 1.0, 1.0)


def rest_feet(arm):
    left = arm.data.bones["mixamorig:LeftFoot"].head_local
    right = arm.data.bones["mixamorig:RightFoot"].head_local
    return (round(left.x, 3), round(right.x, 3), round((left.y + right.y) / 2, 3))


def main():
    a = args()
    title = a.name.capitalize()
    clean_scene()
    arm, mesh = import_raw(os.path.abspath(a.src))
    remove_empties(arm)
    mesh.parent = arm
    fit_height(arm, mesh, a.height)
    arm.name = title + "Rig"
    mesh.name = title
    resize_textures()

    # Armature axes in nia_clips.py: +X is the skater's left, -Y is forward.
    feet = rest_feet(arm)
    print(f"[build] rest feet {feet}")
    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name, "feet": feet}}
    with open(os.path.join(HERE, "nia_clips.py")) as f:
        exec(compile(f.read(), "nia_clips.py", "exec"), g)
    clips = g["build_all"]()
    removed = g["prune_static_channels"]()
    print(f"[build] {len(clips)} clips, removed {removed} static curves")

    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    raw_dir = os.path.join(os.path.dirname(out), "raw")
    os.makedirs(raw_dir, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(raw_dir, f"{a.name}-animated.blend"))

    # The glTF exporter writes the images as JPEG. Nia used quality 88.
    g["export"](out, True, export_image_format="JPEG", export_jpeg_quality=88)
    print(f"[build] wrote {out}, {os.path.getsize(out)} bytes")


main()
