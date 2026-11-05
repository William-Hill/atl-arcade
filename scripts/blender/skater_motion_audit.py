"""Check knee direction and knee clearance in exported motion."""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).parent))
from skater_rig_audit import activate
from skater_motion_retarget import sole_points


def audit(source, clips, check_arms=False, check_support=False):
    if check_support:
        assert "push" in clips, "Include push for the support check."
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(source))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    activate(arm, None)
    soles = None
    if check_support:
        mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH"
                    and any(m.type == "ARMATURE" for m in o.modifiers))
        soles = sole_points(arm, mesh)
    proportions = None
    if check_arms:
        activate(arm, None)
        mesh = next(o for o in bpy.context.scene.objects if o.type == "MESH"
                    and any(m.type == "ARMATURE" for m in o.modifiers))
        points = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
        height = max(p.z for p in points) - min(p.z for p in points)
        span = max(p.x for p in points) - min(p.x for p in points)
        lengths = {}
        for side in ("Left", "Right"):
            joints = [arm.matrix_world @ arm.data.bones["mixamorig:" + side + part].head_local
                      for part in ("Arm", "ForeArm", "Hand")]
            lengths[side] = [(b - a).length for a, b in zip(joints, joints[1:])]
        proportions = {"height_m": height, "span_m": span, "arm_lengths_m": lengths,
                       "pass": span / height >= .85 and all(sum(v) / height >= .26 for v in lengths.values())}
    reports = {}
    for name in clips:
        action = bpy.data.actions.get(name)
        assert action, f"Missing clip: {name}"
        activate(arm, action)
        start, end = map(int, action.frame_range)
        assert end > start, f"No motion frames: {name}"
        angles = []
        clearances = []
        observations = 0
        support_offsets = []
        endpoints = []
        root_endpoints = []
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            if frame in (start, end):
                endpoints.append({
                    b.name: (arm.matrix_world @ b.matrix).to_quaternion()
                    for b in arm.pose.bones
                })
                root_endpoints.append(arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head)
            if soles and name == "push":
                heights = {
                    bone: min((arm.matrix_world @ arm.pose.bones[bone].matrix @ p).z for p in points)
                    for bone, points in soles.items()
                }
                for side, other in (("Left", "Right"), ("Right", "Left")):
                    supporting = "mixamorig:" + side + "Foot"
                    recovering = "mixamorig:" + other + "Foot"
                    if heights[supporting] < .005 and heights[recovering] > .015:
                        hip = arm.matrix_world @ arm.pose.bones["mixamorig:Hips"].head
                        ankle = arm.matrix_world @ arm.pose.bones[supporting].head
                        support_offsets.append(abs(hip.x - ankle.x))
            knees = []
            for side in ("Left", "Right"):
                hip = arm.pose.bones["mixamorig:" + side + "UpLeg"].head
                knee = arm.pose.bones["mixamorig:" + side + "Leg"].head
                ankle = arm.pose.bones["mixamorig:" + side + "Foot"].head
                knees.append(arm.matrix_world @ knee)
                axis = (ankle - hip).normalized()
                bend = knee - hip - axis * (knee - hip).dot(axis)
                forward = Vector((0, -1, 0))
                forward -= axis * forward.dot(axis)
                if bend.length > .03 and forward.length > .1:
                    angles.append({"frame": frame, "side": side,
                                   "angle_degrees": math.degrees(bend.angle(forward))})
                observations += 1
            clearances.append({"frame": frame, "distance_m": (knees[0] - knees[1]).length})
        assert observations == 2 * (end - start + 1)
        assert {row["side"] for row in angles} == {"Left", "Right"}
        closest = min(clearances, key=lambda row: row["distance_m"])
        worst = max(angles, key=lambda row: row["angle_degrees"])
        reports[name] = {
            "observations": observations,
            "closest_knees": closest,
            "worst_bend": worst,
            "clearance_pass": closest["distance_m"] >= .1,
            "direction_pass": worst["angle_degrees"] <= 60,
        }
        if check_support:
            differences = [q.normalized().rotation_difference(endpoints[1][bone].normalized())
                           for bone, q in endpoints[0].items()]
            loop_angle = max(math.degrees(2 * math.atan2(Vector((q.x, q.y, q.z)).length, abs(q.w)))
                             for q in differences)
            root_distance = (root_endpoints[1] - root_endpoints[0]).length
            reports[name]["loop_max_angle_degrees"] = loop_angle
            reports[name]["loop_root_distance_m"] = root_distance
            reports[name]["loop_pass"] = loop_angle < .15 and root_distance < .001
            if name == "push":
                reports[name]["support_samples"] = len(support_offsets)
                reports[name]["support_hip_offset_m"] = max(support_offsets, default=None)
                reports[name]["support_pass"] = len(support_offsets) >= 8 and max(support_offsets) <= .06
    return {
        "source": str(source), "fps": 30, "clips": reports,
        "limits": {"minimum_knee_distance_m": .1, "maximum_forward_angle_degrees": 60},
        "arm_proportions": proportions,
        "pass": all(row["clearance_pass"] and row["direction_pass"] for row in reports.values())
                and (proportions is None or proportions["pass"])
                and all(row.get("support_pass", True) and row.get("loop_pass", True) for row in reports.values()),
        "scope": "Forward motion only. This check does not assess artistic quality or deliberate crossover tricks.",
    }


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--clips", nargs="+", default=["coast", "push", "bail"])
    parser.add_argument("--check-arms", action="store_true")
    parser.add_argument("--check-support", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    report = audit(args.source.resolve(), args.clips, args.check_arms, args.check_support)
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2), flush=True)
    assert report["pass"], "The knee check failed. See the report."


if __name__ == "__main__":
    main()
