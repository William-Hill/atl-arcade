"""Render views of a Nia MetaHuman blend (front, three-quarter, side, back). Workbench, material colors.

  Blender -b <file.blend> -P nia_mh_render.py -- <out prefix> [hide_body_mask:0|1] [pose:none|<action>@<frame>]
"""
import bpy, sys, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
use_mask = len(argv) < 2 or argv[1] == "1"
sc = bpy.context.scene
for o in bpy.data.objects:
    for m in o.modifiers:
        if m.type == "MASK":
            m.show_render = use_mask
    if o.type == "ARMATURE":
        o.hide_render = True
    if o.name == "sphere_control":
        o.hide_render = True
try:
    sc.render.engine = "BLENDER_EEVEE"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
w = sc.world or bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True
bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
bg.inputs["Color"].default_value = (0.55, 0.57, 0.62, 1); bg.inputs["Strength"].default_value = 0.9
for name, rot, en in (("key", (0.9, 0.2, -0.6), 3.0), ("fill", (1.1, -0.3, 2.4), 1.2)):
    L = bpy.data.objects.new(name, bpy.data.lights.new(name, "SUN")); sc.collection.objects.link(L)
    L.rotation_euler = rot; L.data.energy = en
sc.view_settings.view_transform = "Standard"
sc.render.resolution_x = 600; sc.render.resolution_y = 900
cam = bpy.data.objects.new("rc", bpy.data.cameras.new("rc")); sc.collection.objects.link(cam); sc.camera = cam
cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.0
ctr = Vector((0, 0, 0.85))
for name, ang in (("front", 0), ("q34", 35), ("side", 90), ("back", 180)):
    a = math.radians(ang); off = Vector((math.sin(a) * 4, -math.cos(a) * 4, 0))
    cam.location = ctr + off; cam.rotation_euler = (-off).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = f"{out}-{name}.png"; bpy.ops.render.render(write_still=True)
print("RENDER_DONE")
