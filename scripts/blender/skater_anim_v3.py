"""Key the v3 skater clips: a full upper body in the stride, a brake, and a
separate move set for Marcus.

The source is `raw/forward-v2/<name>-forward.blend`, the same body as the
shipped `skater.glb`. The script keys the clips with `nia_clips.py` and the
leg IK of `skater_runtime.py`, then exports the clips alone to a GLB.
`scripts/assets/graft-clips.mjs` puts the clips into the shipped GLBs, so the
mesh and the textures do not change.

Clips:
- Both skaters: `push` and `coast` again, with arm swing, torso counter
  turn, and weight shift on each stroke. A new `brake` clip.
- Nia: a T-stop brake. Her other clips stay.
- Marcus: his own idle (drum count), carve (crossovers), and toe-stop drag
  brake. His other nia_clips.py clips go through `marcus_style()`: the other
  lead foot, a lower and wider stance, a chest that leans forward, a head
  nod on each beat, and staccato timing (each move holds, then hits).
  `dance_smoothquad` (the retargeted Tripo dance) stays.

Run in a background Blender process from the repository root:

    blender -b --factory-startup --python-exit-code 1 \
      -P scripts/blender/skater_anim_v3.py -- --name marcus \
      --source <raw>/forward-v2/marcus-forward.blend --out <dir>
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from skater_repair import reset
from skater_motion_retarget import sole_points
import skater_runtime


def ease(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# The stride and glide of each skater. Nia: a smooth rink glide with long
# support phases and a long, loose arm swing. Marcus: a lower, sharper jam
# stride. His right arm stays bent like a drum stick, and his head nods on
# each stroke.
STYLE = {
    "nia": {
        "push_frames": 60, "coast_frames": 96, "phase": 0.0,
        "outward": .16, "back": .15, "lift": .065, "height": .80, "coast_height": .87,
        "lean": 24, "lean_wave": 3, "coast_lean": 12,
        "swing": (44, 44), "cross": 16, "elbow": ((34, 18), (34, 18)),
        "torso": 15, "hip_yaw": 7, "roll": 6, "bob": .035, "nod": 0, "sharp": 1.0, "carve_drop": .09,
    },
    "marcus": {
        "push_frames": 48, "coast_frames": 48, "phase": .5,
        "outward": .145, "back": .20, "lift": .08, "height": .77, "coast_height": .84,
        "lean": 28, "lean_wave": 2, "coast_lean": 16,
        "swing": (40, 20), "cross": 8, "elbow": ((30, 14), (84, 10)),
        "torso": 11, "hip_yaw": 4, "roll": 3, "bob": .04, "nod": 7, "sharp": 2.2, "carve_drop": .09,
    },
}


def sharpen(x, power):
    # A sine with flat ends: a larger power holds near +-1 and moves fast
    # through 0 (a sharper accent).
    return math.copysign(abs(x) ** (1 / power), x)


def make_stride(scope, arm, mesh, name):
    st = STYLE[name]
    LEFT, FWD, UP = scope["LEFT"], scope["FWD"], scope["UP"]
    soles = sole_points(arm, mesh)
    root = arm.data.bones["mixamorig:Hips"].head_local.copy()
    legs = {}
    for side, full, sign in (("L", "Left", 1), ("R", "Right", -1)):
        thigh, shin, foot = [arm.data.bones["mixamorig:" + full + part] for part in ("UpLeg", "Leg", "Foot")]
        legs[side] = {"name": foot.name, "sign": sign, "hip_offset": thigh.head_local - root,
                      "length": (shin.head_local - thigh.head_local).length + (foot.head_local - shin.head_local).length,
                      "rest": foot.matrix_local.copy()}
    half_width = max(.13, *(abs(v["hip_offset"].x) + .035 for v in legs.values()))

    def pose_at(frame, pushing):
        frames = st["push_frames"] if pushing else st["coast_frames"]
        t = (frame / frames + st["phase"]) % 1
        half = 0 if t < .5 else 1
        # support: +1 puts the weight over the left skate, -1 over the right.
        support = (1 if half == 0 else -1) * (1 - 2 * ease((t % .5) / .12))
        if not pushing:
            support = .3 * math.sin(2 * math.pi * t)
        hip_x = (half_width - .035) * support
        hip_y = root.y - (.025 if pushing else .012)
        feet, targets = {}, {}
        for side, leg in legs.items():
            p = (t + (0 if side == "L" else .5)) % 1
            sign = leg["sign"]
            lift = 0
            if pushing and p < .32:
                q = ease(p / .32)
                x, y, yaw = sign * (half_width + st["outward"] * q), st["back"] * q, sign * 15 * q
            elif pushing and p < .5:
                q = (p - .32) / .18
                x = sign * (half_width + st["outward"] * (1 - ease(q)))
                y = st["back"] + (-.075 - st["back"]) * ease(q)
                lift = st["lift"] * math.sin(math.pi * q) ** 2
                yaw = sign * (15 - 13 * ease(q))
            elif pushing:
                q = ease((p - .5) / .5)
                x, y, yaw = sign * half_width, -.075 * (1 - q), sign * 2 * (1 - q)
            else:
                # The glide: the lead skate a little forward. Nia leads with
                # the left skate, Marcus with the right.
                x = sign * half_width
                y = -.06 if (side == "L") == (name == "nia") else .04
                yaw = sign * 3
            rotation = Matrix.Rotation(math.radians(yaw), 4, "Z") @ leg["rest"].to_quaternion().to_matrix().to_4x4()
            z = lift - min((rotation @ point).z for point in soles[leg["name"]])
            targets[side] = Vector((x, y, z))
            feet[side] = {"pos": targets[side] - leg["rest"].translation, "rot": [(UP, yaw)]}
        reach = st["height"] if pushing else st["coast_height"]
        rhythm = math.sin(2 * math.pi * t)
        accent = sharpen(rhythm, st["sharp"])
        # The body drops on the drive of each stroke and rises at the lift.
        bob = st["bob"] * (abs(math.sin(2 * math.pi * t)) if pushing else .4 * (1 + math.cos(4 * math.pi * t)) / 2)
        hip_z = min(targets[s].z + leg["length"] * reach - leg["hip_offset"].z for s, leg in legs.items())
        for side, leg in legs.items():
            dx = targets[side].x - hip_x - leg["hip_offset"].x
            dy = targets[side].y - hip_y - leg["hip_offset"].y
            available = (leg["length"] * .985) ** 2 - dx * dx - dy * dy
            assert available > 0
            hip_z = min(hip_z, targets[side].z + math.sqrt(available) - leg["hip_offset"].z)
        hip_z -= bob
        amount = 1.0 if pushing else .35
        lean = st["lean"] if pushing else st["coast_lean"]
        lean += st["lean_wave"] * math.sin(4 * math.pi * t - math.pi / 3) * amount
        # Torso counter turn: the hips turn toward the pushing leg, and the
        # shoulders turn the other way with the forward arm.
        torso = -st["torso"] * accent * amount
        hip_yaw = st["hip_yaw"] * accent * amount
        # Weight shift: the chest rolls over the support skate.
        roll = st["roll"] * support * (1 if pushing else .6)
        swing_l, swing_r = st["swing"]
        fl, fr = max(accent, 0), max(-accent, 0)
        (el, el_amp), (er, er_amp) = st["elbow"]
        nod = st["nod"] * abs(accent) if pushing else st["nod"] * .5 * (1 + math.cos(4 * math.pi * t))
        pose = {
            "hips": (hip_x - root.x, hip_y - root.y, hip_z - root.z),
            "hipsRot": [(UP, hip_yaw), (FWD, -2 * support * amount)],
            "Spine": [(LEFT, lean), (FWD, -roll)],
            "Spine1": [(UP, torso * .5 - hip_yaw * .6), (FWD, roll * .3)],
            "Spine2": [(UP, torso * .5 - hip_yaw * .4)],
            # The head turns against the shoulders, so the eyes stay on the line.
            "Neck": [(LEFT, -lean * .4), (UP, -torso * .5), (FWD, roll * .3)],
            "Head": [(LEFT, -lean * .3 + nod), (UP, -torso * .4), (FWD, roll * .4)],
            # A negative LEFT angle swings a hanging arm forward. The forward
            # arm crosses toward the midline with more elbow bend.
            "LeftArm": [(FWD, -76 + 6 * fr), (LEFT, -swing_l * accent * amount), (UP, -st["cross"] * fl * amount)],
            "RightArm": [(FWD, 76 - 6 * fl), (LEFT, swing_r * accent * amount), (UP, st["cross"] * fr * amount)],
            "LeftForeArm": [(UP, -(el + el_amp * accent * amount))],
            "RightForeArm": [(UP, er - er_amp * accent * amount)],
            "LeftHand": [(UP, -5), (LEFT, -8 * fl * amount)],
            "RightHand": [(UP, 5), (LEFT, -8 * fr * amount)],
        }
        pose.update(scope["_relaxed_hands"]())
        return pose

    return pose_at


def nia_brake(scope):
    # The T-stop, one beat. The weight is on the left skate with a bent
    # knee. The right skate turns 80 degrees out and drags behind it, the
    # wheels flat on the ground. The chest comes up and back, and the arms go
    # out to the sides for balance.
    at, rot, merge = scope["at"], scope["rot"], scope["merge"]
    LEFT, FWD, UP = scope["LEFT"], scope["FWD"], scope["UP"]

    def key(down, drag):
        return merge(scope["_relaxed_hands"](), {
            "hips": (.04, .05, -.17 - down),
            "hipsRot": [rot(UP, -16), rot(FWD, -3)],
            "Spine": [rot(LEFT, -2), rot(FWD, -5)],
            "Spine1": [rot(UP, 12), rot(LEFT, 2)],
            "Neck": [rot(LEFT, -2), rot(UP, 6)],
            "Head": [rot(LEFT, 2), rot(UP, 4)],
            "L": at(.08, -.08, 0, "L", [rot(UP, 6)]),
            "R": at(-.04 - drag, .30, 0, "R", [rot(UP, -80)]),
            "LeftArm": [rot(FWD, -38), rot(LEFT, -16), rot(UP, -6)],
            "RightArm": [rot(FWD, 34), rot(LEFT, 10), rot(UP, 10)],
            "LeftForeArm": [rot(UP, -26)],
            "RightForeArm": [rot(UP, 22)],
            "LeftHand": [rot(FWD, -12)],
            "RightHand": [rot(FWD, 12)],
        })
    a, b = key(0.0, 0.0), key(.02, .015)
    return True, [(0, a), (6, b), (12, a), (18, b), (24, a)]


def marcus_brake(scope):
    # The toe-stop drag, one beat. Marcus brakes on the other side: the
    # right skate carries the weight, the left skate drags behind on its toe
    # stop. The chest stays forward and low, and the arms make a sharp
    # asymmetric shape: the left arm forward, the right arm back and bent.
    at, rot, merge = scope["at"], scope["rot"], scope["merge"]
    LEFT, FWD, UP = scope["LEFT"], scope["FWD"], scope["UP"]

    def key(down, chatter):
        return merge(scope["FISTS"], {
            "hips": (-.05, .06, -.22 - down),
            "hipsRot": [rot(UP, 10), rot(FWD, 4)],
            "Spine": [rot(LEFT, 16), rot(FWD, 4)],
            "Spine1": [rot(UP, -10), rot(LEFT, 4)],
            "Neck": [rot(LEFT, -8)],
            "Head": [rot(LEFT, -2 + 6 * chatter), rot(UP, -4)],
            "R": at(-.11, -.06, 0, "R", [rot(UP, -6)]),
            "L": at(.07, .40, .035, "L", [rot(UP, 10), rot(LEFT, 34 + 4 * chatter)]),
            "LeftArm": [rot(FWD, -66), rot(LEFT, -46), rot(UP, -18)],
            "RightArm": [rot(FWD, 70), rot(LEFT, 30), rot(UP, 6)],
            "LeftForeArm": [rot(UP, -32)],
            "RightForeArm": [rot(UP, 88)],
        })
    a, b = key(0.0, 0.0), key(.015, 1.0)
    return True, [(0, a), (4, b), (12, a), (16, b), (24, a)]


def marcus_idle(scope):
    # The drum count, one bar (4 beats). Marcus stands square, the skates
    # under the hips. His hands tap a cadence at his hips like drum sticks: right,
    # left, right-right. The right skate taps its toe stop on beats 2 and 4,
    # and the head nods on each beat.
    at, rot, merge = scope["at"], scope["rot"], scope["merge"]
    LEFT, FWD, UP = scope["LEFT"], scope["FWD"], scope["UP"]
    B = scope["BEAT"]

    def key(beat, hit_l, hit_r, tap, nod):
        return merge(scope["FISTS"], {
            "hips": (0, .03, -.11 - .02 * nod),
            "hipsRot": [rot(UP, 4)],
            "Spine": [rot(LEFT, 9)],
            "Spine1": [rot(UP, -5)],
            "Neck": [rot(LEFT, -4)],
            "Head": [rot(LEFT, 10 * nod), rot(UP, -6)],
            "L": at(.10, -.02, 0, "L", [rot(UP, 10)]),
            "R": at(-.10, .06 if tap else .02, .05 if tap else 0, "R", [rot(UP, -12), rot(LEFT, 22 if tap else 0)]),
            # The upper arms stay near the ribs. A hit snaps the forearm down.
            "LeftArm": [rot(FWD, -70), rot(LEFT, -26), rot(UP, -10)],
            "RightArm": [rot(FWD, 70), rot(LEFT, -26), rot(UP, 10)],
            "LeftForeArm": [rot(UP, -(92 - 38 * hit_l))],
            "RightForeArm": [rot(UP, 92 - 38 * hit_r)],
            "LeftHand": [rot(LEFT, 18 * hit_l - 8)],
            "RightHand": [rot(LEFT, 18 * hit_r - 8)],
        })
    # (beat, left hit, right hit, toe tap)
    pattern = [(0, 0, 1, 0), (1, 1, 0, 1), (2, 0, 1, 0), (3, 0, 1, 1)]
    keys = []
    for beat, hl, hr, tap in pattern:
        f = beat * B
        keys += [(f, key(beat, hl, hr, tap, 1)), (f + 4, key(beat, hl * .2, hr * .2, tap, .3)),
                 (f + B // 2, key(beat, 0, 0, 0, 0))]
        if beat == 3:  # the double hit: right-right
            keys.append((f + B // 2 + 4, key(beat, 0, 1, 0, .4)))
    return True, keys + [(4 * B, keys[0][1])]


def marcus_carve_left(scope):
    # Jam crossovers into a left turn, 2 beats. The right skate lifts and
    # crosses over in front of the left skate. Then the left skate comes out
    # from under and steps wide to the left. The chest turns into the curve
    # more than Nia's, and the right arm swings across the body.
    at, rot, merge = scope["at"], scope["rot"], scope["merge"]
    LEFT, FWD, UP = scope["LEFT"], scope["FWD"], scope["UP"]

    def key(rx, ry, rz, lx, ly, lz, down, arm):
        return merge(scope["FISTS"], {
            "hips": (.05, .02, -.17 - STYLE["marcus"]["carve_drop"] - down),
            "hipsRot": [rot(UP, 16), rot(FWD, -8)],
            "Spine": [rot(LEFT, 26), rot(FWD, -9)],
            "Spine1": [rot(UP, 18), rot(LEFT, 4)],
            "Neck": [rot(LEFT, -8), rot(UP, 8)],
            "Head": [rot(UP, 16), rot(LEFT, 2)],
            "R": at(rx, ry, rz, "R", [rot(UP, 14)]),
            "L": at(lx, ly, lz, "L", [rot(UP, 18)]),
            "LeftArm": [rot(FWD, -64), rot(LEFT, 30 * arm), rot(UP, -14)],
            "RightArm": [rot(FWD, 62), rot(LEFT, -44 * arm), rot(UP, 34 * arm)],
            "LeftForeArm": [rot(UP, -30)],
            "RightForeArm": [rot(UP, 70)],
        })
    open_ = key(-.16, .02, 0, .18, -.02, 0, .03, .4)
    lift = key(-.04, -.04, .08, .16, .02, 0, .0, .8)
    cross = key(.10, -.10, 0, .14, .10, 0, .06, 1.0)
    out = key(.06, -.04, 0, .30, -.02, .06, .02, .6)
    return True, [(0, open_), (8, lift), (14, cross), (20, out), (24, open_),
                  (32, lift), (38, cross), (44, out), (48, open_)]


def marcus_style(scope, loop, keys, staccato=True):
    # Marcus' version of a shared clip: the other lead foot, a lower and
    # wider stance, a chest that leans forward, a head nod on each beat, and
    # staccato timing.
    rot, LEFT = scope["rot"], scope["LEFT"]
    B = scope["BEAT"]
    out = []
    for frame, pose in keys:
        p = dict(scope["mirror_pose"](pose))
        h = p.get("hips", (0, 0, 0))
        p["hips"] = (h[0], h[1], h[2] - .025)
        p["Spine"] = list(p.get("Spine", [])) + [rot(LEFT, 5)]
        nod = 7 if frame % B == 0 else 0
        p["Head"] = list(p.get("Head", [])) + [rot(LEFT, nod - 3)]
        for side, dx in (("L", .02), ("R", -.02)):
            spec = p.get(side, {"pos": (0, 0, 0)})
            pos = spec["pos"]
            p[side] = dict(spec, pos=(pos[0] + dx, pos[1], pos[2]))
        out.append((frame, p))
    if staccato and loop:
        # Each move holds its pose for 45% of the gap, then hits the next.
        held = []
        for (f0, p0), (f1, _) in zip(out, out[1:]):
            held.append((f0, p0))
            if f1 - f0 >= 6:
                held.append((f0 + round(.45 * (f1 - f0)), p0))
        held.append(out[-1])
        out = held
    return loop, out


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--source", type=Path, required=True, help="The forward v2 .blend source.")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--clips", help="Comma list: build only these clips.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    bpy.ops.wm.open_mainfile(filepath=str(args.source.resolve()))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    reset(arm)
    report = {"name": args.name, "source": str(args.source)}
    if args.name == "marcus":
        # The same finger fit as the shipped GLB, so the rest pose matches.
        report.update({k: str(v)[:200] for k, v in skater_runtime.correct_marcus(arm, mesh).items()})
    feet = [arm.data.bones["mixamorig:" + side + "Foot"].head_local for side in ("Left", "Right")]
    hip_half = abs(arm.data.bones["mixamorig:LeftUpLeg"].head_local.x)
    cfg = {"arm": arm.name, "mesh": mesh.name, "continuous_foot_rotation": True,
           "feet": (feet[0].x, feet[1].x, (feet[0].y + feet[1].y) / 2),
           "stance": hip_half / skater_runtime.NIA_HIP_HALF}
    scope = {"__name__": "skater_anim_v3", "SKATER_CFG": cfg}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    shared = dict(scope["CLIPS"])
    pose_at = make_stride(scope, arm, mesh, args.name)
    st = STYLE[args.name]
    clips = {
        "push": lambda: (True, [(f, pose_at(f, True)) for f in range(st["push_frames"] + 1)]),
        "coast": lambda: (True, [(f, pose_at(f, False)) for f in range(0, st["coast_frames"] + 1, 2)]),
    }
    if args.name == "nia":
        clips["brake"] = lambda: nia_brake(scope)

        def deeper(fn):
            # The ATL Ryde corner step of nia_clips.py with a deeper knee
            # bend: the hips drop and the chest leans further into the turn.
            loop, keys = fn()
            out = []
            for f, pose in keys:
                p = dict(pose)
                h = p.get("hips", (0, 0, 0))
                p["hips"] = (h[0], h[1], h[2] - st["carve_drop"])
                p["Spine"] = list(p.get("Spine", [])) + [scope["rot"](scope["LEFT"], 8)]
                out.append((f, p))
            return loop, out
        clips["carve_left"] = lambda: deeper(shared["carve_left"])
        clips["carve_right"] = lambda: deeper(shared["carve_right"])
    else:
        clips["brake"] = lambda: marcus_brake(scope)
        clips["idle"] = lambda: marcus_idle(scope)
        clips["carve_left"] = lambda: marcus_carve_left(scope)

        def carve_right():
            loop, keys = marcus_carve_left(scope)
            return loop, [(f, scope["mirror_pose"](p)) for f, p in keys]
        clips["carve_right"] = carve_right
        for n, fn in shared.items():
            if n in clips or n in ("push", "coast"):
                continue
            groove = n.startswith("dance_") or n in ("ride_back", "manual") or n.startswith("grind_") or n.startswith("air_")
            clips[n] = (lambda fn=fn, groove=groove: marcus_style(scope, *fn(), staccato=groove))
    if args.clips:
        keep = args.clips.split(",")
        clips = {k: v for k, v in clips.items() if k in keep}
    # The leg IK calibrates its knee poles on the idle clip.
    scope["CLIPS"] = {"idle": shared["idle"], **clips}
    angles, corrections = skater_runtime.forward_ik(scope, arm)
    bpy.context.scene.render.fps = scope["FPS"]
    arm.animation_data_create()
    scope["build_all"](list(clips))  # only the new clips
    removed = scope["prune_static_channels"]()
    reset(arm)
    arm.animation_data_create()
    args.out.mkdir(parents=True, exist_ok=True)
    glb = args.out / (args.name + "-clips-v3.glb")
    scope["export"](str(glb.resolve()), False, export_image_format="NONE", export_materials="NONE")
    bpy.ops.wm.save_as_mainfile(filepath=str((args.out / (args.name + "-anim-v3.blend")).resolve()))
    report.update({"clips": sorted(clips), "pole_angles_degrees": angles, "knee_keys": len(corrections),
                   "knee_residual_degrees_max": round(max(corrections, default=0), 2),
                   "static_curves_removed": removed, "glb": str(glb)})
    (args.out / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("ANIM_V3_BUILD", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
