# Keys the skate clips on a Mixamo rig (M1-02). Nia was first; M1-10 added Marcus.
#
# Run inside Blender (the Blender MCP runs it with exec) on the scene from
# assets/skaters/<name>/raw/<name>-clean.blend. For Nia, the armature is
# "NiaRig" and the mesh is "Nia". For another skater, set SKATER_CFG in the
# exec globals before the run, for example:
#   {"arm": "MarcusRig", "mesh": "Marcus", "feet": (0.20, -0.20, 0.03)}
# "feet" is the rest x of the left foot, the rest x of the right foot, and the
# rest y of both feet, in armature space (metres).
#
# Armature axes: +X is the skater's left, -Y is forward, +Z is up.
# Leg IK holds the wheels on the ground. Each clip is baked to plain bone
# keys, so the GLB has no constraints.
import math

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

FPS = 30
CFG = globals().get("SKATER_CFG") or {}
ARM = CFG.get("arm", "NiaRig")
MESH = CFG.get("mesh", "Nia")
LEFT, FWD, UP = (1, 0, 0), (0, -1, 0), (0, 0, 1)
# CURL is a per-bone axis: the finger direction crossed with the palm normal
# (down in the rest pose). A positive angle curls a finger toward the palm on
# both hands, also for a splayed finger.
CURL = "curl"
# STANCE scales the absolute foot x of at() for a skater with wider hips.
STANCE = CFG.get("stance", 1.0)
# LEG scales the foot targets of the long air shapes for a skater with
# shorter legs (#329): the hip joint to ankle height over Nia's.
LEG = CFG.get("leg", 1.0)
# Nia's hip joint x (m, armature space).
HIP_X = 0.083
# The drop from the Hips joint to the hip joints (m). A forward pitch of the
# hips moves the hip joints back by more on a rig with a larger drop
# (Marcus 0.108, Nia 0.047), so the rocket skates come back with them.
HIP_DROP = CFG.get("hip_drop", 0.047)
# FOLD scales the hip fold of the rocket: a skater with a longer torso for
# the legs reaches the toes with less fold. The ratio is (shoulder height -
# hips height) / leg length; Nia's is 0.43 (Marcus 0.60). The square root
# keeps enough fold for the hands to reach the toes (Marcus 0.85).
FOLD = (0.43 / CFG.get("torso", 0.43)) ** 0.5


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
#   "pole": the turn of both knee directions about the hips (degrees)
#   "knees": the knee pole targets move out to the sides by this much (metres)
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
        elif key == "knees":
            out[key] = value
        elif key == "hipsRot":
            out[key] = [mirror_rot(r) for r in value]
        else:
            out[mirror_name(key)] = [mirror_rot(r) for r in value]
    return out


def mirror_rot(r):
    # A mirror across the YZ plane maps a rotation axis (x, y, z) to (x, -y, -z).
    axis, deg = r
    if axis == CURL:
        return r
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

# Rest foot positions (armature space). Nia: left (0.242, 0.03), right (-0.236, 0.03).
# A foot "pos" is an offset from the rest position.
LX, RX, FY = CFG.get("feet", (0.242, -0.236, 0.03))


def at(x, y=0.0, z=0.0, side="L", rot=None):
    # A foot target at an absolute x, y (armature space) instead of an offset.
    rest_x = LX if side == "L" else RX
    out = {"pos": (x * STANCE - rest_x, y - FY, z)}
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


# The base stance (#290). The skates are about shoulder width apart (0.33 m
# between the ankles), so that the knees point over the toes and do not touch.
# Before #290 the skates were 0.18 m apart, and the leg IK turned the knees in.
STANCE_X = 0.165
# The hips go down by this much in the base stance, for soft, bouncy knees.
RIDE_Z = -0.14
# The knee pole targets move out by this much, so the knees point over the
# toes (the skates turn out a small amount).
KNEES_OUT = 0.10


def ride(side=0.0, down=0.0, lean=4.0):
    # The ATL ride stance: upright chest, soft knees, skates at shoulder width.
    # side: +1 puts the weight on the left skate, -1 on the right skate.
    # down: the bounce depth in metres. The head nods with the bounce.
    # The arms swing against the legs, and the shoulders turn against the hips.
    return {
        "hips": (0.05 * side, 0.02, RIDE_Z - down),
        "knees": KNEES_OUT,
        "hipsRot": [rot(UP, 9 * side), rot(FWD, -4 * side)],
        "Spine": [rot(LEFT, lean), rot(FWD, -6 * side)],
        "Spine1": [rot(UP, -16 * side), rot(FWD, 3 * side)],
        "Neck": [rot(LEFT, -4)],
        "Head": [rot(LEFT, 140 * down), rot(UP, 8 * side), rot(FWD, 5 * side)],
        "L": at(STANCE_X + 0.02 * side, -0.02, 0, "L", [rot(UP, 8)]),
        "R": at(-STANCE_X + 0.02 * side, 0.06, 0, "R", [rot(UP, -8)]),
        # A hanging arm swings about LEFT: a negative angle swings it forward.
        "LeftArm": [rot(FWD, -78), rot(LEFT, 32 * side)],
        "RightArm": [rot(FWD, 78), rot(LEFT, -32 * side)],
        "LeftForeArm": [rot(UP, -38 - 14 * max(-side, 0))],
        "RightForeArm": [rot(UP, 38 + 14 * max(side, 0))],
        "LeftHand": [rot(FWD, -10)],
        "RightHand": [rot(FWD, 10)],
    }


CLAP = {
    # A low clap: the elbows stay near the ribs, and the hands meet in front
    # of the chest. The shoulders stay down.
    "LeftArm": [rot(LEFT, 50), rot(FWD, -46), rot(UP, -46)],
    "RightArm": [rot(LEFT, 50), rot(FWD, 46), rot(UP, 46)],
    "LeftForeArm": [rot(UP, -118)],
    "RightForeArm": [rot(UP, 118)],
    "LeftHand": [rot(LEFT, -60)],
    "RightHand": [rot(LEFT, -60)],
}

# The arms open, a half beat before the clap: the hands are apart at waist height.
CLAP_UP = {
    "LeftArm": [rot(LEFT, 50), rot(FWD, -54), rot(UP, -30)],
    "RightArm": [rot(LEFT, 50), rot(FWD, 54), rot(UP, 30)],
    "LeftForeArm": [rot(UP, -86)],
    "RightForeArm": [rot(UP, 86)],
    "LeftHand": [rot(LEFT, -40)],
    "RightHand": [rot(LEFT, -40)],
}


def stance(**extra):
    return merge(ride(), extra)


# Clips: name -> (loop, [(frame, pose), ...]) --------------------------------

