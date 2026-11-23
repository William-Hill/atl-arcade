"""Outfit variants of the Meshy people (assets/people/variants/).

Meshy retexture (input_task_id = the refine task of each person, original
UVs kept) gives each person new clothes, skin and hair colors on the same
mesh and UVs. This script takes the base color of each retextured GLB and
writes it as a JPEG for the game (the game keeps the person's own normal
and metal-rough maps).

  blender -b -P scripts/blender/people_variants.py -- RAW_DIR OUT_DIR SIZE

RAW_DIR has <kind>_v<n>.glb; OUT_DIR gets <kind>_v<n>.jpg (SIZE px, JPEG 85).
"""

import glob
import os
import sys

import bpy

raw, out, size = sys.argv[sys.argv.index("--") + 1 :][:3]
size = int(size)
os.makedirs(out, exist_ok=True)
for path in sorted(glob.glob(os.path.join(raw, "*_v[0-9].glb"))):
    name = os.path.splitext(os.path.basename(path))[0]
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    base = None
    for mat in bpy.data.materials:
        if not mat.node_tree:
            continue
        bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        link = bsdf and bsdf.inputs["Base Color"].links
        if link and link[0].from_node.type == "TEX_IMAGE":
            base = link[0].from_node.image
    if base is None:
        print("VARIANT", name, "no base color")
        continue
    base.scale(size, size)
    scene = bpy.context.scene
    # Write the texels as they are: no view transform (AgX shifts colors).
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.image_settings.file_format = "JPEG"
    scene.render.image_settings.quality = 85
    target = os.path.join(out, f"{name}.jpg")
    base.save_render(target, scene=scene)
    print("VARIANT", name, os.path.getsize(target))
