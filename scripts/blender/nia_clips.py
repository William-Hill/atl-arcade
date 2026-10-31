# Keys the Nia skate clips on the Mixamo rig (M1-02).
#
# Run inside Blender (the Blender MCP runs it with exec) on the scene from
# assets/skaters/nia/raw/nia-clean.blend. The armature is "NiaRig".
#
# Armature axes: +X is the skater's left, -Y is forward, +Z is up.
# Leg IK holds the wheels on the ground. Each clip is baked to plain bone
# keys, so the GLB has no constraints.
import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30
ARM = "NiaRig"
LEFT, FWD, UP = (1, 0, 0), (0, -1, 0), (0, 0, 1)


def bone(name):
    return "mixamorig:" + name


def mirror_name(name):
    if name.startswith("Left"):
        return "Right" + name[4:]
    if name.startswith("Right"):
        return "Left" + name[5:]
    return name


def rot(axis, deg):
    return (axis, deg)


# A pose is a dict:
#   "hips": (dx, dy, dz) offset in metres, armature space
#   "hipsRot": [(axis, deg), ...] armature-space rotations of the hips
#   "L" / "R": {"pos": (dx, dy, dz), "rot": [(axis, deg), ...]} foot target offset
#   any other key: a bone name -> [(axis, deg), ...] armature-space rotations
def mirror_pose(pose):
    out = {}
    for key, value in pose.items():
        if key == "hips":
            out[key] = (-value[0], value[1], value[2])
        elif key in ("L", "R"):
            other = "R" if key == "L" else "L"
            out[other] = {
                "pos": (-value["pos"][0], value["pos"][1], value["pos"][2]),
                "rot": [mirror_rot(r) for r in value.get("rot", [])],
            }
        elif key == "hipsRot":
            out[key] = [mirror_rot(r) for r in value]
        else:
            out[mirror_name(key)] = [mirror_rot(r) for r in value]
    return out


def mirror_rot(r):
    # A mirror across the YZ plane maps a rotation axis (x, y, z) to (x, -y, -z).
    axis, deg = r
    return ((axis[0], -axis[1], -axis[2]), deg)


# Base poses -----------------------------------------------------------------

ARMS_DOWN = {
    "LeftArm": [rot(FWD, -72), rot(UP, -8)],
    "RightArm": [rot(FWD, 72), rot(UP, 8)],
    "LeftForeArm": [rot(UP, -15)],
    "RightForeArm": [rot(UP, 15)],
}

STANCE = {
    "hips": (0, 0.02, -0.09),
    "Spine": [rot(LEFT, 8)],
    "Spine1": [rot(LEFT, 6)],
    "Neck": [rot(LEFT, -8)],
    "L": {"pos": (-0.06, -0.06, 0)},
    "R": {"pos": (0.06, 0.05, 0)},
    "LeftArm": [rot(FWD, -62), rot(UP, -22)],
    "RightArm": [rot(FWD, 62), rot(UP, 22)],
    "LeftForeArm": [rot(UP, -30)],
    "RightForeArm": [rot(UP, 30)],
}


# A later pose replaces the value of each key that it names.
def merge(*poses):
    out = {}
    for p in poses:
        out.update(p)
    return out


def stance(**extra):
    return merge(STANCE, extra)


# Clips: name -> (loop, [(frame, pose), ...]) --------------------------------

def idle():
    a = merge(ARMS_DOWN, {"hips": (0, 0, -0.02), "L": {"pos": (-0.04, 0, 0)}, "R": {"pos": (0.04, 0, 0)}, "Spine": [rot(LEFT, 2)]})
    b = merge(ARMS_DOWN, {"hips": (0, 0, -0.035), "L": {"pos": (-0.04, 0, 0)}, "R": {"pos": (0.04, 0, 0)}, "Spine": [rot(LEFT, 4)], "Head": [rot(UP, 6)]})
    return True, [(0, a), (30, b), (60, a)]


def coast():
    a = stance()
    b = stance(hips=(0.015, 0.02, -0.1), Spine=[rot(LEFT, 9), rot(FWD, 3)])
    c = stance(hips=(-0.015, 0.02, -0.1), Spine=[rot(LEFT, 9), rot(FWD, -3)])
    return True, [(0, a), (10, b), (30, c), (40, a)]


