"""Transfer a Tripo motion to a repaired skater rig."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from skater_repair import reset


def leg_length(arm):
    total = 0
    for side in ("Left", "Right"):
        points = [arm.matrix_world @ arm.data.bones["mixamorig:" + side + part].head_local
                  for part in ("UpLeg", "Leg", "Foot")]
        total += sum((b - a).length for a, b in zip(points, points[1:]))
    return total / 2


# SMPL-H bone names (Meshy text to motion) to Mixamo names. A Mixamo bone
# with no SMPL-H bone (the finger tips, HeadTop_End, the toe ends) keeps its
# local rest rotation: it follows its parent.
SIDES = {"L_": "Left", "R_": "Right"}
SMPLH = {"Pelvis": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Spine3": "Spine2",
         "Neck": "Neck", "Head": "Head"}
for _p, _side in SIDES.items():
    SMPLH.update({_p + "Hip": _side + "UpLeg", _p + "Knee": _side + "Leg", _p + "Ankle": _side + "Foot",
                  _p + "Foot": _side + "ToeBase", _p + "Collar": _side + "Shoulder", _p + "Shoulder": _side + "Arm",
                  _p + "Elbow": _side + "ForeArm", _p + "Wrist": _side + "Hand"})
    for _f in ("Index", "Middle", "Ring", "Pinky", "Thumb"):
        for _i in (1, 2, 3):
            SMPLH[f"{_p}{_f}{_i}"] = f"{_side}Hand{_f}{_i}"


def rename_smplh(source):
    for bone in source.data.bones:
        if bone.name in SMPLH:
            bone.name = "mixamorig:" + SMPLH[bone.name]


def sample_motion(source, frames):
    action = source.animation_data.action
    start, end = action.frame_range
    rest = {b.name: (source.matrix_world @ b.matrix_local).to_quaternion()
            for b in source.data.bones}
    origin = source.matrix_world @ source.data.bones["mixamorig:Hips"].head_local
    samples = []
    for frame in range(frames + 1):
        time = start + (end - start) * frame / frames
        bpy.context.scene.frame_set(math.floor(time), subframe=time % 1)
        rotations = {
            b.name: (source.matrix_world @ b.matrix).to_quaternion() @ rest[b.name].inverted()
            for b in source.pose.bones
        }
        hips = source.matrix_world @ source.pose.bones["mixamorig:Hips"].head - origin
        samples.append((rotations, hips.copy()))
    return samples


def sole_points(arm, mesh):
    points = {}
    for side in ("Left", "Right"):
        name = "mixamorig:" + side + "Foot"
        index = mesh.vertex_groups[name].index
        bone_rest = arm.matrix_world @ arm.data.bones[name].matrix_local
        transform = bone_rest.inverted() @ mesh.matrix_world
        points[name] = [
            transform @ v.co for v in mesh.data.vertices
            if any(g.group == index and g.weight > .95 for g in v.groups)
            and (mesh.matrix_world @ v.co).z < bone_rest.translation.z + .02
        ]
        assert len(points[name]) > 20, f"Missing sole vertices: {side}"
    return points


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--fbx", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--base", type=Path, help="A .blend with the target armature and mesh.")
    parser.add_argument("--library", type=Path, help="Append actions from another .blend before retargeting.")
    parser.add_argument("--clip", default="coast")
    parser.add_argument("--preserve-actions", action="store_true")
    parser.add_argument("--glb", type=Path, help="Override the exported GLB path.")
    parser.add_argument("--map", choices=("mixamo", "smplh"), default="mixamo",
                        help="The source skeleton. smplh: a Meshy text to motion FBX.")
    parser.add_argument("--blend", type=Path, help="Override the saved .blend path.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    base = args.base or (ROOT / "assets/skaters" / args.name / "raw" /
                         ("review-v4" if args.name == "nia" else "review-v6") /
                         (args.name + "-review.blend"))
    bpy.ops.wm.open_mainfile(filepath=str(base.resolve()))
    target = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    reset(target)
    if not args.preserve_actions:
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
    if args.library:
        excluded = {"push", "coast", args.clip}
        with bpy.data.libraries.load(str(args.library.resolve())) as (data_from, data_to):
            data_to.actions = [name for name in data_from.actions if name not in excluded]
        print("APPENDED_ACTIONS", len(data_to.actions), flush=True)
    existing = set(bpy.data.objects)
    existing_actions = set(bpy.data.actions)
    if args.fbx:
        bpy.ops.import_scene.fbx(filepath=str(args.fbx.resolve()))
        imported = [o for o in bpy.data.objects if o not in existing]
        source = next(o for o in imported if o.type == "ARMATURE")
        if args.map == "smplh":
            rename_smplh(source)
            assert set(source.data.bones.keys()) <= set(target.data.bones.keys())
        else:
            assert len(source.data.bones) == len(target.data.bones) == 65
            assert set(source.data.bones.keys()) == set(target.data.bones.keys())
        action = source.animation_data.action
        assert action
        source_fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
        duration = (action.frame_range[1] - action.frame_range[0]) / source_fps
        assert duration > 0
        frames = round(duration * 30)
        factor = leg_length(target) / leg_length(source)
        samples = sample_motion(source, frames)
        source_action = action.name
        for obj in imported:
            bpy.data.objects.remove(obj, do_unlink=True)
        for action in set(bpy.data.actions) - existing_actions:
            bpy.data.actions.remove(action)
    else:
        duration = frames = factor = 0
        samples = []
        source_action = None
    reset(target)
    bpy.context.scene.render.fps = 30
    bpy.context.scene.render.fps_base = 1
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = frames
    target.animation_data_create()
    target.animation_data.action = bpy.data.actions.new(args.clip)
    target.animation_data.action.use_fake_user = True
    rest = {b.name: (target.matrix_world @ b.matrix_local).to_quaternion()
            for b in target.data.bones}
    soles = sole_points(target, mesh)
    hips = target.pose.bones["mixamorig:Hips"]
    world_to_hips = hips.bone.matrix_local.to_3x3().inverted() @ target.matrix_world.to_3x3().inverted()
    drift = samples[-1][1] - samples[0][1] if samples else Vector()
    drift.z = 0
    previous = {}
    corrections = []
    for frame, (deltas, translation) in enumerate(samples):
        bpy.context.scene.frame_set(frame)
        desired = {name: delta @ rest[name] for name, delta in deltas.items()}
        # A bone with no source bone follows its parent (pose.bones lists a parent first).
        for pb in target.pose.bones:
            if pb.name not in desired:
                parent_delta = desired[pb.parent.name] @ rest[pb.parent.name].inverted() if pb.parent else Quaternion()
                desired[pb.name] = parent_delta @ rest[pb.name]
        for pb in target.pose.bones:
            if pb.parent:
                q = rest[pb.name].inverted() @ rest[pb.parent.name] @ desired[pb.parent.name].inverted() @ desired[pb.name]
            else:
                q = rest[pb.name].inverted() @ desired[pb.name]
            if pb.name in previous:
                q.make_compatible(previous[pb.name])
            pb.rotation_quaternion = q
            previous[pb.name] = q.copy()
        hips.location = world_to_hips @ ((translation - drift * frame / frames) * factor)
        bpy.context.view_layer.update()
        lowest = min((target.matrix_world @ target.pose.bones[name].matrix @ point).z
                     for name, points in soles.items() for point in points)
        hips.location += world_to_hips @ Vector((0, 0, -lowest))
        corrections.append(-lowest)
        bpy.context.view_layer.update()
        for pb in target.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        hips.keyframe_insert("location", frame=frame)
    scope = {"__name__": "motion_export",
             "SKATER_CFG": {"arm": target.name, "mesh": mesh.name}}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    scope["prune_static_channels"]()
    args.out.mkdir(parents=True, exist_ok=True)
    for action in bpy.data.actions:
        action.use_fake_user = True
    blend_path = args.blend or args.out / (args.name + "-motion-test.blend")
    glb_path = args.glb or args.out / (args.name + "-motion-test.glb")
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    glb_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    scope["export"](str(glb_path), True,
                    export_image_format="JPEG", export_jpeg_quality=88)
    metadata = {
        "base_blend": str(base), "library_blend": str(args.library) if args.library else None,
        "target_clip": args.clip, "actions": sorted(a.name for a in bpy.data.actions),
        "source_fbx": str(args.fbx) if args.fbx else None, "source_action": source_action,
        "source_fps": source_fps if args.fbx else None, "source_duration": duration, "output_fps": 30,
        "output_frames": frames + 1 if args.fbx else 0, "leg_length_ratio": factor,
        "horizontal_drift_removed_m": list(drift * factor) if args.fbx else None,
        "floor_correction_range_m": [min(corrections), max(corrections)] if corrections else None,
        "method": "Transfer world rotation changes to the target rest pose. Preserve the target bone lengths." if args.fbx else "Package actions on the target rig.",
        "status": "Single-clip motion test. No approval for game integration.",
    }
    (args.out / "retarget.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print("RETARGET", json.dumps(metadata), flush=True)


if __name__ == "__main__":
    main()
