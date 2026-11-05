"""Build one pedestrian GLB from a Meshy rig: LOD0 + LOD1 skins on one skeleton,
the clips renamed, Draco.

blender -b -P scripts/blender/people.py -- RAW_DIR NAME OUT.glb [--clips walk=walk,run=run,idle=Idle_02,...]
    [--share OTHER:game=Action,...] [--lod1 1200] [--ride] [--stats OUT.json] [--render OUT.png]

RAW_DIR holds the downloads of scripts/assets/meshy-people-props.mjs:
NAME_rigged.glb (the skin), NAME_walk.glb and NAME_run.glb (the free clips of
the rig) and NAME_actions.glb (the library actions). Steps:
1. import the rigged skin, drop Meshy's helper Icosphere, keep the 24-bone
   Meshy humanoid skeleton and the weights;
2. import every clip file, take its action, and put it on the skin's armature
   as an NLA track named by --clips (game names: walk, run, idle, cheer, sit,
   push); --share takes library actions bought for OTHER (every Meshy
   humanoid rig has the same 24 bones, so the rotations transfer; the Hips
   translation is scaled by the ratio of the hip heights); with --ride, key a "ride" clip (seated, hands forward, legs
   pedaling) from the first frame of the "sit" clip;
3. LOD1: a copy of the skin decimated to --lod1 triangles, on the same
   armature and material (so it costs no texture memory);
4. textures: base color 1024, normal 512, metallic-roughness 256 (JPEG 88);
5. export Draco GLB, +z forward, feet on y = 0. Nodes: NAME_lod0 and NAME_lod1
   (extras.lodDistance 0 and 25 m), the armature "NAME_rig".
"""
import json
import math
import sys

import bpy
from mathutils import Euler, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
raw, name, dst = argv[0], argv[1], argv[2]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
clips = dict(c.split("=") for c in opt("--clips", "walk=walk,run=run").split(","))
lod1_tris = int(opt("--lod1", "1200"))
LOD1_DISTANCE = 25.0
TEX = {"Base Color": 1024, "Normal": 512, "Metallic": 256, "Roughness": 256}

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


objs = import_glb(f"{raw}/{name}_rigged.glb")
arm = next(o for o in objs if o.type == "ARMATURE")
skin = next(o for o in objs if o.type == "MESH" and o.find_armature() == arm)
for o in objs:
    if o not in (arm, skin) and o.type == "MESH":
        bpy.data.objects.remove(o, do_unlink=True)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
arm.name = f"{name}_rig"
skin.name = f"{name}_lod0"
arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(tr)
arm.animation_data.action = None
tracks = {}


def hips_height(a):
    b = a.data.bones["Hips"]
    return (a.matrix_world @ b.head_local).z


def take_clips(path, wanted, shared=False):
    new = import_glb(path)
    other = next((o for o in new if o.type == "ARMATURE"), None)
    ratio = hips_height(arm) / hips_height(other) if other else 1.0
    for a in bpy.data.actions:
        if a.get("_taken"):
            continue
        a["_taken"] = True
        src = a.name.split("|")[1] if "|" in a.name else a.name
        game = next((g for g, s in wanted.items() if s == src or (s in ("walk", "run") and src.startswith({"walk": "walking", "run": "running"}[s]))), None)
        if game is None:
            bpy.data.actions.remove(a)
            continue
        a.name = game
        a.use_fake_user = True
        if shared and abs(ratio - 1) > 1e-4:
            for fc in fcurves_of(a):
                if fc.data_path.endswith('"Hips"].location'):
                    for k in fc.keyframe_points:
                        k.co.y *= ratio
                        k.handle_left.y *= ratio
                        k.handle_right.y *= ratio
        tr = arm.animation_data.nla_tracks.new()
        tr.name = game
        strip = tr.strips.new(game, int(a.frame_range[0]), a)
        if hasattr(strip, "action_slot") and a.slots:
            strip.action_slot = a.slots[0]
        tracks[game] = {"frames": round(a.frame_range[1] - a.frame_range[0], 1), "source": src}
        if shared:
            tracks[game]["shared_from"] = path.rsplit("/", 1)[-1]
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)