def push():
    # The right skate strokes out to the side and back, then returns.
    base = stance(Spine=[rot(LEFT, 18)], Spine1=[rot(LEFT, 8)])
    load = merge(base, {"hips": (0.05, 0.03, -0.14), "LeftArm": [rot(FWD, -60), rot(UP, 30)], "RightArm": [rot(FWD, 60), rot(UP, -25)]})
    out = merge(load, {"R": {"pos": (-0.28, 0.3, 0.02), "rot": [rot(UP, -25)]}, "hips": (0.07, 0.0, -0.15)})
    back = merge(base, {"R": {"pos": (0.0, 0.12, 0.08)}})
    return True, [(0, base), (4, load), (8, out), (11, back), (12, base)]


def carve_left():
    lean = stance(
        hips=(0.06, 0.02, -0.12),
        hipsRot=[rot(FWD, -8), rot(UP, 10)],
        Spine=[rot(LEFT, 10), rot(FWD, -6)],
        Spine1=[rot(FWD, -4)],
        Head=[rot(UP, 10)],
        LeftArm=[rot(FWD, -75), rot(UP, -10)],
        RightArm=[rot(FWD, 35), rot(UP, 35)],
    )
    deep = merge(lean, {"hips": (0.07, 0.02, -0.14)})
    return True, [(0, lean), (20, deep), (40, lean)]


def carve_right():
    loop, keys = carve_left()
    return loop, [(f, mirror_pose(p)) for f, p in keys]


def jump():
    crouch = stance(hips=(0, 0.03, -0.2), Spine=[rot(LEFT, 25)], LeftArm=[rot(FWD, -50), rot(UP, 40)], RightArm=[rot(FWD, 50), rot(UP, -40)])
    up = merge(stance(), {"hips": (0, 0, 0.0), "L": {"pos": (-0.04, 0.02, 0.18)}, "R": {"pos": (0.04, 0.06, 0.22)},
                          "LeftArm": [rot(FWD, -20), rot(UP, -30)], "RightArm": [rot(FWD, 20), rot(UP, 30)]})
    tuck = merge(up, {"L": {"pos": (-0.04, -0.02, 0.3)}, "R": {"pos": (0.04, 0.02, 0.32)}, "Spine": [rot(LEFT, 15)]})
    return False, [(0, crouch), (5, up), (12, tuck), (24, tuck)]


def air_trick_1():
    # Grab: deep tuck, the right hand reaches for the right skate.
    grab = merge(stance(), {
        "hips": (0, 0, 0.05),
        "L": {"pos": (-0.02, -0.08, 0.42)},
        "R": {"pos": (0.02, -0.05, 0.45)},
        "Spine": [rot(LEFT, 30)], "Spine1": [rot(LEFT, 15)],
        "RightArm": [rot(FWD, 85), rot(UP, 45)], "RightForeArm": [rot(UP, 20)],
        "LeftArm": [rot(FWD, -10), rot(UP, -20)],
    })
    reach = merge(grab, {"Spine": [rot(LEFT, 36)]})
    return True, [(0, grab), (12, reach), (24, grab)]


def air_trick_2():
    # Split: one skate forward, one back, arms up and out.
    split = merge(stance(), {
        "hips": (0, 0, 0.05),
        "L": {"pos": (-0.04, -0.45, 0.3), "rot": [rot(LEFT, 25)]},
        "R": {"pos": (0.04, 0.4, 0.3), "rot": [rot(LEFT, -20)]},
        "Spine": [rot(LEFT, -4)],
        "LeftArm": [rot(FWD, 35), rot(UP, -25)], "RightArm": [rot(FWD, -35), rot(UP, 25)],
    })
    wide = merge(split, {"L": {"pos": (-0.04, -0.5, 0.33), "rot": [rot(LEFT, 30)]}, "R": {"pos": (0.04, 0.45, 0.33), "rot": [rot(LEFT, -25)]}})
    return True, [(0, split), (12, wide), (24, split)]


