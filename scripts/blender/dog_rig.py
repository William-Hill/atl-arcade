"""Rig the dog and key its clips (Meshy rigs humanoids only).

blender -b -P scripts/blender/dog_rig.py -- IN.glb OUT.glb [--stats OUT.json]

IN.glb is the cleaned dog of people_props.py (meters, +z forward, feet on
y = 0, nodes dog_lod0 and dog_lod1). Builds a 14-bone armature from the
mesh bounds (spine, neck, head, tail, four legs of two bones), weights each
vertex by body region (legs by quadrant under the belly, head and neck in
front of the shoulders, tail behind the hips, the spine in between, with
smooth blends across the borders), and keys two loops at 30 fps:
"walk" (a 0.8 s trot: diagonal leg pairs, head bob, tail wag) and "idle"
(2 s: breathing, a slow head turn, tail wag). Both LODs share the skeleton.
"""
import json
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src)
meshes = sorted((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: o.name)
for o in meshes:
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
lod0 = next(o for o in meshes if o.name.endswith("_lod0"))
vs = [v.co for v in lod0.data.vertices]
lo = Vector([min(v[k] for v in vs) for k in range(3)])
hi = Vector([max(v[k] for v in vs) for k in range(3)])
H, L = hi.z - lo.z, hi.y - lo.y  # Blender: front is -y
front, back = lo.y, hi.y
belly = 0.42 * H
# Leg columns: the low vertices in each quadrant.
def column(sx, sy):
    pts = [v for v in vs if v.z < 0.25 * H and (v.x > 0) == (sx > 0) and (v.y > (front + back) / 2) == (sy > 0)]
    if not pts:
        return Vector((sx * 0.3 * (hi.x - lo.x), (front + back) / 2 + sy * 0.3 * L, 0))
    return Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), 0))
legs = {f"{fb}_{side}": column(sx, sy) for fb, sy in (("front", -1), ("hind", 1)) for side, sx in (("L", 1), ("R", -1))}
shoulder_y = (legs["front_L"].y + legs["front_R"].y) / 2
hip_y = (legs["hind_L"].y + legs["hind_R"].y) / 2
spine_z = 0.62 * H

