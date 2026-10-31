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
        elif key == "pole":
            out[key] = -value
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
#
# The style rules and the sources are in docs/characters/skate-style-references.md.
# Free skate is Atlanta rink style: glide, bounce on the beat, weight shifts,
# cross steps, claps. Rails and air are X Games aggressive skating.
#
# The beat is 75 BPM: one beat is 24 frames at 30 fps. Each groove clip is a
# whole number of beats, and frame 0 is a downbeat.
BEAT = 24

# Rest foot positions (armature space): left (0.242, 0.03), right (-0.236, 0.03).
# A foot "pos" is an offset from the rest position.
LX, RX = 0.242, -0.236


def at(x, y=0.0, z=0.0, side="L", rot=None):
    # A foot target at an absolute x, y (armature space) instead of an offset.
    rest_x = LX if side == "L" else RX
    out = {"pos": (x - rest_x, y - 0.03, z)}
    if rot:
        out["rot"] = rot
    return out


ARMS_DOWN = {
    "LeftArm": [rot(FWD, -72), rot(UP, -8)],
    "RightArm": [rot(FWD, 72), rot(UP, 8)],
    "LeftForeArm": [rot(UP, -15)],
    "RightForeArm": [rot(UP, 15)],
}


# A later pose replaces the value of each key that it names.
def merge(*poses):
    out = {}
    for p in poses:
        out.update(p)
    return out


def ride(side=0.0, down=0.0, lean=4.0):
    # The ATL ride stance: upright chest, soft knees, skates under the hips.
    # side: +1 puts the weight on the left skate, -1 on the right skate.
    # down: the bounce depth in metres. The head nods with the bounce.
    # The arms swing against the legs, and the shoulders turn against the hips.
    return {
        "hips": (0.05 * side, 0.02, -0.11 - down),
        "hipsRot": [rot(UP, 9 * side), rot(FWD, -4 * side)],
        "Spine": [rot(LEFT, lean), rot(FWD, -6 * side)],
        "Spine1": [rot(UP, -16 * side), rot(FWD, 3 * side)],
        "Neck": [rot(LEFT, -4)],
        "Head": [rot(LEFT, 140 * down), rot(UP, 8 * side), rot(FWD, 5 * side)],
        "L": at(0.09 + 0.02 * side, -0.02, 0, "L", [rot(UP, 8)]),
        "R": at(-0.09 + 0.02 * side, 0.06, 0, "R", [rot(UP, -8)]),
        # A hanging arm swings about LEFT: a negative angle swings it forward.
        "LeftArm": [rot(FWD, -78), rot(LEFT, 32 * side)],
        "RightArm": [rot(FWD, 78), rot(LEFT, -32 * side)],
        "LeftForeArm": [rot(UP, -38 - 14 * max(-side, 0))],
        "RightForeArm": [rot(UP, 38 + 14 * max(side, 0))],
        "LeftHand": [rot(FWD, -10)],
        "RightHand": [rot(FWD, 10)],
    }


CLAP = {
    # The hands rise from the shoulders and meet in front of the chest.
    "LeftArm": [rot(FWD, -25), rot(UP, -62)],
    "RightArm": [rot(FWD, 25), rot(UP, 62)],
    "LeftForeArm": [rot(UP, -62)],
    "RightForeArm": [rot(UP, 62)],
}

# The arms when the hands rise to clap, one half beat before the clap.
CLAP_UP = {
    "LeftArm": [rot(FWD, -5), rot(UP, -40)],
    "RightArm": [rot(FWD, 5), rot(UP, 40)],
    "LeftForeArm": [rot(UP, -80)],
    "RightForeArm": [rot(UP, 80)],
}


def stance(**extra):
    return merge(ride(), extra)


# Clips: name -> (loop, [(frame, pose), ...]) --------------------------------