def grind():
    # Parallel skates on the rail, low, arms out and forward for balance.
    a = stance(
        hips=(0, 0.04, -0.17),
        L={"pos": (-0.1, 0.0, 0)}, R={"pos": (0.1, 0.0, 0)},
        Spine=[rot(LEFT, 20)], Spine1=[rot(LEFT, 6)], Neck=[rot(LEFT, -15)],
        LeftArm=[rot(FWD, -35), rot(UP, -35)], RightArm=[rot(FWD, 35), rot(UP, 35)],
        LeftForeArm=[rot(UP, -25)], RightForeArm=[rot(UP, 25)],
    )
    b = merge(a, {"hipsRot": [rot(FWD, 4)], "Spine": [rot(FWD, -4)], "LeftArm": [rot(FWD, -28), rot(UP, -35)], "RightArm": [rot(FWD, 42), rot(UP, 35)]})
    c = merge(a, {"hipsRot": [rot(FWD, -4)], "Spine": [rot(FWD, 4)], "LeftArm": [rot(FWD, -42), rot(UP, -35)], "RightArm": [rot(FWD, 28), rot(UP, 35)]})
    return True, [(0, a), (10, b), (30, c), (40, a)]


def manual():
    # Rear wheels only: the front skate is out with the toe up, the body leans back.
    a = stance(
        hips=(0, 0.06, -0.12),
        L={"pos": (-0.05, -0.28, 0.05), "rot": [rot(LEFT, 18)]}, R={"pos": (0.05, 0.12, 0)},
        Spine=[rot(LEFT, -6)], Spine1=[rot(LEFT, -4)],
        LeftArm=[rot(FWD, -55), rot(UP, -45)], RightArm=[rot(FWD, 55), rot(UP, 45)],
    )
    b = merge(a, {"L": {"pos": (-0.05, -0.3, 0.07), "rot": [rot(LEFT, 22)]}})
    return True, [(0, a), (15, b), (30, a)]


def bail():
    trip = stance(hips=(0.05, -0.02, -0.12), hipsRot=[rot(UP, 15)], Spine=[rot(LEFT, -15), rot(FWD, 10)],
                  LeftArm=[rot(FWD, 30), rot(UP, -40)], RightArm=[rot(FWD, -20), rot(UP, 50)], Head=[rot(LEFT, -15)])
    flail = merge(trip, {"hips": (0.08, 0.0, -0.22), "Spine": [rot(LEFT, 25), rot(FWD, -12)], "LeftArm": [rot(FWD, -10), rot(UP, -70)], "RightArm": [rot(FWD, 10), rot(UP, 70)],
                         "L": {"pos": (-0.1, -0.1, 0)}, "R": {"pos": (0.15, 0.15, 0)}})
    down = merge(flail, {"hips": (0.06, 0.05, -0.42), "Spine": [rot(LEFT, 40)], "LeftArm": [rot(FWD, -70), rot(UP, -60)], "RightArm": [rot(FWD, 70), rot(UP, 60)]})
    return False, [(0, trip), (8, flail), (18, down), (30, down)]


def dance_1():
    # Shuffle (0.5 s): knee bob and arm pumps.
    a = stance(hips=(0, 0.02, -0.08), LeftArm=[rot(FWD, -65), rot(UP, -60)], LeftForeArm=[rot(UP, -80)], RightArm=[rot(FWD, 65), rot(UP, 60)], RightForeArm=[rot(UP, 80)])
    b = merge(a, {"hips": (0.03, 0.02, -0.16), "L": {"pos": (-0.1, -0.06, 0)}, "LeftArm": [rot(FWD, -40), rot(UP, -70)], "RightArm": [rot(FWD, 80), rot(UP, 40)], "Head": [rot(FWD, -10)]})
    c = merge(a, {"hips": (-0.03, 0.02, -0.16), "R": {"pos": (0.1, 0.05, 0)}, "LeftArm": [rot(FWD, -80), rot(UP, -40)], "RightArm": [rot(FWD, 40), rot(UP, 70)], "Head": [rot(FWD, 10)]})
    return True, [(0, a), (4, b), (8, a), (12, c), (15, a)]


def dance_2():
    # Spin (0.7 s): the arms pull in, the left hand goes up. The renderer turns the body.
    a = stance(hips=(0, 0.0, -0.04), L={"pos": (-0.02, 0, 0)}, R={"pos": (0.02, 0, 0)},
               LeftArm=[rot(FWD, 70), rot(UP, -10)], LeftForeArm=[rot(UP, -30)],
               RightArm=[rot(FWD, 70), rot(UP, 60)], RightForeArm=[rot(UP, 100)], Spine=[rot(LEFT, -4)])
    b = merge(a, {"hips": (0, 0, -0.02), "LeftArm": [rot(FWD, 85), rot(UP, -5)]})
    return True, [(0, a), (10, b), (21, a)]