def idle():
    # Rink idle, one bar (4 beats). A relaxed lean: the weight sits on the
    # right skate, the hip goes out, and the left skate rests forward and out.
    # The knees give a small bounce and the head nods down on each beat. The
    # left skate taps its toe stop on beat 4. The arms hang loose and sway a
    # small amount. No clap and no shrug.
    B = BEAT

    def pose(beat, down, tap=False):
        sway = 1 if beat % 2 == 0 else -1
        left = at(0.20, -0.16, 0.05 if tap else 0, "L", [rot(UP, 24), rot(LEFT, 18 if tap else 0)])
        return {
            "hips": (-0.06, 0.02, -0.07 - down),
            "hipsRot": [rot(FWD, 7), rot(UP, -8)],
            "Spine": [rot(LEFT, -2), rot(FWD, -5)],
            "Spine1": [rot(UP, 10), rot(FWD, -2)],
            "Neck": [rot(LEFT, -3)],
            "Head": [rot(LEFT, 220 * down), rot(UP, -6), rot(FWD, -4)],
            "L": left,
            "R": at(-0.12, 0.05, 0, "R", [rot(UP, -10)]),
            "LeftArm": [rot(FWD, -80), rot(LEFT, -6 + 3 * sway)],
            # The right hand rests on the hip, with the elbow out to the side.
            # The twist turns the elbow bend toward the hip.
            "RightArm": [rot(LEFT, 90), rot(FWD, 46), rot(UP, -14 + 2 * sway)],
            "LeftForeArm": [rot(UP, -18)],
            "RightForeArm": [rot(UP, 104)],
            "LeftHand": [rot(FWD, -8)],
            "RightHand": [rot(UP, 20)],
        }

    keys = []
    for beat in range(4):
        f = beat * B
        keys += [(f, pose(beat, 0.025)), (f + B // 2, pose(beat, 0.0, tap=(beat == 3)))]
    return True, keys + [(4 * B, keys[0][1])]


def _relaxed_hands():
    # The fingers curl a small amount, as in a relaxed hand.
    return merge(_fist("Left", 28), _fist("Right", 28))


def _ryde(phase):
    # The ATL Ryde. Reference: "How to ATL Ryde on Roller Skates" by Dun
    # Beezy (youtube.com/watch?v=oUeLJ5qbyoc), with Cascade rink footage.
    #   out (on the downbeat): both skates press out wide on the outside
    #     edges, the left skate a little in front. The knees bend low, the
    #     chest leans forward, and the arms throw forward and down.
    #   in (on the half beat): the skates drag in on the inside edges, on the
    #     toes, past parallel, so the left skate ends behind the right. The
    #     fists come up near the chest and the shoulders build ("dice roll").
    # The next step mirrors this, so the right skate goes behind.
    if phase == "out":
        return merge(_relaxed_hands(), {
            "hips": (0.02, 0.0, -0.19),
            "knees": KNEES_OUT,
            "hipsRot": [rot(UP, 6)],
            "Spine": [rot(LEFT, 26), rot(FWD, -3)],
            "Spine1": [rot(LEFT, 6), rot(UP, -10)],
            "Neck": [rot(LEFT, -12)],
            "Head": [rot(LEFT, 4), rot(UP, 8)],
            "L": at(0.22, -0.10, 0, "L", [rot(UP, 18), rot(FWD, 6)]),
            "R": at(-0.22, 0.08, 0, "R", [rot(UP, -18), rot(FWD, -6)]),
            "LeftArm": [rot(FWD, -64), rot(UP, -40)],
            "RightArm": [rot(FWD, 70), rot(UP, 26)],
            "LeftForeArm": [rot(UP, -20)],
            "RightForeArm": [rot(UP, 26)],
            "LeftHand": [rot(FWD, -16)],
            "RightHand": [rot(FWD, 16)],
        })
    return merge(FISTS, {
        "hips": (-0.01, 0.0, -0.12),
        "knees": KNEES_OUT,
        "hipsRot": [rot(UP, -4)],
        "Spine": [rot(LEFT, 22), rot(FWD, 2)],
        "Spine1": [rot(LEFT, 8), rot(UP, 8)],
        "Neck": [rot(LEFT, -10)],
        "Head": [rot(LEFT, 10), rot(UP, -4)],
        "LeftShoulder": [rot(FWD, 6), rot(UP, -6)],
        "RightShoulder": [rot(FWD, -6), rot(UP, 6)],
        "L": at(-0.02, 0.16, 0.03, "L", [rot(UP, -10), rot(LEFT, 14)]),
        "R": at(-0.04, -0.04, 0, "R", [rot(UP, 8)]),
        "LeftArm": [rot(LEFT, -35), rot(FWD, -58), rot(UP, -40)],
        "RightArm": [rot(LEFT, -35), rot(FWD, 58), rot(UP, 40)],
        "LeftForeArm": [rot(UP, -118)],
        "RightForeArm": [rot(UP, 118)],
    })


def coast():
    # The ATL Ryde glide, one bar (4 beats): out on each downbeat, in on each
    # half beat. Each beat mirrors the beat before it, so the skate that goes
    # behind changes on each step.
    B = BEAT
    half = [(0, _ryde("out")), (B // 2, _ryde("in")), (B, mirror_pose(_ryde("out"))), (B + B // 2, mirror_pose(_ryde("in")))]
    keys = half + [(f + 2 * B, p) for f, p in half]
    return True, keys + [(4 * B, half[0][1])]


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


def stride_arms(s):
    # The arm swing for the stride. s = +1: the left arm is at the front of
    # its swing and the right arm is at the back. The front arm crosses
    # toward the midline with a bent elbow. The back arm is almost straight.
    # The shoulders turn with the arms, and the head turns against the
    # shoulders, so that the eyes stay on the line of travel.
    fl, fr = max(s, 0.0), max(-s, 0.0)
    swing_l = -62 * fl + 42 * fr
    swing_r = -62 * fr + 42 * fl
    return {
        "LeftArm": [rot(FWD, -74), rot(LEFT, swing_l), rot(UP, -22 * fl)],
        "RightArm": [rot(FWD, 74), rot(LEFT, swing_r), rot(UP, 22 * fr)],
        "LeftForeArm": [rot(UP, -22 - 58 * fl)],
        "RightForeArm": [rot(UP, 22 + 58 * fr)],
        "LeftHand": [rot(FWD, -12), rot(LEFT, -10 * fl)],
        "RightHand": [rot(FWD, 12), rot(LEFT, -10 * fr)],
        "Spine1": [rot(UP, -18 * s), rot(LEFT, 4)],
        "Neck": [rot(UP, 9 * s), rot(LEFT, -6)],
        "Head": [rot(UP, 8 * s), rot(LEFT, -4)],
    }


def _arm_phase(f):
    # The arm swing is a sine wave over the two strokes (24 frames). The
    # left arm is at the front at frame 7, when the right push is longest.
    return math.sin(2 * math.pi * (f - 1) / 24)


def _stride_right():
    # One right stroke, 12 frames. The weight is on the left skate. The right
    # skate turns out and pushes on its inside edge, diagonally out and back.
    # Real skaters push at an angle of about 45 degrees to the line of travel:
    # the push goes to the side and to the rear, and the leg ends straight
    # behind the hip. Then the skate lifts and comes forward under the hips.
    # +y is to the rear in armature space.
    def body(f, hips, lean, L, R):
        return merge(stride_arms(_arm_phase(f)), {
            "hips": hips,
            "hipsRot": [rot(UP, 5 * _arm_phase(f)), rot(FWD, -4)],
            "Spine": [rot(LEFT, lean), rot(FWD, -5)],
            "L": L,
            "R": R,
        })
    keys = [
        # Set: the right skate is under the hips and turns out. The weight goes onto the left skate.
        (0, body(0, (0.04, 0.02, -0.15), 16,
                 at(0.09, -0.02, 0, "L", [rot(UP, 6)]),
                 at(-0.13, 0.02, 0, "R", [rot(UP, -28), rot(FWD, 6)]))),
        # Drive: the left knee bends, and the right skate goes out and back.
        (3, body(3, (0.07, 0.02, -0.20), 19,
                 at(0.10, -0.04, 0, "L", [rot(UP, 4)]),
                 at(-0.26, 0.15, 0, "R", [rot(UP, -34), rot(FWD, 12)]))),
        # Extension: the right leg is straight, diagonally out and behind the hip.
        (7, body(7, (0.09, 0.03, -0.23), 21,
                 at(0.10, -0.06, 0, "L", [rot(UP, 2)]),
                 at(-0.38, 0.36, 0, "R", [rot(UP, -38), rot(FWD, 14)]))),
        # Lift: the right skate leaves the ground at the end of the push.
        (9, body(9, (0.07, 0.03, -0.19), 19,
                 at(0.10, -0.05, 0, "L", [rot(UP, 2)]),
                 at(-0.32, 0.32, 0.07, "R", [rot(UP, -30), rot(LEFT, -14)]))),
        # Recovery: the right skate swings forward under the hips.
        (11, body(11, (0.04, 0.02, -0.15), 17,
                  at(0.09, -0.03, 0, "L", [rot(UP, 4)]),
                  at(-0.16, 0.10, 0.06, "R", [rot(UP, -18)]))),
    ]
    return keys


def push():
    # ATL stride, two strokes (0.8 s, one beat): right, then left. Each stroke
    # is 0.4 s, the same as SKATE.pushCooldown. The arms swing in a sine wave
    # against the legs.
    right = _stride_right()
    left = [(f + 12, mirror_pose(p)) for f, p in right]
    return True, right + left + [(24, right[0][1])]


def _corner(right_x, right_y, right_z, left_y, left_z, down, toe=18, right_rot=None):
    # One key of the ATL Ryde corner step, in a turn to the left. The body
    # leans into the turn and the shoulders turn with it. The right skate is
    # the outside skate. The left skate drags behind on its toe.
    return merge(_relaxed_hands(), {
        "hips": (0.06, 0.02, -0.15 - down),
        "hipsRot": [rot(UP, 12), rot(FWD, -6)],
        "Spine": [rot(LEFT, 20), rot(FWD, -8)],
        "Spine1": [rot(UP, 14), rot(LEFT, 4)],
        "Neck": [rot(LEFT, -10), rot(UP, 8)],
        "Head": [rot(UP, 14), rot(LEFT, 4)],
        "pole": 10,
        "R": at(right_x, right_y, right_z, "R", right_rot or [rot(UP, -14), rot(FWD, -6)]),
        "L": at(0.12, left_y, left_z, "L", [rot(UP, 8), rot(LEFT, toe)]),
        "LeftArm": [rot(FWD, -70), rot(LEFT, 26), rot(UP, -8)],
        "RightArm": [rot(FWD, 64), rot(LEFT, -30), rot(UP, 30)],
        "LeftForeArm": [rot(UP, -22)],
        "RightForeArm": [rot(UP, 46)],
        "LeftHand": [rot(FWD, -14)],
        "RightHand": [rot(FWD, 14)],
    })


def carve_left():
    # The ATL Ryde corner step, 2 beats. Reference: "How to ATL Ryde on
    # Roller Skates" by Dun Beezy (youtube.com/watch?v=oUeLJ5qbyoc): "on the
    # corners I step out with my right foot and I drag my left foot twice
    # before throwing my right foot back in."
    #   beat 1: the right skate steps out wide. The left skate drags behind.
    #   beat 1 &: the left skate drags a second time.
    #   beat 2: the right skate lifts and goes back in, in front of the left.
    step = _corner(-0.34, 0.0, 0, 0.18, 0.03, 0.04)
    drag = _corner(-0.34, 0.0, 0, 0.32, 0.0, 0.09, toe=28)
    reset = _corner(-0.34, 0.0, 0, 0.10, 0.06, 0.02)
    lift = _corner(-0.16, -0.06, 0.09, 0.16, 0.02, 0.02, right_rot=[rot(UP, 6)])
    back_in = _corner(-0.02, -0.10, 0, 0.12, 0.02, 0.06, toe=10, right_rot=[rot(UP, 10)])
    return True, [(0, step), (6, drag), (12, reset), (18, drag), (28, lift), (36, back_in), (44, step), (48, step)]


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


# Trick input clips (#329). The specs are in docs/gdd/trick-input.md,
# "Visual/Audio Requirements". The touch point of each stance is in its
# comment. Marcus gets the mirror of the air and grind clips through
# marcus_style() in skater_anim_v3.py; his manual_toe has its own source.

def _yaw_xy(x, y, deg):
    # Turns a point (x, y) about the hips line (x = 0, y = 0) by deg about +Z.
    a = math.radians(deg)
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)


def _air_turned(yaw, L, R, **extra):
    # An air pose whose whole body turns by yaw (degrees about +Z). L and R
    # are (x, y, z, [foot rotations]) in the frame of the body before the turn,
    # in metres of this skater (at() scales x by STANCE, so x is divided by
    # it here, after the turn).
    def foot(spec, side):
        x, y, z, r = spec
        tx, ty = _yaw_xy(x, y, yaw)
        return at(tx / STANCE, ty, z, side, list(r) + [rot(UP, yaw)])
    pose = _air(L=foot(L, "L"), R=foot(R, "R"), pole=yaw, **extra)
    pose["hipsRot"] = list(extra.get("hipsRot", [])) + [rot(UP, yaw)]
    return pose


def air_rocket():
    # Rocket: the longest shape. Both legs go forward almost straight (the
    # knees bend 20 to 30 degrees), the hips fold about 90 degrees, and both
    # hands hold the toes of the skates (the toe stop end). The head goes
    # down. The body turns 28 degrees to the camera and the knees spread, so
    # the torso does not hide the skates.
    def key(reach, spread):
        # The skates are 12 cm (plus spread) outside the hip joints.
        x = HIP_X * STANCE + 0.117 + spread
        y = (-0.72 - reach) * LEG + 0.66 * (HIP_DROP - 0.047)
        return _air_turned(
            28,
            (x, y, 0.62 * LEG, [rot(LEFT, -80)]),
            (-x, y, 0.62 * LEG, [rot(LEFT, -80)]),
            # The shoulders reach forward (protraction) toward the toes.
            LeftShoulder=[rot(UP, -20)], RightShoulder=[rot(UP, 20)],
            hipsRot=[rot(LEFT, 30 * FOLD)],
            Spine=[rot(LEFT, 30 * FOLD)], Spine1=[rot(LEFT, 22 * FOLD)], Spine2=[rot(LEFT, 14 * FOLD)],
            Neck=[rot(LEFT, 10)], Head=[rot(LEFT, 16)],
            # The chest pitches forward about 70 degrees, so the arms go
            # forward and up in the frame of the chest to reach the toes.
            LeftArm=[rot(FWD, 40), rot(UP, -72)], RightArm=[rot(FWD, -40), rot(UP, 72)],
            # A clear elbow bend, so the arm IK keeps the elbow on its hinge.
            LeftForeArm=[rot(UP, -28)], RightForeArm=[rot(UP, 28)],
            LeftHand=[rot(FWD, -20)], RightHand=[rot(FWD, 20)],
            knees=0.08,
        )
    a, b = key(0.0, 0.0), key(0.01, 0.02)
    return True, [(0, a), (12, b), (24, a)]


def air_tuckknee():
    # Tuck knee: the smallest shape, a ball. Both knees come up high and
    # apart, and both hands hold the shins (below the knee pads). The pose
    # is symmetric, with no torso twist (air_mute is asymmetric).
    def key(tuck):
        return _air(
            hips=(0, 0.04, 0.10),
            hipsRot=[rot(LEFT, -14)],
            # The skates turn out 25 degrees: the leg IK points each knee over
            # its skate, so the knees go apart.
            L=at(0.21, -0.06, 0.70 + tuck, "L", [rot(LEFT, -20), rot(UP, 25)]),
            R=at(-0.21, -0.06, 0.70 + tuck, "R", [rot(LEFT, -20), rot(UP, -25)]),
            knees=0.18,
            Spine=[rot(LEFT, 30)], Spine1=[rot(LEFT, 12)], Spine2=[rot(LEFT, 6)],
            Neck=[rot(LEFT, -10)], Head=[rot(LEFT, -8)],
            LeftArm=[rot(FWD, -30), rot(UP, -58)], RightArm=[rot(FWD, 30), rot(UP, 58)],
            LeftForeArm=[rot(UP, -30)], RightForeArm=[rot(UP, 30)],
            LeftHand=[rot(FWD, -15)], RightHand=[rot(FWD, 15)],
        )
    a, b = key(0.0), key(0.04)
    return True, [(0, a), (12, b), (24, a)]


def grind_makio():
    # Makio (an inline name; on quads it stays open for the skater review).
    # Touch point: the left skate goes across the rail, on the plate between
    # the trucks, under the hips. The right skate lifts behind the hip, the
    # knee bent about 90 degrees, beside the body. The torso opens to the
    # camera and the arms go wide.
    a = _grind(
        0,
        at(0.0, -0.02, 0, "L", [rot(UP, 88)]),
        at(-0.26, 0.30, 0.34, "R", [rot(LEFT, 55), rot(UP, -10)]),
        hips=(0.04, 0.02, -0.16),
        hipsRot=[rot(FWD, 4)],
        Spine=[rot(LEFT, 14), rot(FWD, -4)], Spine1=[rot(LEFT, 2), rot(UP, -18)],
        Neck=[rot(LEFT, -2), rot(UP, 8)], Head=[rot(LEFT, 6), rot(UP, 6)],
        LeftArm=[rot(FWD, -20), rot(UP, -10)], RightArm=[rot(FWD, 20), rot(UP, 10)],
        LeftForeArm=[rot(UP, -12)], RightForeArm=[rot(UP, 12)],
    )
    return _wobble(a)


def grind_royale():
    # Royale (an inline name; open for the skater review). A T shape. Touch
    # points: the front (left) skate goes along the rail on the inside edge
    # of its plate, the back (right) skate goes across the rail, on the plate
    # between the trucks. The body stays square to the travel, in a low
    # crouch. Not grind_frontside (both skates across, the body turned 85).
    a = _grind(
        0,
        at(0.0, -0.32, 0.004, "L", [rot(FWD, 20)]),
        at(0.0, 0.24, 0.006, "R", [rot(UP, -88)]),
        hips=(0, 0.0, -0.28),
        knees=0.32,
        Spine=[rot(LEFT, 26)], Spine1=[rot(LEFT, 6)],
        Neck=[rot(LEFT, -10)], Head=[rot(LEFT, -6)],
        LeftArm=[rot(FWD, -32), rot(UP, -18)], RightArm=[rot(FWD, 32), rot(UP, 18)],
        LeftForeArm=[rot(UP, -16)], RightForeArm=[rot(UP, 16)],
    )
    return _wobble(a)


# The toe roll: the pitch of the boots (degrees; a positive turn about LEFT
# puts the toe down) and the lift of
# the ankle that keeps the front wheels on the ground. skater_anim_v3.py
# measures the toe stop gap on the mesh (#329).
TOE_PITCH = 8
TOE_LIFT = 0.0125


def manual_toe():
    # Toe roll: the front wheels stay on the ground, the heels go up, and the
    # toe stops stay clear of the ground (a toe stop on the ground brakes).
    # The boots pitch forward, the torso leans forward, the arms go out. The
    # opposite lean of manual (which leans back on the rear wheels).
    def key(lean):
        return stance(
            hips=(0, 0.02, -0.12),
            hipsRot=[rot(LEFT, 12)],
            L=at(STANCE_X - 0.03, -0.14, TOE_LIFT, "L", [rot(LEFT, TOE_PITCH), rot(UP, 6)]),
            R=at(-STANCE_X + 0.03, 0.10, TOE_LIFT, "R", [rot(LEFT, TOE_PITCH), rot(UP, -6)]),
            Spine=[rot(LEFT, 24 + lean)], Spine1=[rot(LEFT, 10)],
            Neck=[rot(LEFT, -16)], Head=[rot(LEFT, -12)],
            LeftArm=[rot(FWD, -30), rot(UP, -20)], RightArm=[rot(FWD, 30), rot(UP, 20)],
            LeftForeArm=[rot(UP, -14)], RightForeArm=[rot(UP, 14)],
            LeftHand=[rot(FWD, 10)], RightHand=[rot(FWD, -10)],
        )
    a, b = key(0), key(4)
    return True, [(0, a), (15, b), (30, a)]


def land_stumble():
    # The stumble landing (R10): a deeper hit, the torso pitches forward, the
    # right skate steps out to catch the weight, and the arms wave in one
    # quick circle for 0.2 s (6 frames). Then the skater rises as in land.
    hit = merge(ride(0, 0.26, lean=30), {
        "L": at(0.14, -0.04), "R": at(-0.20, 0.14, side="R", rot=[rot(UP, -14)]),
        "LeftArm": [rot(FWD, -10), rot(UP, -40)], "RightArm": [rot(FWD, 10), rot(UP, 40)],
    })
    wave_a = merge(hit, {"LeftArm": [rot(FWD, -44), rot(LEFT, -46), rot(UP, -12)], "RightArm": [rot(FWD, 20), rot(LEFT, 40)],
                         "Spine": [rot(LEFT, 22), rot(FWD, 6)]})
    wave_b = merge(hit, {"LeftArm": [rot(FWD, -20), rot(LEFT, 40)], "RightArm": [rot(FWD, 44), rot(LEFT, -46), rot(UP, 12)],
                         "Spine": [rot(LEFT, 18), rot(FWD, -6)]})
    # The arms stay a little out from the body as the skater rises.
    rise = merge(ride(0.5, 0.06, lean=8), {"Spine1": [rot(UP, -10)], "Head": [rot(UP, 8)],
                                           "LeftArm": [rot(FWD, -58), rot(LEFT, 12)], "RightArm": [rot(FWD, 58), rot(LEFT, -12)]})
    return False, [(0, hit), (4, hit), (7, wave_a), (10, wave_b), (13, hit), (20, rise)]


def bail():
    trip = stance(hips=(0.05, -0.02, -0.12), hipsRot=[rot(UP, 15)], Spine=[rot(LEFT, -15), rot(FWD, 10)],
                  LeftArm=[rot(FWD, 30), rot(UP, -40)], RightArm=[rot(FWD, -20), rot(UP, 50)], Head=[rot(LEFT, -15)])
    flail = merge(trip, {"hips": (0.08, 0.0, -0.22), "Spine": [rot(LEFT, 25), rot(FWD, -12)], "LeftArm": [rot(FWD, -10), rot(UP, -70)], "RightArm": [rot(FWD, 10), rot(UP, 70)],
                         "L": {"pos": (-0.1, -0.1, 0)}, "R": {"pos": (0.15, 0.15, 0)}})
    down = merge(flail, {"hips": (0.06, 0.05, -0.42), "Spine": [rot(LEFT, 40)], "LeftArm": [rot(FWD, -70), rot(UP, -60)], "RightArm": [rot(FWD, 70), rot(UP, 60)]})
    return False, [(0, trip), (8, flail), (18, down), (30, down)]


# Dances -------------------------------------------------------------------
#
# The sources and the specs are in docs/characters/atl-dance-references.md.
# A groove dance is 2 beats (48 frames), and a spin is 1 beat (24 frames).
# The renderer plays each dance at the game tempo from its first frame.
# The skates stay in a glide under the hips unless the spec moves them.

def glide(down=0.0, side=0.0, lean=4.0):
    # The base for a dance: the ride stance with the skates side by side.
    return merge(ride(side, down, lean), {
        "L": at(STANCE_X, -0.01, 0, "L", [rot(UP, 6)]),
        "R": at(-STANCE_X, 0.03, 0, "R", [rot(UP, -6)]),
    })


def _fist(side, curl=85):
    # Closes the fingers of one hand. A finger curls toward the palm about
    # its own CURL axis (the rest pose has the palms down).
    out = {}
    sign = -1 if side == "Left" else 1
    for finger in ("Index", "Middle", "Ring", "Pinky"):
        out[f"{side}Hand{finger}1"] = [rot(CURL, curl * 0.8)]
        out[f"{side}Hand{finger}2"] = [rot(CURL, curl)]
        out[f"{side}Hand{finger}3"] = [rot(CURL, curl * 0.7)]
    out[f"{side}HandThumb1"] = [rot(FWD, sign * 20)]
    out[f"{side}HandThumb2"] = [rot(UP, -sign * 30)]
    return out


FISTS = merge(_fist("Left"), _fist("Right"))


def fists_up(cross, lift=0.0):
    # Bankhead Bounce arms, with closed fists. cross = 1: the forearms cross
    # in an X in front of the face, the elbows low and in. cross = 0: a
    # "goalpost": the upper arms go out to the sides at shoulder height and the
    # forearms point up. Values between blend the two. lift raises the elbows
    # more (for the follow-through after the arms open).
    # The upper arm turns 90 degrees about its length, so the elbow bends up.
    down = -12 - 46 * cross + 10 * lift
    fwd = -8 - 70 * cross
    bend = -92 - 40 * cross
    return merge(FISTS, {
        "LeftArm": [rot(LEFT, -90), rot(FWD, down), rot(UP, fwd)],
        "RightArm": [rot(LEFT, -90), rot(FWD, -down), rot(UP, -fwd)],
        "LeftForeArm": [rot(UP, bend)],
        "RightForeArm": [rot(UP, -bend)],
        "LeftHand": [rot(FWD, -10)],
        "RightHand": [rot(FWD, 10)],
    })


def shrug(up):
    # Both shoulders go up (up = 1) or down (up = 0). up < 0 pushes them down.
    return {"LeftShoulder": [rot(FWD, 24 * up)], "RightShoulder": [rot(FWD, -24 * up)]}


def _bankhead(cross, up, down, side, lift=0.0, nod=0.0):
    # One key of the Bankhead Bounce. up: the shrug. down: the knee bounce in
    # metres. side: the weight shift (+1 on the left skate). nod: the head
    # nods down (1) or up (-1). The chest pops forward on the down bounce.
    return merge(glide(down, side, lean=8 + 60 * down), fists_up(cross, lift), shrug(up), {
        "Spine1": [rot(LEFT, 10 * nod - 4 * up), rot(UP, -10 * side)],
        "Neck": [rot(LEFT, -4)],
        "Head": [rot(LEFT, 14 * nod), rot(UP, 6 * side)],
    })


def dance_bankhead():
    # Bankhead Bounce (Bankhead, west Atlanta, 1995). The shoulders shrug up
    # on each "&" and drop on each beat, two shrugs per beat. The knees bounce
    # down on each beat. Beat 1: the forearms cross in front of the face and
    # the weight goes onto the left skate. Beat 2: the arms open to a goalpost
    # and the weight goes onto the right skate.
    # Anticipation: the arms start to move 6 frames before the beat (f18,
    # f42). Follow-through: the elbows overshoot up 3 frames after the arms
    # open (f27), and the fists close in more after the cross (f3).
    B = _bankhead
    return True, [
        (0, B(1.0, -0.4, 0.09, 0.5, nod=1)),
        (3, B(1.1, -0.2, 0.07, 0.5, nod=0.6)),
        (6, B(1.0, 1.0, 0.0, 0.4, nod=-0.6)),
        (12, B(1.0, -0.3, 0.06, 0.5, nod=0.8)),
        (18, B(0.75, 1.0, 0.0, 0.1, nod=-0.6)),
        (24, B(0.0, -0.4, 0.09, -0.5, nod=1)),
        (27, B(-0.05, -0.2, 0.07, -0.5, lift=1.0, nod=0.6)),
        (30, B(0.0, 1.0, 0.0, -0.4, lift=0.5, nod=-0.6)),
        (36, B(0.0, -0.3, 0.06, -0.5, nod=0.8)),
        (42, B(0.3, 1.0, 0.0, -0.1, nod=-0.6)),
        (48, B(1.0, -0.4, 0.09, 0.5, nod=1)),
    ]


def _walk_it_out_right(down, push):
    # Walk It Out (DJ Unk, 2006). References: the Howcast lesson by Randy
    # Connor (youtube.com/watch?v=K60wXXSJOsg) and the STEEZY steps. The
    # stance is wide and low. Both knees turn to the right (one knee in, one
    # knee out), on a double bounce. Both forearms stay level in front of the
    # chest with closed fists. The right fist pushes out a small amount to the
    # right, and the left forearm stays close to the chest.
    # On quads the skates swivel on the wheels, as in a swizzle in place.
    return merge(glide(down, -0.5, lean=10), FISTS, {
        "hips": (-0.04, 0.02, -0.15 - down),
        "hipsRot": [rot(UP, -16)],
        "Spine": [rot(LEFT, 10)],
        "Spine1": [rot(UP, -6), rot(LEFT, 4)],
        "pole": -28,
        "L": at(0.20, -0.02, 0, "L", [rot(UP, -26)]),
        "R": at(-0.22, 0.04, 0, "R", [rot(UP, -30)]),
        # The forearms bend forward and stay level, so the fists are at the chest.
        "RightArm": [rot(LEFT, -35), rot(FWD, 54), rot(UP, 30 - 18 * push)],
        "RightForeArm": [rot(UP, 112 - 26 * push)],
        "LeftArm": [rot(LEFT, -35), rot(FWD, -56), rot(UP, -38)],
        "LeftForeArm": [rot(UP, -122)],
        "Neck": [rot(UP, -8)],
        "Head": [rot(UP, -12), rot(LEFT, 6)],
    })


def dance_walkitout():
    # Beat 1: the turn to the right with a double bounce. Beat 2: to the left.
    R = _walk_it_out_right
    L = lambda d, p: mirror_pose(_walk_it_out_right(d, p))
    return True, [
        (0, R(0.07, 1)), (6, R(0.02, 0.6)), (12, R(0.07, 1)), (18, R(0.02, 0.4)),
        (24, L(0.07, 1)), (30, L(0.02, 0.6)), (36, L(0.07, 1)), (42, L(0.02, 0.4)),
        (48, R(0.07, 1)),
    ]


# The arms open wide to the sides at chest height, before a clap.
CLAP_WIDE = {
    "LeftArm": [rot(LEFT, 30), rot(FWD, -30), rot(UP, 10)],
    "RightArm": [rot(LEFT, 30), rot(FWD, 30), rot(UP, -10)],
    "LeftForeArm": [rot(UP, -40)],
    "RightForeArm": [rot(UP, 40)],
    "LeftHand": [rot(LEFT, -30)],
    "RightHand": [rot(LEFT, -30)],
}

# A high clap: the hands meet in front of the chest, the elbows out.
CLAP_HIGH = {
    "LeftArm": [rot(FWD, -32), rot(UP, -62)],
    "RightArm": [rot(FWD, 32), rot(UP, 62)],
    "LeftForeArm": [rot(UP, -98)],
    "RightForeArm": [rot(UP, 98)],
    "LeftHand": [rot(LEFT, -80)],
    "RightHand": [rot(LEFT, -80)],
}


def _prep(phase):
    # One key of The Prep. The left skate always crosses behind.
    #   step (beat 1): the right skate steps short and forward, the knees bend,
    #     the arms are low and open.
    #   lift: the left skate lifts to go behind.
    #   behind (&): the left toe stop touches behind and to the right of the
    #     right heel. The hips turn a small amount to the right. The arms open
    #     wide: the anticipation for the clap.
    #   clap (beat 2): the hands clap in front of the chest, the hips dip 3 cm,
    #     and the head nods.
    #   bounce: the follow-through after the clap. The hands bounce up and
    #     apart, and the knees come up.
    #   out (&): the left skate uncrosses and steps forward.
    step = {"L": at(STANCE_X, 0.08, 0, "L", [rot(UP, 8)]), "R": at(-0.13, -0.14, 0, "R", [rot(UP, -4)])}
    behind = {"knees": 0.0, "L": at(-0.24, 0.16, 0.05, "L", [rot(UP, -14), rot(LEFT, 26)]), "R": at(-0.12, -0.10, 0, "R", [rot(UP, -6)])}
    if phase == "step":
        return merge(ride(-0.6, 0.07, lean=10), step, {"Head": [rot(LEFT, 4)]})
    if phase == "lift":
        return merge(ride(-0.8, 0.04, lean=8), step, {
            "L": at(0.02, 0.18, 0.09, "L", [rot(UP, -6), rot(LEFT, 18)]), "knees": 0.04,
        })
    if phase == "behind":
        return merge(ride(-0.7, 0.05, lean=6), CLAP_WIDE, behind, {
            "hipsRot": [rot(UP, -12), rot(FWD, 4)],
            "Spine1": [rot(UP, 10), rot(LEFT, -4)],
            "Head": [rot(LEFT, -6), rot(UP, 6)],
        })
    if phase == "clap":
        return merge(ride(-0.6, 0.10, lean=12), CLAP_HIGH, behind, {
            "hipsRot": [rot(UP, -8)],
            "Spine1": [rot(UP, 6), rot(LEFT, 6)],
            "Head": [rot(LEFT, 16)],
        })
    if phase == "bounce":
        return merge(ride(-0.5, 0.05, lean=8), CLAP_HIGH, behind, {
            "LeftForeArm": [rot(UP, -80)], "RightForeArm": [rot(UP, 80)],
            "LeftArm": [rot(FWD, -22), rot(UP, -48)],
            "RightArm": [rot(FWD, 22), rot(UP, 48)],
            "hipsRot": [rot(UP, -6)],
            "Head": [rot(LEFT, 2)],
        })
    # out
    return merge(ride(0.6, 0.03, lean=8), {
        "L": at(0.15, -0.12, 0.03, "L", [rot(UP, 6)]), "R": at(-0.15, 0.04, 0, "R", [rot(UP, -6)]),
    })


def dance_prep():
    # The Prep (USA Roller Sports): a stutter step forward. The left skate
    # crosses behind the right skate, and a clap on each beat keeps it going.
    # Spec: docs/characters/atl-dance-references.md, "The Prep". The clip is
    # beats 1 and 2 of the spec; the game repeats it for beats 3 and 4.
    P = _prep
    return True, [
        (0, P("step")), (6, P("lift")), (12, P("behind")), (20, P("behind")),
        (24, P("clap")), (29, P("bounce")), (36, P("out")), (44, P("step")), (48, P("step")),
    ]


def _swag(phase):
    # Swag Surf (F.L.Y., Stone Mountain, 2009). Reference: the HAS Dance
    # University lesson "Beginner Dance Moves: The Swag Surf"
    # (youtube.com/watch?v=tUE5PJgSmiI). One side per beat, here the left:
    #   up: stand tall, both arms up above the shoulders, elbows bent.
    #   sweep: turn 30 to 45 degrees to the left, the arms sweep out to the left.
    #   down: drop low and bend forward to the left, the hands sweep down near the knees.
    # The left hand leads to the left. The hands trace an infinity sign, and
    # the upper body and the head follow the hands.
    base = glide(0.0, 0.6, lean=4)
    feet = {"L": at(0.18, -0.02, 0, "L", [rot(UP, 22)]), "R": at(-0.16, 0.04, 0, "R", [rot(UP, 16)]), "pole": 14}
    if phase == "up":
        return merge(base, feet, {
            "hips": (0.02, 0.02, -0.05),
            "hipsRot": [rot(UP, 6)],
            "Spine": [rot(LEFT, -2)],
            "LeftArm": [rot(FWD, 52), rot(UP, -24)],
            "RightArm": [rot(FWD, -46), rot(UP, 30)],
            "LeftForeArm": [rot(UP, -60)],
            "RightForeArm": [rot(UP, 60)],
            "Head": [rot(LEFT, -6), rot(UP, 6)],
        })
    if phase == "sweep":
        return merge(base, feet, {
            "hips": (0.06, 0.02, -0.15),
            "hipsRot": [rot(UP, 26), rot(FWD, -6)],
            "Spine": [rot(LEFT, 18), rot(FWD, -10)],
            "Spine1": [rot(UP, 10), rot(LEFT, 6)],
            "LeftArm": [rot(FWD, 4), rot(UP, -6)],
            "RightArm": [rot(FWD, 14), rot(UP, 84)],
            "LeftForeArm": [rot(UP, -16)],
            "RightForeArm": [rot(UP, 30)],
            "Head": [rot(UP, 14), rot(FWD, -6)],
        })
    # down
    return merge(base, feet, {
        "hips": (0.08, 0.06, -0.27),
        "hipsRot": [rot(UP, 32), rot(FWD, -4)],
        "Spine": [rot(LEFT, 34), rot(FWD, -8)],
        "Spine1": [rot(LEFT, 16), rot(UP, 8)],
        "Neck": [rot(LEFT, -14)],
        "LeftArm": [rot(FWD, -76), rot(UP, -30)],
        "RightArm": [rot(FWD, 70), rot(UP, 46)],
        "LeftForeArm": [rot(UP, -14)],
        "RightForeArm": [rot(UP, 20)],
        "Head": [rot(LEFT, -16), rot(UP, 10)],
    })


def dance_swagsurf():
    # The wave goes left on beat 1 and right on beat 2: up, sweep, down, up.
    left = [(0, _swag("up")), (8, _swag("sweep")), (15, _swag("down"))]
    right = [(f + 24, mirror_pose(p)) for f, p in left]
    return True, left + right + [(48, left[0][1])]


def _snap_left(snap):
    # Snap Lean (snap music, Bankhead, early 2000s). The body leans back and
    # to the left with the weight on the left skate, no more than about 15
    # degrees in total, so a quad skater stays on the wheels. The arms hang low
    # with bent elbows. At the peak the fingers snap beside the hips, the left
    # shoulder dips, and the head tilts back with a cool look.
    return merge(glide(0.07 if snap else 0.03, 1, lean=-6), {
        "hips": (0.08, -0.02, -0.15 if snap else -0.11),
        "hipsRot": [rot(FWD, -6), rot(UP, 8)],
        "Spine": [rot(LEFT, -8), rot(FWD, -9)],
        "Spine1": [rot(LEFT, -4), rot(UP, 10), rot(FWD, -4)],
        "LeftShoulder": [rot(FWD, -10 if snap else -4)],
        "RightShoulder": [rot(FWD, -4 if snap else 0)],
        "LeftArm": [rot(FWD, -70), rot(LEFT, 14)],
        "RightArm": [rot(FWD, 70), rot(LEFT, 14)],
        "LeftForeArm": [rot(UP, -40 - (22 if snap else 0))],
        "RightForeArm": [rot(UP, 40 + (22 if snap else 0))],
        "LeftHand": [rot(FWD, -28 if snap else -8)],
        "RightHand": [rot(FWD, 28 if snap else 8)],
        "Neck": [rot(LEFT, -6)],
        "Head": [rot(LEFT, -10), rot(FWD, -8), rot(UP, 10)],
    })


def dance_snaplean():
    # Beat 1: lean back to the left, snap at the peak. Beat 2: the same to the
    # right. The hips rock forward between the leans.
    L = _snap_left
    R = lambda snap: mirror_pose(_snap_left(snap))
    rock = merge(glide(0.02, 0, lean=8), {"hips": (0, -0.02, -0.08)})
    return True, [(0, L(False)), (8, L(True)), (18, rock), (24, R(False)), (32, R(True)), (42, rock), (48, L(False))]


# The arms out to the sides at about 45 degrees, hands open, for balance.
ARMS_WIDE = {
    "LeftArm": [rot(FWD, -38), rot(UP, -12)],
    "RightArm": [rot(FWD, 38), rot(UP, 12)],
    "LeftForeArm": [rot(UP, -14)],
    "RightForeArm": [rot(UP, 14)],
    "LeftHand": [rot(FWD, 10)],
    "RightHand": [rot(FWD, -10)],
}


def _criss(phase):
    # One key of the Crisscross, with the left skate in front. The other
    # side is the mirror. Spec: "Cross Step" in
    # docs/characters/atl-dance-references.md.
    #   cross (on the beat): the skates cross, the left skate in front and to
    #     the right, the right skate behind and to the left. The knees bend,
    #     the hips turn toward the front skate, and the hands clap.
    #   rebound: the follow-through. The hands bounce apart and the knees
    #     come up.
    #   open: the skates slide out wide, the arms open to the sides, the chest
    #     comes up.
    #   load: the anticipation for the next cross. The knees dip and the arms
    #     start to come in.
    if phase in ("cross", "rebound"):
        feet = {
            "knees": 0.0,
            "L": at(-0.08, -0.14, 0, "L", [rot(UP, -6)]),
            "R": at(0.06, 0.13, 0, "R", [rot(UP, 10)]),
        }
        if phase == "cross":
            return merge(ride(0.2, 0.10, lean=12), CLAP_HIGH, feet, {
                "hipsRot": [rot(UP, -14)],
                "Spine1": [rot(UP, 8), rot(LEFT, 6)],
                "Head": [rot(LEFT, 12), rot(UP, -4)],
            })
        return merge(ride(0.2, 0.05, lean=8), CLAP_HIGH, feet, {
            "LeftForeArm": [rot(UP, -70)], "RightForeArm": [rot(UP, 70)],
            "LeftArm": [rot(FWD, -28), rot(UP, -40)],
            "RightArm": [rot(FWD, 28), rot(UP, 40)],
            "hipsRot": [rot(UP, -8)],
            "Head": [rot(LEFT, 2)],
        })
    if phase == "open":
        return merge(ride(0, 0.0, lean=2), ARMS_WIDE, {
            "L": at(0.27, -0.02, 0, "L", [rot(UP, 14)]),
            "R": at(-0.27, 0.02, 0, "R", [rot(UP, -14)]),
            "Head": [rot(LEFT, -6)],
        })
    # load
    return merge(ride(-0.1, 0.06, lean=8), CLAP_WIDE, {
        "L": at(0.20, -0.06, 0, "L", [rot(UP, 4)]),
        "R": at(-0.20, 0.06, 0, "R", [rot(UP, -4)]),
        "Head": [rot(LEFT, 4)],
    })


def dance_crisscross():
    # Crisscross: the skates cross on each beat and open between the beats.
    # Beat 1: the left skate crosses in front. Beat 2: the right skate. The
    # hands clap at each cross.
    C = _criss
    M = lambda p: mirror_pose(_criss(p))
    return True, [
        (0, C("cross")), (5, C("rebound")), (12, C("open")), (19, C("load")),
        (24, M("cross")), (29, M("rebound")), (36, M("open")), (43, M("load")),
        (48, C("cross")),
    ]


# The spins are 1 beat (24 frames). The renderer turns the body one full turn
# to the left over the beat, at a constant rate (src/render/skater-view.js).
# The clip gives the turn its body: the wind-up at the start, a tight middle,
# and an open finish at the end.

def _wind_up(down):
    # The wind-up before a spin to the left: the knees bend, the shoulders
    # turn to the right against the turn, the left arm crosses the chest, and
    # the right arm reaches back. The head looks into the turn.
    return merge(glide(down, -0.4, lean=10), {
        "hipsRot": [rot(UP, -14)],
        "Spine": [rot(LEFT, 10), rot(UP, -14)],
        "Spine1": [rot(UP, -22)],
        "Neck": [rot(UP, 16)],
        "Head": [rot(UP, 20), rot(LEFT, 4)],
        "LeftArm": [rot(FWD, -30), rot(UP, -78)],
        "LeftForeArm": [rot(UP, -60)],
        "RightArm": [rot(FWD, 30), rot(UP, -40)],
        "RightForeArm": [rot(UP, 10)],
    })


def _finish(down):
    # The finish after a spin: the skates are flat and apart, the knees take
    # the stop, the arms open out and up, the chest lifts.
    return merge(glide(down, 0.0, lean=0), {
        "LeftArm": [rot(FWD, 34), rot(UP, -30)],
        "RightArm": [rot(FWD, -34), rot(UP, 30)],
        "LeftForeArm": [rot(UP, -10)],
        "RightForeArm": [rot(UP, 10)],
        "LeftHand": [rot(FWD, 14)],
        "RightHand": [rot(FWD, -14)],
        "Neck": [rot(LEFT, -6)],
        "Head": [rot(LEFT, -8)],
    })


def _toe_spin(arm_up):
    # The tight part of the toe-stop spin: the skates together on the toe
    # stops, the left arm up, the right arm wraps the chest. arm_up = 1: the
    # left arm is straight up; 0: it is still coming up.
    return merge(ride(0, -0.03, lean=-2), {
        "knees": 0.0,
        "L": at(0.07, 0.0, 0.05, "L", [rot(LEFT, 25)]), "R": at(-0.07, 0.0, 0.05, "R", [rot(LEFT, 25)]),
        "Spine1": [rot(UP, 8)],
        "LeftArm": [rot(FWD, 40 + 45 * arm_up), rot(UP, -10)], "LeftForeArm": [rot(UP, -50 + 30 * arm_up)],
        "RightArm": [rot(FWD, 65), rot(UP, 80)], "RightForeArm": [rot(UP, 100)],
        "Head": [rot(LEFT, -12)],
    })


def dance_spin():
    # Toe-stop spin (1 beat). f0: the wind-up. f4: the skater rises onto the
    # toe stops and pulls the arms in, so the turn speeds up. f8 to f15: the
    # tight spin, the left arm straight up. f19: the skates come down and the
    # arms open (the turn slows). f24: the finish, the knees take the stop.
    return True, [
        (0, _wind_up(0.08)),
        (4, _toe_spin(0.0)),
        (8, _toe_spin(1.0)),
        (15, merge(_toe_spin(1.0), {"hips": (0, 0.02, RIDE_Z + 0.07)})),
        (19, merge(_finish(0.03), {"LeftArm": [rot(FWD, 40), rot(UP, -10)], "RightArm": [rot(FWD, -20), rot(UP, 30)]})),
        (24, _finish(0.07)),
    ]


def _sit(depth, reach):
    # The sit part of the sit spin: low on the right skate, the left leg out
    # in front. depth: 0 to 1 for the drop. reach: the arms reach forward
    # (1) or are still swinging through (0).
    return merge(ride(0, 0.36 * depth, lean=10 + 18 * depth), {
        "knees": 0.0,
        "hips": (0, 0.06 * depth, RIDE_Z - 0.33 * depth),
        "R": at(-0.08, 0.06, 0, "R"),
        "L": at(0.08, -0.12 - 0.36 * depth, 0.03 + 0.09 * depth, "L", [rot(LEFT, -15 * depth)]),
        "LeftArm": [rot(FWD, -40 + 30 * reach), rot(UP, -30 - 40 * reach)],
        "RightArm": [rot(FWD, 40 - 30 * reach), rot(UP, 10 + 60 * reach)],
        "LeftForeArm": [rot(UP, -30 + 20 * reach)],
        "RightForeArm": [rot(UP, 30 - 20 * reach)],
        "Head": [rot(LEFT, -14 * depth)],
    })


def dance_sitspin():
    # Sit spin (1 beat). f0: the wind-up. f5: the drop, the left leg starts
    # to go out in front. f9 to f15: the sit, low on the right skate, the
    # arms reach forward. f20: the rise, the left leg comes back. f24: the
    # finish, standing with the arms open.
    return True, [
        (0, _wind_up(0.05)),
        (5, _sit(0.55, 0.3)),
        (9, _sit(1.0, 1.0)),
        (15, merge(_sit(1.0, 1.0), {"hips": (0, 0.06, RIDE_Z - 0.37)})),
        (20, merge(_sit(0.45, 0.4), {"LeftArm": [rot(FWD, -10), rot(UP, -40)], "RightArm": [rot(FWD, 10), rot(UP, 40)]})),
        (24, _finish(0.04)),
    ]


CLIPS = {
    "idle": idle, "push": push, "coast": coast, "ride_back": ride_back,
    "carve_left": carve_left, "carve_right": carve_right,
    "jump": jump, "land": land, "air_mute": air_mute, "air_japan": air_japan, "air_liukang": air_liukang,
    "grind_frontside": grind_frontside, "grind_soul": grind_soul, "grind_unity": grind_unity,
    "manual": manual, "bail": bail,
    "air_rocket": air_rocket, "air_tuckknee": air_tuckknee, "grind_makio": grind_makio,
    "grind_royale": grind_royale, "manual_toe": manual_toe, "land_stumble": land_stumble,
    "dance_bankhead": dance_bankhead, "dance_walkitout": dance_walkitout, "dance_prep": dance_prep,
    "dance_swagsurf": dance_swagsurf, "dance_snaplean": dance_snaplean, "dance_crisscross": dance_crisscross,
    "dance_spin": dance_spin, "dance_sitspin": dance_sitspin,
}


# Rig setup ------------------------------------------------------------------

def rest_rot(pb):
    return pb.bone.matrix_local.to_3x3()


def local_quat(pb, rotations):
    q = Quaternion()
    r = rest_rot(pb)
    rinv = r.inverted()
    for axis, deg in rotations:
        if axis == CURL:
            axis = (pb.bone.tail_local - pb.bone.head_local).normalized().cross(Vector((0, 0, -1)))
        q = Quaternion(rinv @ Vector(axis), math.radians(deg)) @ q
    return q


def knee_off_plane(arm, side, pole):
    # The signed distance of the knee from the plane through the hip joint,
    # the ankle, and the pole target (metres, positive to the skater's left).
    full = "Left" if side == "L" else "Right"
    bpy.context.view_layer.update()
    m = arm.matrix_world
    hip = m @ arm.pose.bones[bone(full + "UpLeg")].head
    knee = m @ arm.pose.bones[bone(full + "Leg")].head
    ankle = m @ arm.pose.bones[bone(full + "Foot")].head
    normal = (ankle - hip).cross(pole.location - hip).normalized()
    if normal.x < 0:
        normal = -normal
    return (knee - hip).dot(normal)


def calibrate_pole(arm, side, ik, tgt, pole):
    # Finds the IK pole angle that puts the knee in the plane through the hip,
    # the ankle, and the pole target, so the knee points at the pole (#290).
    # Each rig has its own bone roll, so a fixed angle does not work for all
    # rigs: with the old angle 0, the knees of Nia turned in and the knees of
    # Marcus turned out. The test pose lifts the ankle 0.15 m to bend the knee.
    rest = tgt.matrix_world.copy()
    tgt.location = tgt.location + Vector((0, 0, 0.15))

    def err(angle):
        ik.pole_angle = angle
        return knee_off_plane(arm, side, pole)

    a, b = math.radians(-60), math.radians(60)
    fa, fb = err(a), err(b)
    if fa * fb > 0:
        raise RuntimeError(f"pole calibration: no sign change for {side} ({fa:.3f}, {fb:.3f})")
    for _ in range(40):
        mid = (a + b) / 2
        fm = err(mid)
        if fa * fm <= 0:
            b, fb = mid, fm
        else:
            a, fa = mid, fm
    ik.pole_angle = (a + b) / 2
    tgt.matrix_world = rest
    bpy.context.view_layer.update()
    return ik.pole_angle


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
        if CFG.get("continuous_foot_rotation"):
            tgt.rotation_mode = "QUATERNION"
        pole.location = arm.matrix_world @ (knee.head_local + Vector((0, -0.6, 0)))
        leg = arm.pose.bones[bone(full + "Leg")]
        for c in list(leg.constraints):
            leg.constraints.remove(c)
        for c in list(foot.constraints):
            foot.constraints.remove(c)
        ik = leg.constraints.new("IK")
        ik.target = tgt
        ik.pole_target = pole
        ik.chain_count = 2
        cr = foot.constraints.new("COPY_ROTATION")
        cr.target = tgt
        angle = calibrate_pole(arm, side, ik, tgt, pole)
        print(f"[clips] {side} pole angle {math.degrees(angle):.1f} deg")
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
        if key in ("hips", "hipsRot", "L", "R", "pole", "knees"):
            continue
        pb = arm.pose.bones[bone(key)]
        pb.rotation_quaternion = local_quat(pb, value)
    for side in ("L", "R"):
        tgt, pole, rest, pole_rest = ik[side]
        # "pole" turns the knee direction about the hips with the body (degrees).
        pivot = hips.bone.head_local.copy()
        turn = Matrix.Rotation(math.radians(pose.get("pole", 0)), 3, "Z")
        out = Vector((pose.get("knees", 0.0) * (1 if side == "L" else -1), 0, 0))
        pole.location = pivot + turn @ (pole_rest + out - pivot) + Vector(pose.get("hips", (0, 0, 0)))
        pole.keyframe_insert("location", frame=frame)
        spec = pose.get(side, {"pos": (0, 0, 0)})
        rq = Quaternion()
        for axis, deg in spec.get("rot", []):
            rq = Quaternion(Vector(axis), math.radians(deg)) @ rq
        m = Matrix.Translation(rest.to_translation() + Vector(spec["pos"])) @ (rq.to_matrix().to_4x4() @ rest.to_3x3().to_4x4())
        previous_rotation = tgt.rotation_quaternion.copy()
        tgt.matrix_world = m
        if CFG.get("continuous_foot_rotation"):
            tgt.rotation_quaternion.make_compatible(previous_rotation)
        tgt.keyframe_insert("location", frame=frame)
        tgt.keyframe_insert(
            "rotation_quaternion" if CFG.get("continuous_foot_rotation") else "rotation_euler",
            frame=frame,
        )
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
        if pb.name == bone("Hips"):
            pb.keyframe_insert("location", frame=frame)


# The operators need a window and a 3D view. The MCP runs code in a timer,
# which has neither.
def view3d_context():
    # In background mode (blender -b) there is no window. The bake then runs
    # without a context override.
    if not bpy.context.window_manager.windows:
        return {}
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
            for fc in list(getattr(bag, "fcurves", [])):
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
            for fc in getattr(bag, "fcurves", []):
                for k in fc.keyframe_points:
                    k.interpolation = "LINEAR"
    return removed


def export(path, draco, **extra):
    # extra: more glTF exporter options, for example the image format.
    arm = bpy.data.objects[ARM]
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    bpy.context.scene.frame_set(0)
    for o in bpy.context.view_layer.objects:
        o.select_set(o.name in (MESH, ARM))
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
    opts.update(extra)
    bpy.ops.export_scene.gltf(filepath=path, **opts)