def idle():
    # Standing groove, one bar: a bounce on every beat, a clap on beats 2 and 4,
    # and the weight shifts every two beats.
    B = BEAT
    keys = []
    for beat in range(4):
        f = beat * B
        side = 1 if beat in (0, 1) else -1
        down = merge(ride(side * 0.6, 0.05, lean=2), {"L": at(0.13, 0.0), "R": at(-0.13, 0.0, side="R")})
        up = merge(ride(side * 0.6, 0.0, lean=2), {"L": at(0.13, 0.0), "R": at(-0.13, 0.0, side="R")})
        if beat in (1, 3):
            down = merge(down, CLAP)
        if beat in (0, 2):
            up = merge(up, CLAP_UP)
        keys += [(f, down), (f + B // 2, up)]
    return True, keys + [(4 * B, keys[0][1])]


def coast():
    # ATL ride, two beats: glide on both skates, bounce on each beat, the
    # weight rocks left on beat 1 and right on beat 2.
    B = BEAT
    return True, [
        (0, ride(1, 0.08)),
        (B // 2, ride(0.4, -0.01)),
        (B, ride(-1, 0.08)),
        (B + B // 2, ride(-0.4, -0.01)),
        (2 * B, ride(1, 0.08)),
    ]


def ride_back():
    # Backward ride, one bar. The renderer turns the model to face back.
    # The skates swizzle (heels out, then in), the body bounces on the beat,
    # and the head looks over the left shoulder, then the right shoulder.
    B = BEAT
    keys = []
    for beat in range(4):
        f = beat * B
        look = 1 if beat in (0, 1) else -1
        out = beat % 2 == 0
        heel = 14 if out else -4
        base = ride(look * 0.5, 0.05, lean=8)
        feet = {
            "L": at(0.12 if out else 0.08, 0.0, 0, "L", [rot(UP, -heel)]),
            "R": at(-0.12 if out else -0.08, 0.0, 0, "R", [rot(UP, heel)]),
        }
        head = {"Neck": [rot(UP, 22 * look)], "Head": [rot(UP, 30 * look), rot(LEFT, 6)], "Spine1": [rot(UP, 12 * look)]}
        down = merge(base, feet, head)
        if beat == 2:
            # Call-out on beat 3: the right hand goes up.
            down = merge(down, {"RightArm": [rot(FWD, -55), rot(UP, 15)], "RightForeArm": [rot(UP, 25)]})
        up = merge(down, {"hips": (base["hips"][0], 0.02, -0.07)})
        keys += [(f, down), (f + B // 2, up)]
    return True, keys + [(4 * B, keys[0][1])]


def _stride_right():
    # One stride: the weight is on the left skate, the right skate pushes out
    # to the side on its inside edge and comes back under the hips.
    glide = ride(1, 0.06, lean=16)
    out = merge(glide, {
        "hips": (0.07, 0.02, -0.21),
        "R": at(-0.42, 0.07, 0, "R", [rot(UP, -40), rot(FWD, 12)]),
        "L": at(0.10, -0.04, 0, "L", [rot(UP, 4)]),
        "LeftArm": [rot(FWD, -74), rot(LEFT, -40)],
        "RightArm": [rot(FWD, 72), rot(LEFT, 36)],
        "Spine1": [rot(UP, -16)],
    })
    back = merge(ride(0.3, 0.0, lean=12), {"R": at(-0.12, 0.06, 0.05, "R", [rot(UP, -10)])})
    return glide, out, back


def push():
    # ATL stride, two strokes (0.8 s, one beat): right, then left. Each stroke
    # is 0.4 s, the same as SKATE.pushCooldown. The arms swing across the body.
    glide, out, back = _stride_right()
    return True, [
        (0, glide), (6, out), (10, back),
        (12, mirror_pose(glide)), (18, mirror_pose(out)), (22, mirror_pose(back)),
        (24, glide),
    ]


def carve_left():
    # Cross Step to the left, one beat: the right skate crosses over the left
    # skate, lands, and then the left skate steps out from under it.
    lean = {"hipsRot": [rot(FWD, -9), rot(UP, 10)], "Spine": [rot(LEFT, 9), rot(FWD, -7)], "Head": [rot(UP, 16)],
            "LeftArm": [rot(FWD, -68), rot(LEFT, 30)], "RightArm": [rot(FWD, 62), rot(LEFT, -38)], "Spine1": [rot(UP, 8)]}
    open_ = merge(ride(0.3, 0.03, lean=8), lean, {"hips": (0.06, 0.02, -0.11), "L": at(0.16, 0.0), "R": at(-0.10, 0.04, side="R")})
    cross = merge(open_, {"R": at(0.15, -0.10, 0.13, "R", [rot(UP, 14)]), "hips": (0.07, 0.02, -0.08)})
    land = merge(open_, {"R": at(0.11, -0.08, 0, "R", [rot(UP, 12)]), "L": at(0.20, 0.06), "hips": (0.09, 0.02, -0.18)})
    step = merge(land, {"L": at(0.30, 0.06, 0.06, "L", [rot(UP, 12)]), "R": at(0.0, -0.04, 0, "R"), "hips": (0.08, 0.02, -0.12)})
    return True, [(0, open_), (7, cross), (12, land), (18, step), (24, open_)]


def carve_right():
    loop, keys = carve_left()
    return loop, [(f, mirror_pose(p)) for f, p in keys]


def jump():
    # X Games pop: the arms swing back, then up, and the knees tuck.
    crouch = merge(ride(0, 0.16, lean=24), {
        "LeftArm": [rot(FWD, -76), rot(LEFT, 50)], "RightArm": [rot(FWD, 76), rot(LEFT, 50)],
    })
    pop = merge(ride(0, -0.04, lean=0), {
        "L": at(0.12, 0.0, 0.16), "R": at(-0.12, 0.04, 0.18, "R"),
        "LeftArm": [rot(FWD, -76), rot(LEFT, -110)], "RightArm": [rot(FWD, 76), rot(LEFT, -110)],
    })
    tuck = merge(pop, {"L": at(0.1, -0.04, 0.34), "R": at(-0.1, 0.0, 0.36, "R"), "Spine": [rot(LEFT, 16)],
                       "LeftArm": [rot(FWD, -76), rot(LEFT, -70)], "RightArm": [rot(FWD, 76), rot(LEFT, -70)]})
    return False, [(0, crouch), (5, pop), (11, tuck), (20, tuck)]


def land():
    # The landing: the knees take the impact, the arms go out, then the skater
    # rises with a shoulder pop.
    hit = merge(ride(0, 0.22, lean=20), {
        "L": at(0.14, -0.04), "R": at(-0.14, 0.08, side="R"),
        "LeftArm": [rot(FWD, -20), rot(UP, -20)], "RightArm": [rot(FWD, 20), rot(UP, 20)],
    })
    rise = merge(ride(0.5, 0.04, lean=6), {"Spine1": [rot(UP, -14)], "Head": [rot(UP, 10)]})
    return False, [(0, hit), (5, hit), (9, rise)]


def _air(**extra):
    base = merge(ride(0, -0.05, lean=10), {"hips": (0, 0, 0.05)})
    return merge(base, extra)


def air_mute():
    # Mute grab: both knees tuck, the left hand grabs the right skate across
    # the body, the right arm goes back and up.
    grab = _air(
        L=at(0.06, -0.04, 0.44), R=at(-0.08, 0.0, 0.42, "R"),
        Spine=[rot(LEFT, 34)], Spine1=[rot(UP, -18), rot(LEFT, 10)],
        LeftArm=[rot(FWD, -70), rot(UP, -60)], LeftForeArm=[rot(UP, -20)],
        RightArm=[rot(FWD, -30), rot(UP, -35)], RightForeArm=[rot(UP, 20)],
        Head=[rot(UP, -10)],
    )
    deep = merge(grab, {"Spine": [rot(LEFT, 40)], "L": at(0.06, -0.06, 0.48), "R": at(-0.08, -0.02, 0.46, "R")})
    return True, [(0, grab), (12, deep), (24, grab)]


def air_japan():
    # Japan: the right skate comes up behind, the left hand reaches behind to
    # grab it, the left knee tucks forward. The back arches.
    grab = _air(
        L=at(0.08, -0.14, 0.40), R=at(-0.04, 0.36, 0.56, "R", [rot(LEFT, -40)]),
        Spine=[rot(LEFT, -10)], Spine1=[rot(UP, 14)],
        LeftArm=[rot(FWD, -62), rot(UP, 55)], LeftForeArm=[rot(UP, -10)],
        RightArm=[rot(FWD, -50), rot(UP, 10)], RightForeArm=[rot(UP, 20)],
        Head=[rot(LEFT, -8), rot(UP, 12)],
    )
    deep = merge(grab, {"R": at(-0.04, 0.40, 0.60, "R", [rot(LEFT, -48)])})
    return True, [(0, grab), (12, deep), (24, grab)]


def air_liukang():
    # Liu Kang: the left knee tucks to the chest and the left hand holds the
    # skate, the right leg kicks out straight, the right arm goes up and out.
    grab = _air(
        L=at(0.10, -0.12, 0.52), R=at(-0.36, 0.0, 0.04, "R", [rot(FWD, 20)]),
        Spine=[rot(LEFT, 18), rot(FWD, -8)],
        LeftArm=[rot(FWD, -66), rot(UP, -45)], LeftForeArm=[rot(UP, -25)],
        RightArm=[rot(FWD, -40), rot(UP, 15)], RightForeArm=[rot(UP, 10)],
        Head=[rot(UP, -14)],
    )
    deep = merge(grab, {"R": at(-0.40, 0.0, 0.06, "R", [rot(FWD, 24)])})
    return True, [(0, grab), (12, deep), (24, grab)]


def _grind(turn, L, R, **extra):
    # A rail stance. turn: the yaw of the hips and the knees, in degrees.
    # The head turns back to look along the rail.
    base = {
        "hips": (0, 0.02, -0.2),
        "hipsRot": [rot(UP, turn)],
        "pole": turn,
        "Spine": [rot(LEFT, 16)],
        "Spine1": [rot(LEFT, 4)],
        "Neck": [rot(UP, -turn * 0.4)],
        "Head": [rot(UP, -turn * 0.4), rot(LEFT, 8)],
        "L": L, "R": R,
        "LeftArm": [rot(FWD, -25), rot(UP, -8)], "RightArm": [rot(FWD, 25), rot(UP, 8)],
        "LeftForeArm": [rot(UP, -20)], "RightForeArm": [rot(UP, 20)],
    }
    return merge(base, extra)


def _wobble(a):
    b = merge(a, {"Spine": a["Spine"] + [rot(FWD, -5)], "LeftArm": [rot(FWD, -15), rot(UP, -8)], "RightArm": [rot(FWD, 35), rot(UP, 8)]})
    c = merge(a, {"Spine": a["Spine"] + [rot(FWD, 5)], "LeftArm": [rot(FWD, -35), rot(UP, -8)], "RightArm": [rot(FWD, 15), rot(UP, 8)]})
    return True, [(0, a), (12, b), (36, c), (48, a)]


def grind_frontside():
    # Frontside: the body turns 90 degrees to the rail, both skates go across
    # the rail, the knees are low, the arms point along the rail.
    a = _grind(
        85,
        at(0.0, 0.20, 0, "L", [rot(UP, 85)]),
        at(0.0, -0.16, 0, "R", [rot(UP, 85)]),
    )
    return _wobble(a)


def grind_soul():
    # Soul: the front (left) skate goes across the rail, the back (right) skate
    # goes along the rail on its edge. The right arm goes back and up.
    a = _grind(
        40,
        at(0.0, -0.18, 0, "L", [rot(UP, 85)]),
        at(0.0, 0.20, 0, "R", [rot(UP, 5), rot(FWD, 22)]),
        RightArm=[rot(FWD, -25), rot(UP, -40)],
        hips=(0, 0.02, -0.17),
    )
    return _wobble(a)


def grind_unity():
    # Unity: the legs cross, the left skate in front of the right, and both
    # grind on the outside of the boot. The arms go wide and up.
    a = _grind(
        70,
        at(-0.05, -0.06, 0, "L", [rot(UP, 80), rot(FWD, 15)]),
        at(0.05, 0.12, 0, "R", [rot(UP, 80), rot(FWD, -15)]),
        hips=(0, 0.02, -0.14),
        Spine=[rot(LEFT, 8)],
        LeftArm=[rot(FWD, 10), rot(UP, -10)], RightArm=[rot(FWD, -10), rot(UP, 10)],
    )
    return _wobble(a)


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


def dance_prep():
    # The Prep (shuffle, 0.5 s): a stutter step forward, the left skate crosses
    # behind the right skate, and a clap keeps the step going.
    base = ride(0, 0.02)
    behind = merge(ride(-0.6, 0.08), {"L": at(-0.10, 0.18, 0.02, "L", [rot(UP, -10)]), "R": at(-0.08, 0.0, side="R")}, CLAP_UP)
    clap = merge(ride(-0.3, 0.1), {"L": at(-0.06, 0.14), "R": at(-0.08, 0.0, side="R")}, CLAP)
    return True, [(0, base), (5, behind), (8, clap), (12, base), (15, base)]


def dance_crisscross():
    # Crisscross (shuffle, 0.5 s): the skates cross on the beat, the left skate
    # in front, then open again. The hands clap at the cross.
    open_ = merge(ride(0, 0.02), {"L": at(0.2, 0.0), "R": at(-0.2, 0.0, side="R")}, CLAP_UP)
    cross = merge(ride(0, 0.09), {"L": at(-0.07, -0.07, 0, "L", [rot(UP, -8)]), "R": at(0.07, 0.08, 0, "R", [rot(UP, 8)])}, CLAP)
    return True, [(0, open_), (7, cross), (15, open_)]


def dance_spin():
    # Toe-stop spin (0.7 s): the skates come together on the toe stops, the left
    # arm goes up, the right arm wraps the chest. The renderer turns the body.
    a = merge(ride(0, -0.02, lean=-2), {
        "L": at(0.07, 0.0, 0.05, "L", [rot(LEFT, 25)]), "R": at(-0.07, 0.0, 0.05, "R", [rot(LEFT, 25)]),
        "LeftArm": [rot(FWD, 75), rot(UP, -10)], "LeftForeArm": [rot(UP, -20)],
        "RightArm": [rot(FWD, 65), rot(UP, 80)], "RightForeArm": [rot(UP, 100)],
        "Head": [rot(LEFT, -12)],
    })
    b = merge(a, {"LeftArm": [rot(FWD, 85), rot(UP, -5)], "hips": (0, 0.02, -0.06)})
    return True, [(0, a), (10, b), (21, a)]


def dance_sitspin():
    # Sit spin (0.7 s): the skater drops low on the right skate, the left leg
    # goes out in front, the arms reach forward. The renderer turns the body.
    a = merge(ride(0, 0.36, lean=26), {
        "hips": (0, 0.06, -0.43),
        "R": at(-0.08, 0.06, 0, "R"),
        "L": at(0.08, -0.48, 0.12, "L", [rot(LEFT, -15)]),
        "LeftArm": [rot(FWD, -10), rot(UP, -70)], "RightArm": [rot(FWD, 10), rot(UP, 70)],
        "Head": [rot(LEFT, -14)],
    })
    b = merge(a, {"hips": (0, 0.06, -0.47)})
    return True, [(0, a), (10, b), (21, a)]


CLIPS = {
    "idle": idle, "push": push, "coast": coast, "ride_back": ride_back,
    "carve_left": carve_left, "carve_right": carve_right,
    "jump": jump, "land": land, "air_mute": air_mute, "air_japan": air_japan, "air_liukang": air_liukang,
    "grind_frontside": grind_frontside, "grind_soul": grind_soul, "grind_unity": grind_unity,
    "manual": manual, "bail": bail,
    "dance_prep": dance_prep, "dance_crisscross": dance_crisscross, "dance_spin": dance_spin, "dance_sitspin": dance_sitspin,
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
        objs[side] = (tgt, pole, tgt.matrix_world.copy(), pole.location.copy())
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
        if key in ("hips", "hipsRot", "L", "R", "pole"):
            continue
        pb = arm.pose.bones[bone(key)]
        pb.rotation_quaternion = local_quat(pb, value)
    for side in ("L", "R"):
        tgt, pole, rest, pole_rest = ik[side]
        # "pole" turns the knee direction about the hips with the body (degrees).
        pivot = hips.bone.head_local.copy()
        turn = Matrix.Rotation(math.radians(pose.get("pole", 0)), 3, "Z")
        pole.location = pivot + turn @ (pole_rest - pivot) + Vector(pose.get("hips", (0, 0, 0)))
        pole.keyframe_insert("location", frame=frame)
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
        ik[side][1].animation_data_create()
        ik[side][1].animation_data.action = bpy.data.actions.new(name + "_pole_" + side)
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
    for a in [src] + [bpy.data.actions[name + k + s] for k in ("_ik_", "_pole_") for s in ("L", "R")]:
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