def dance_3():
    # Hip sway with a wave.
    a = stance(hips=(0.05, 0.02, -0.09), hipsRot=[rot(FWD, -6)], Spine=[rot(FWD, 8)],
               LeftArm=[rot(FWD, 50), rot(UP, -10)], LeftForeArm=[rot(FWD, -40)], RightArm=[rot(FWD, 70)])
    b = mirror_pose(a)
    return True, [(0, a), (8, b), (15, a)]


def dance_4():
    # Both arms overhead, a slow body roll.
    a = stance(hips=(0, 0.0, -0.06), LeftArm=[rot(FWD, 60), rot(UP, -20)], RightArm=[rot(FWD, -60), rot(UP, 20)],
               LeftForeArm=[rot(FWD, 30)], RightForeArm=[rot(FWD, -30)], Spine=[rot(LEFT, -8)], Head=[rot(LEFT, -12)])
    b = merge(a, {"hips": (0, 0.03, -0.14), "Spine": [rot(LEFT, 14)], "Head": [rot(LEFT, 5)]})
    return True, [(0, a), (10, b), (21, a)]


CLIPS = {
    "idle": idle, "push": push, "coast": coast, "carve_left": carve_left, "carve_right": carve_right,
    "jump": jump, "air_trick_1": air_trick_1, "air_trick_2": air_trick_2, "grind": grind,
    "manual": manual, "bail": bail, "dance_1": dance_1, "dance_2": dance_2, "dance_3": dance_3, "dance_4": dance_4,
}


# Rig setup ------------------------------------------------------------------

def rest_rot(pb):
    return pb.bone.matrix_local.to_3x3()


def local_quat(pb, rotations):
    q = Quaternion()
    r = rest_rot(pb)
    rinv = r.inverted()
    for axis, deg in rotations:
        q = Quaternion(rinv @ Vector(axis), math.radians(deg)) @ q
    return q


def setup_ik(arm):
    objs = {}
    for side in ("L", "R"):
        full = "Left" if side == "L" else "Right"
        foot = arm.pose.bones[bone(full + "Foot")]
        knee = arm.data.bones[bone(full + "Leg")]
        tgt = bpy.data.objects.get("IK_" + side) or bpy.data.objects.new("IK_" + side, None)
        pole = bpy.data.objects.get("Pole_" + side) or bpy.data.objects.new("Pole_" + side, None)
        for o in (tgt, pole):
            if o.name not in bpy.context.scene.collection.objects:
                bpy.context.scene.collection.objects.link(o)
        tgt.matrix_world = arm.matrix_world @ foot.bone.matrix_local
        pole.location = arm.matrix_world @ (knee.head_local + Vector((0, -0.6, 0)))
        leg = arm.pose.bones[bone(full + "Leg")]
        for c in list(leg.constraints):
            leg.constraints.remove(c)
        for c in list(foot.constraints):
            foot.constraints.remove(c)
        ik = leg.constraints.new("IK")
        ik.target = tgt
        ik.pole_target = pole
        ik.pole_angle = 0.0  # measured: 0 points both knees forward (-Y)
        ik.chain_count = 2
        cr = foot.constraints.new("COPY_ROTATION")
        cr.target = tgt
        objs[side] = (tgt, pole, tgt.matrix_world.copy())
    return objs


def apply_pose(arm, ik, pose, frame):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    hips = arm.pose.bones[bone("Hips")]
    if "hips" in pose:
        hips.location = rest_rot(hips).inverted() @ Vector(pose["hips"])
    if "hipsRot" in pose:
        hips.rotation_quaternion = local_quat(hips, pose["hipsRot"])
    for key, value in pose.items():
        if key in ("hips", "hipsRot", "L", "R"):
            continue
        pb = arm.pose.bones[bone(key)]
        pb.rotation_quaternion = local_quat(pb, value)
    for side in ("L", "R"):
        tgt, _pole, rest = ik[side]
        spec = pose.get(side, {"pos": (0, 0, 0)})
        rq = Quaternion()
        for axis, deg in spec.get("rot", []):
            rq = Quaternion(Vector(axis), math.radians(deg)) @ rq
        m = Matrix.Translation(rest.to_translation() + Vector(spec["pos"])) @ (rq.to_matrix().to_4x4() @ rest.to_3x3().to_4x4())
        tgt.matrix_world = m
        tgt.keyframe_insert("location", frame=frame)
        tgt.keyframe_insert("rotation_euler", frame=frame)
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        if pb.name == bone("Hips"):
            pb.keyframe_insert("location", frame=frame)