def fcurves_of(a):
    if hasattr(a, "fcurves") and len(a.fcurves):
        return list(a.fcurves)
    out = []
    for layer in getattr(a, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


take_clips(f"{raw}/{name}_walk.glb", {g: s for g, s in clips.items() if s == "walk"})
take_clips(f"{raw}/{name}_run.glb", {g: s for g, s in clips.items() if s == "run"})
take_clips(f"{raw}/{name}_actions.glb", {g: s for g, s in clips.items() if s not in ("walk", "run")})
if opt("--share"):
    groups = {}
    for item in opt("--share").split(","):
        who, rest = item.split(":") if ":" in item else (last, item)
        last = who
        g, a = rest.split("=")
        groups.setdefault(who, {})[g] = a
    for who, wanted in groups.items():
        take_clips(f"{raw}/{who}_actions.glb", wanted, shared=True)

# Clean the leftover data of the clip imports.
for m in list(bpy.data.meshes):
    if m.users == 0:
        bpy.data.meshes.remove(m)
for a in list(bpy.data.armatures):
    if a.users == 0:
        bpy.data.armatures.remove(a)


def ride_clip():
    """Seated on a bike: the sit pose's first frame, arms reaching forward,
    legs pedaling (thighs and shins half a turn apart), 1 s loop at 30 fps."""
    sit = bpy.data.actions["sit"]
    act = bpy.data.actions.new("ride")
    act.use_fake_user = True
    arm.animation_data.action = sit
    if hasattr(arm.animation_data, "action_slot") and sit.slots:
        arm.animation_data.action_slot = sit.slots[0]
    bpy.context.scene.frame_set(int(sit.frame_range[0]))
    base = {b.name: b.rotation_quaternion.copy() for b in arm.pose.bones}
    hips_loc = arm.pose.bones["Hips"].location.copy()
    arm.animation_data.action = act
    n = 30
    for f in range(0, n + 1, 3):
        ph = 2 * math.pi * f / n
        for b in arm.pose.bones:
            b.rotation_mode = "QUATERNION"
            q = base[b.name].copy()
            extra = None
            if b.name in ("LeftArm", "RightArm"):
                extra = Euler((math.radians(-35), 0, 0))
            elif b.name in ("LeftForeArm", "RightForeArm"):
                extra = Euler((math.radians(-20), 0, 0))
            elif b.name in ("LeftUpLeg", "RightUpLeg"):
                s = 1 if b.name.startswith("Left") else -1
                extra = Euler((math.radians(22 * math.sin(ph) * s - 10), 0, 0))
            elif b.name in ("LeftLeg", "RightLeg"):
                s = 1 if b.name.startswith("Left") else -1
                extra = Euler((math.radians(25 + 25 * math.cos(ph) * s), 0, 0))
            elif b.name == "Spine02":
                extra = Euler((math.radians(15), 0, 0))
            if extra:
                q = q @ extra.to_quaternion()
            b.rotation_quaternion = q
            b.keyframe_insert("rotation_quaternion", frame=f + 1)
        arm.pose.bones["Hips"].location = hips_loc
        arm.pose.bones["Hips"].keyframe_insert("location", frame=f + 1)
    arm.animation_data.action = None
    tr = arm.animation_data.nla_tracks.new()
    tr.name = "ride"
    strip = tr.strips.new("ride", 1, act)
    if hasattr(strip, "action_slot") and act.slots:
        strip.action_slot = act.slots[0]
    tracks["ride"] = {"frames": n, "source": "keyed in Blender from the first frame of sit"}


if "--ride" in argv:
    ride_clip()
arm.animation_data.action = None

# LOD1: decimated copy on the same armature and material.
tris0 = sum(len(p.vertices) - 2 for p in skin.data.polygons)
lod1 = skin.copy()
lod1.data = skin.data.copy()
lod1.name = f"{name}_lod1"
bpy.context.scene.collection.objects.link(lod1)
for c in skin.users_collection:
    if lod1.name not in c.objects:
        c.objects.link(lod1)
dec = lod1.modifiers.new("dec", "DECIMATE")
dec.ratio = min(1.0, lod1_tris / tris0)
mods = [m for m in lod1.modifiers]
# The decimate has to run before the armature deform.
while lod1.modifiers[0].name != "dec":
    bpy.context.view_layer.objects.active = lod1
    bpy.ops.object.modifier_move_up(modifier="dec")
bpy.context.view_layer.objects.active = lod1
bpy.ops.object.modifier_apply(modifier="dec")
tris1 = sum(len(p.vertices) - 2 for p in lod1.data.polygons)
skin["lodDistance"] = 0.0
lod1["lodDistance"] = LOD1_DISTANCE

# Textures.
mat = skin.data.materials[0]
for l in mat.node_tree.links:
    if l.to_node.type == "BSDF_PRINCIPLED":
        node = l.from_node
        while node and node.type != "TEX_IMAGE":
            node = next((k.from_node for k in mat.node_tree.links if k.to_node == node), None)
        cap = TEX.get(l.to_socket.name)
        if node and cap and node.image.size[0] > cap:
            node.image.scale(cap, cap)
if "Specular Tint" in (bsdf := next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")).inputs:
    bsdf.inputs["Specular Tint"].default_value = (1, 1, 1, 1)

for l in mat.node_tree.links:
    if l.to_node.type == "BSDF_PRINCIPLED" and l.from_node.type == "TEX_IMAGE":
        l.from_node.image.name = f"{name}_{l.to_socket.name.lower().replace(' ', '_')}"
for n in mat.node_tree.nodes:
    if n.type == "TEX_IMAGE" and n.image.size[0] == TEX["Metallic"]:
        n.image.name = f"{name}_metal_rough"
    elif n.type == "TEX_IMAGE" and n.image.size[0] == TEX["Normal"]:
        n.image.name = f"{name}_normal"
mat.name = f"{name}_skin"

# Feet on the ground, centered.
dg = bpy.context.evaluated_depsgraph_get()
vs = [skin.matrix_world @ v.co for v in skin.data.vertices]
lo = Vector([min(v[k] for v in vs) for k in range(3)])
hi = Vector([max(v[k] for v in vs) for k in range(3)])

for o in bpy.data.objects:
    o.select_set(o in (arm, skin, lod1))
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
    export_frame_step=1,
    export_cameras=False,
    export_lights=False,
)
stats = {
    "triangles": {"lod0": tris0, "lod1": tris1},
    "bones": len(arm.data.bones),
    "clips": tracks,
    "height_m": round(hi.z - lo.z, 3),
    "bounds_m": {"x": [round(lo.x, 3), round(hi.x, 3)], "y": [round(lo.z, 3), round(hi.z, 3)], "z": [round(-hi.y, 3), round(-lo.y, 3)]},
    "textures": sorted({f"{i.name} {i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.users and i.size[0]}),
}
if opt("--stats"):
    json.dump(stats, open(opt("--stats"), "w"), indent=2)
print("STATS", json.dumps(stats))
