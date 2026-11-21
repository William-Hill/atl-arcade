"""Build the runtime skater GLB on the corrected v2 body.

The source is `raw/forward-v2/<name>-forward.blend`. It holds the corrected
body, the rig, and the reviewed `push` and `coast` clips.

1. Marcus gets the hand and seam corrections (#168): fit and weight the 40
   finger joints, and keep the knee pads and wristbands closed.
2. The script keys the other 22 M1-02 clips of `nia_clips.py` on this body
   (#170). It uses the leg IK of `skater_forward_motion.py`:
   - The pole angle of each knee is calibrated on this rig, so a bent knee
     points forward.
   - The knee pole turns with the foot yaw, so the knee follows the skate.
   - At each key, the pole turns about the hip-ankle axis until the knee
     bend points over the skate. One pole angle does not fit every leg shape.
   - Foot targets use quaternions, so a foot does not flip between frames.
   - `at()` foot positions scale with the hip width of the skater.
3. Run `skater_motion_retarget.py` after this script to add
   `dance_smoothquad` from the approved Tripo dance.

Run in a background Blender process from the repository root:

    blender -b --factory-startup --python-exit-code 1 \
      -P scripts/blender/skater_runtime.py -- --name marcus

The script writes `raw/runtime-v2/<name>-runtime.blend`, `build.json`, and
`skater.glb`. Run `skater_texture_variant.py` on the final .blend for
`skater-1024.glb`.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from skater_repair import reset
import skater_hands
import skater_seams

# The clips that skater_forward_motion.py keys. This script keeps them.
FORWARD_CLIPS = ("push", "coast")
# Half the hip width of Nia's v2 rig. The at() foot positions use this scale.
NIA_HIP_HALF = .083


def correct_marcus(arm, mesh):
    report = {"pads": skater_seams.close_pads(arm, mesh),
              "wristbands": skater_seams.close_cuffs(mesh)}
    fits, report["finger_fit"] = skater_hands.fit_fingers(arm, mesh)
    report["finger_weights"] = skater_hands.weight_fingers(arm, mesh, fits)
    return report


def foot_yaw(spec):
    """Return the yaw of a foot target in degrees, from its rotation list."""
    q = Quaternion()
    for axis, deg in spec.get("rot", []):
        q = Quaternion(Vector(axis), math.radians(deg)) @ q
    forward = q @ Vector((0, -1, 0))
    if Vector((forward.x, forward.y)).length < .2:
        return 0.0
    return math.degrees(math.atan2(forward.x, -forward.y))


def forward_ik(scope, arm):
    """Patch nia_clips.py with the calibrated leg IK of the forward build."""
    original_setup = scope["setup_ik"]
    original_apply = scope["apply_pose"]
    angles = {}
    corrections = []

    def apply_pose(target, ik, pose, frame):
        original_apply(target, ik, pose, frame)
        scene = bpy.context.scene
        for side, full in (("L", "Left"), ("R", "Right")):
            pole = ik[side][1]
            # The knee points over the skate. A "pole" key in the pose turns
            # the knees with the body instead.
            yaw = pose["pole"] if "pole" in pose else foot_yaw(pose.get(side, {}))
            want = Matrix.Rotation(math.radians(yaw), 3, "Z") @ Vector((0, -1, 0))
            if "pole" not in pose:
                knee = ik[side][3] - Vector((0, -.6, 0))
                pole.location = knee + Vector(pose.get("hips", (0, 0, 0))) + want * .6
                pole.keyframe_insert("location", frame=frame)
            # One pole angle does not fit every leg shape. Turn the pole about
            # the hip-ankle axis until the knee bend points in the wanted direction.
            error, bend = 0.0, Vector()
            for _ in range(4):
                scene.frame_set(frame)
                hip, knee, ankle = [target.pose.bones["mixamorig:" + full + part].head.copy()
                                    for part in ("UpLeg", "Leg", "Foot")]
                axis = (ankle - hip).normalized()
                bend = knee - hip - axis * (knee - hip).dot(axis)
                goal = want - axis * want.dot(axis)
                if bend.length < .01 or goal.length < .1:
                    break
                error = math.atan2(axis.dot(goal.cross(bend)), goal.dot(bend))
                if abs(error) < math.radians(.5):
                    break
                turn = Matrix.Rotation(-error, 3, axis)
                pole.location = hip + turn @ (pole.location - hip)
                pole.keyframe_insert("location", frame=frame)
            corrections.append(abs(math.degrees(error)))

    def setup_ik(target):
        ik = original_setup(target)
        before = set(bpy.data.actions)
        # Calibrate on a bent knee. A straight leg has no bend direction.
        _, keys = scope["CLIPS"]["idle"]()
        apply_pose(target, ik, keys[0][1], 0)
        for side, full in (("L", "Left"), ("R", "Right")):
            constraint = next(c for c in target.pose.bones["mixamorig:" + full + "Leg"].constraints
                              if c.type == "IK")
            best = (math.inf, 0)
            for degree in range(-180, 181, 2):
                constraint.pole_angle = math.radians(degree)
                bpy.context.view_layer.update()
                hip, knee, ankle = [target.pose.bones["mixamorig:" + full + part].head
                                    for part in ("UpLeg", "Leg", "Foot")]
                axis = (ankle - hip).normalized()
                bend = knee - hip - axis * (knee - hip).dot(axis)
                assert bend.length > .01, "The calibration pose has a straight knee."
                forward = Vector((0, -1, 0))
                forward -= axis * forward.dot(axis)
                best = min(best, (bend.angle(forward), degree))
            constraint.pole_angle = math.radians(best[1])
            angles[side] = best[1]
        target.animation_data.action = None
        for values in ik.values():
            values[0].animation_data_clear()
            values[1].animation_data_clear()
        for action in set(bpy.data.actions) - before:
            bpy.data.actions.remove(action)
        return ik

    scope["apply_pose"] = apply_pose
    scope["setup_ik"] = setup_ik
    return angles, corrections


def rekey(arm, mesh, report):
    kept = [bpy.data.actions[name] for name in FORWARD_CLIPS]
    for action in list(bpy.data.actions):
        if action not in kept:
            bpy.data.actions.remove(action)
    for action in kept:
        action.use_fake_user = True
    feet = [arm.data.bones["mixamorig:" + side + "Foot"].head_local for side in ("Left", "Right")]
    hip_half = abs(arm.data.bones["mixamorig:LeftUpLeg"].head_local.x)
    cfg = {"arm": arm.name, "mesh": mesh.name, "continuous_foot_rotation": True,
           "feet": (feet[0].x, feet[1].x, (feet[0].y + feet[1].y) / 2),
           "stance": hip_half / NIA_HIP_HALF}
    scope = {"__name__": "skater_runtime", "SKATER_CFG": cfg}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    angles, corrections = forward_ik(scope, arm)
    names = [n for n in scope["CLIPS"] if n not in FORWARD_CLIPS]
    bpy.context.scene.render.fps = scope["FPS"]
    arm.animation_data_create()
    ik = scope["setup_ik"](arm)
    for name in names:
        scope["build_clip"](arm, ik, name)
    scope["clear_rig"](arm)
    removed = scope["prune_static_channels"]()
    report.update({"skater_cfg": {k: v for k, v in cfg.items() if k not in ("arm", "mesh")},
                   "pole_angles_degrees": angles, "rekeyed_clips": names,
                   "knee_keys": len(corrections),
                   "knee_residual_degrees_max": round(max(corrections, default=0), 2),
                   "kept_clips": list(FORWARD_CLIPS), "static_curves_removed": removed})
    return scope


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--source", type=Path, help="The forward v2 .blend source.")
    parser.add_argument("--out", type=Path, help="The directory for the new .blend.")
    parser.add_argument("--glb", type=Path, help="The exported GLB.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    raw = ROOT / "assets/skaters" / args.name / "raw"
    source = args.source or raw / "forward-v2" / (args.name + "-forward.blend")
    out = args.out or raw / "runtime-v2"
    glb = args.glb or ROOT / "assets/skaters" / args.name / "skater.glb"
    bpy.ops.wm.open_mainfile(filepath=str(source.resolve()))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    assert arm.matrix_world == Matrix.Identity(4) and mesh.matrix_world == Matrix.Identity(4)
    reset(arm)
    report = {"name": args.name, "source": str(source)}
    if args.name == "marcus":
        report.update(correct_marcus(arm, mesh))
    scope = rekey(arm, mesh, report)
    reset(arm)
    arm.animation_data_create()
    report["clips"] = sorted(a.name for a in bpy.data.actions)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str((out / (args.name + "-runtime.blend")).resolve()))
    scope["export"](str(glb.resolve()), True, export_image_format="JPEG", export_jpeg_quality=88)
    (out / "build.json").write_text(json.dumps(report, indent=2) + "\n")
    print("RUNTIME_BUILD", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