# The operators need a window and a 3D view. The MCP runs code in a timer,
# which has neither.
def view3d_context():
    win = bpy.context.window_manager.windows[0]
    area = next(a for a in win.screen.areas if a.type == "VIEW_3D")
    region = next(r for r in area.regions if r.type == "WINDOW")
    return {"window": win, "screen": win.screen, "area": area, "region": region}


def build_clip(arm, ik, name):
    loop, keys = CLIPS[name]()
    arm.animation_data_create()
    src = bpy.data.actions.new(name + "_src")
    arm.animation_data.action = src
    for side in ("L", "R"):
        ik[side][0].animation_data_create()
        ik[side][0].animation_data.action = bpy.data.actions.new(name + "_ik_" + side)
    for frame, pose in keys:
        apply_pose(arm, ik, pose, frame)
    end = keys[-1][0]
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = end
    bpy.context.view_layer.objects.active = arm
    for o in bpy.context.view_layer.objects:
        o.select_set(o == arm)
    with bpy.context.temp_override(**view3d_context()):
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.nla.bake(frame_start=0, frame_end=end, only_selected=False, visual_keying=True,
                         clear_constraints=False, use_current_action=False, bake_types={"POSE"})
        bpy.ops.object.mode_set(mode="OBJECT")
    baked = arm.animation_data.action
    baked.name = name
    baked.use_fake_user = True
    baked["loop"] = loop
    # Keep the baked action on an NLA track so that the exporter writes it.
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, baked)
    track.mute = True
    arm.animation_data.action = None
    for a in [src] + [bpy.data.actions[name + "_ik_" + s] for s in ("L", "R")]:
        bpy.data.actions.remove(a)
    return baked


def clear_rig(arm):
    for pb in arm.pose.bones:
        for c in list(pb.constraints):
            pb.constraints.remove(c)
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    for n in ("IK_L", "IK_R", "Pole_L", "Pole_R"):
        if n in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[n], do_unlink=True)


def build_all(names=None):
    bpy.context.scene.render.fps = FPS
    arm = bpy.data.objects[ARM]
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    ik = setup_ik(arm)
    out = [build_clip(arm, ik, n) for n in (names or CLIPS)]
    clear_rig(arm)
    return out


# Export ---------------------------------------------------------------------

def action_fcurves(action):
    # Blender 4.4+ keeps the curves in layered actions. Older versions use action.fcurves.
    if hasattr(action, "layers") and action.layers:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    out.append(bag)
        return out
    return [action]


REST = {"location": 0.0, "scale": 1.0, "rotation_quaternion": None}


# Removes each curve that stays at its rest value for the whole clip.
# Three.js blends a bone with no track back to its rest pose.
def prune_static_channels(eps=1e-4):
    removed = 0
    for action in bpy.data.actions:
        for bag in action_fcurves(action):
            for fc in list(bag.fcurves):
                values = [k.co[1] for k in fc.keyframe_points]
                prop = fc.data_path.rsplit(".", 1)[-1]
                if prop == "rotation_quaternion":
                    rest = 1.0 if fc.array_index == 0 else 0.0
                else:
                    rest = REST.get(prop, None)
                if rest is None:
                    continue
                if all(abs(v - rest) < eps for v in values):
                    bag.fcurves.remove(fc)
                    removed += 1
            # The bake writes one key per frame, so linear keys are exact.
            for fc in bag.fcurves:
                for k in fc.keyframe_points:
                    k.interpolation = "LINEAR"
    return removed


def export(path, draco):
    arm = bpy.data.objects[ARM]
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    bpy.context.scene.frame_set(0)
    for o in bpy.context.view_layer.objects:
        o.select_set(o.name in ("Nia", ARM))
    opts = dict(
        export_format="GLB", use_selection=True, export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=False, export_optimize_animation_size=True,
        export_anim_slide_to_zero=True, export_reset_pose_bones=True, export_extras=False, export_yup=True,
        export_draco_mesh_compression_enable=draco,
    )
    if draco:
        opts.update(
            export_draco_mesh_compression_level=6, export_draco_position_quantization=14,
            export_draco_normal_quantization=10, export_draco_texcoord_quantization=12,
            export_draco_generic_quantization=12,
        )
    bpy.ops.export_scene.gltf(filepath=path, **opts)
