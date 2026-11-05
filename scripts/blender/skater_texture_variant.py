"""Export the same skater GLB with reduced texture size."""
import argparse
import os
import sys
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument("--in", dest="src", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--tex", type=int, default=1024)
a = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.src))
for img in bpy.data.images:
    if img.size[0] > a.tex:
        img.scale(a.tex, a.tex)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
g = {"__name__": "texture_variant", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name}}
with open(os.path.join(HERE, "nia_clips.py")) as f:
    exec(compile(f.read(), "nia_clips.py", "exec"), g)
g["export"](os.path.abspath(a.out), True, export_image_format="JPEG", export_jpeg_quality=82)