arm_data = bpy.data.armatures.new("dog_rig")
arm = bpy.data.objects.new("dog_rig", arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm_data.edit_bones


def bone(name, head, tail, parent=None):
    b = eb.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    if parent:
        b.parent = eb[parent]
    return b


bone("root", (0, hip_y, spine_z), (0, hip_y, spine_z + 0.1))
bone("hips", (0, hip_y, spine_z), (0, (hip_y + shoulder_y) / 2, spine_z), "root")
bone("chest", (0, (hip_y + shoulder_y) / 2, spine_z), (0, shoulder_y, spine_z + 0.02 * H), "hips")
neck_top = (0, shoulder_y - 0.08 * L, 0.85 * H)
bone("neck", (0, shoulder_y, spine_z + 0.02 * H), neck_top, "chest")
bone("head", neck_top, (0, front, 0.8 * H), "neck")
bone("tail", (0, back - 0.06 * L, spine_z), (0, back, hi.z), "hips")
for k, foot in legs.items():
    par = "chest" if k.startswith("front") else "hips"
    top = (foot.x, foot.y, belly + 0.12 * H)
    knee = (foot.x, foot.y + (0.03 if k.startswith("front") else -0.03) * L, 0.45 * belly)
    bone(f"{k}_upper", top, knee, par)
    bone(f"{k}_lower", knee, (foot.x, foot.y, 0.0), f"{k}_upper")
bpy.ops.object.mode_set(mode="OBJECT")


def smooth(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def weights(co):
    w = {}
    leg = 1 - smooth(belly - 0.06 * H, belly + 0.04 * H, co.z)
    near_front = co.y < (front + back) / 2
    if leg > 0:
        fb = "front" if near_front else "hind"
        side = "L" if co.x > 0 else "R"
        knee = 0.45 * belly
        lower = 1 - smooth(knee - 0.05 * H, knee + 0.05 * H, co.z)
        w[f"{fb}_{side}_lower"] = leg * lower
        w[f"{fb}_{side}_upper"] = leg * (1 - lower)
    body = 1 - leg
    head = 1 - smooth(neck_top[1] - 0.03 * L, neck_top[1] + 0.05 * L, co.y)
    neck = (1 - smooth(shoulder_y - 0.02 * L, shoulder_y + 0.06 * L, co.y)) - head
    tail = smooth(back - 0.12 * L, back - 0.05 * L, co.y) * smooth(spine_z - 0.1 * H, spine_z + 0.05 * H, co.z)
    trunk = max(0.0, 1 - head - neck - tail)
    chest = 1 - smooth(hip_y - 0.25 * (hip_y - shoulder_y), shoulder_y + 0.25 * (hip_y - shoulder_y), co.y)
    chest = 1 - smooth(shoulder_y, hip_y, co.y)
    for k, v in (("head", head), ("neck", neck), ("tail", tail), ("chest", trunk * chest), ("hips", trunk * (1 - chest))):
        if body * v > 1e-3:
            w[k] = w.get(k, 0) + body * v
    s = sum(w.values()) or 1
    return {k: v / s for k, v in w.items() if v / s > 1e-3}


for o in meshes:
    o.vertex_groups.clear()
    groups = {b.name: o.vertex_groups.new(name=b.name) for b in arm_data.bones}
    for v in o.data.vertices:
        for k, x in weights(v.co).items():
            groups[k].add([v.index], x, "REPLACE")
    o.parent = arm
    m = o.modifiers.new("arm", "ARMATURE")
    m.object = arm

arm.animation_data_create()


def key_clip(name, frames, pose_at):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for f in range(frames + 1):
        t = f / frames
        for pb in arm.pose.bones:
            pb.rotation_mode = "XYZ"
            pb.rotation_euler = Euler(pose_at(pb.name, t))
            pb.keyframe_insert("rotation_euler", frame=f + 1)
    arm.animation_data.action = None
    tr = arm.animation_data.nla_tracks.new()
    tr.name = name
    strip = tr.strips.new(name, 1, act)
    if hasattr(strip, "action_slot") and act.slots:
        strip.action_slot = act.slots[0]


R = math.radians


def walk(b, t):
    ph = 2 * math.pi * t
    # Diagonal pairs: front_L with hind_R.
    off = {"front_L": 0, "hind_R": 0, "front_R": math.pi, "hind_L": math.pi}
    for k, o in off.items():
        if b == f"{k}_upper":
            return (R(28) * math.sin(ph + o), 0, 0)
        if b == f"{k}_lower":
            return (R(-22) * max(0, math.sin(ph + o + 1.2)), 0, 0)
    if b == "head":
        return (R(3) * math.sin(2 * ph), 0, 0)
    if b == "tail":
        return (0, R(20) * math.sin(ph), 0)
    if b == "hips":
        return (0, R(2) * math.sin(ph), 0)
    return (0, 0, 0)


def idle(b, t):
    ph = 2 * math.pi * t
    if b == "chest":
        return (R(1.5) * math.sin(2 * ph), 0, 0)
    if b == "head":
        return (R(4) * math.sin(ph), 0, R(14) * math.sin(ph))
    if b == "tail":
        return (0, R(25) * math.sin(3 * ph), 0)
    return (0, 0, 0)


key_clip("walk", 24, walk)
key_clip("idle", 60, idle)

for o in bpy.data.objects:
    o.select_set(o in meshes or o == arm)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_extras=True,
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_draco_generic_quantization=12,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_cameras=False,
    export_lights=False,
)
stats = {"bones": len(arm_data.bones), "clips": {"walk": {"frames": 24, "source": "keyed in Blender"}, "idle": {"frames": 60, "source": "keyed in Blender"}},
         "triangles": {o.name.rsplit("_", 1)[1]: sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes}}
if opt("--stats"):
    json.dump(stats, open(opt("--stats"), "w"), indent=2)
print("STATS", json.dumps(stats))
