"""Build forward strides and a coast pose from the repaired skaters."""
import argparse
from datetime import date
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
from skater_repair import reset, smooth
from skater_motion_retarget import sole_points


def ease(t):
    t = max(0, min(1, t))
    return t * t * (3 - 2 * t)


def lengthen_nia_arms(arm, mesh):
    """Increase the arm lengths. Keep the hands and the torso height."""
    maps = {}
    before = {}
    for side, sign in (("Left", 1), ("Right", -1)):
        joints = [arm.data.bones["mixamorig:" + side + part].head_local.copy()
                  for part in ("Arm", "ForeArm", "Hand")]
        a, b, c = joints
        upper = math.sqrt(.26 ** 2 - (b.y - a.y) ** 2 - (b.z - a.z) ** 2)
        lower = math.sqrt(.23 ** 2 - (c.y - b.y) ** 2 - (c.z - b.z) ** 2)
        old = [sign * p.x for p in joints]
        new = [old[0], old[0] + upper, old[0] + upper + lower]
        maps[sign] = (old, new, a.z)
        before[side] = [(b - a).length, (c - b).length]

    def warp(point):
        point = point.copy()
        sign = 1 if point.x >= 0 else -1
        old, new, shoulder_z = maps[sign]
        x = sign * point.x
        if x <= old[0]:
            return point
        if x < old[1]:
            mapped = new[0] + (x - old[0]) * (new[1] - new[0]) / (old[1] - old[0])
        elif x < old[2]:
            mapped = new[1] + (x - old[1]) * (new[2] - new[1]) / (old[2] - old[1])
        else:
            mapped = x + new[2] - old[2]
        blend = ease((point.z - (shoulder_z - .22)) / .12)
        point.x += sign * (mapped - x) * blend
        return point

    for vertex in mesh.data.vertices:
        vertex.co = warp(vertex.co)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    rest = {b.name: (b.head.copy(), b.tail.copy(), b.z_axis.copy()) for b in arm.data.edit_bones}
    for bone in arm.data.edit_bones:
        head, tail, roll_axis = rest[bone.name]
        bone.head, bone.tail = warp(head), warp(tail)
        bone.align_roll(roll_axis)
    bpy.ops.object.mode_set(mode="OBJECT")
    points = [v.co for v in mesh.data.vertices]
    ratio = (max(p.x for p in points) - min(p.x for p in points)) / (
        max(p.z for p in points) - min(p.z for p in points))
    assert .85 <= ratio <= .98, f"Unexpected arm proportion: {ratio}"
    return {"before_lengths_m": before, "target_upper_m": .26,
            "target_forearm_m": .23, "span_height_ratio": ratio}


def fit_marcus_knees(arm):
    """Keep each knee in the forward bend plane."""
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    changes = {}
    for side in ("Left", "Right"):
        upper, lower, foot = [arm.data.edit_bones["mixamorig:" + side + part]
                              for part in ("UpLeg", "Leg", "Foot")]
        hip_before = upper.head.copy()
        upper.head.z -= .08
        hip, knee, ankle = upper.head.copy(), lower.head.copy(), foot.head.copy()
        axis = ankle - hip
        fraction = (knee - hip).dot(axis) / axis.length_squared
        direction = axis.normalized()
        front = Vector((0, -1, 0))
        front = (front - direction * front.dot(direction)).normalized()
        corrected = hip + fraction * axis + front * .008
        upper.tail = corrected
        lower.head = corrected
        changes[side] = {"before": list(knee), "after": list(corrected),
                         "hip_before": list(hip_before), "hip_after": list(hip)}
    bpy.ops.object.mode_set(mode="OBJECT")
    return changes


def repair_marcus_weights(mesh, shorts_path=None):
    """Spread the ankle bend through the boot cuff and lower calf."""
    ankle_vertices = 0
    for vertex in mesh.data.vertices:
        if vertex.co.z > .48:
            continue
        side = "Left" if vertex.co.x > 0 else "Right"
        shin = smooth(.16, .48, vertex.co.z)
        for index in [group.group for group in vertex.groups]:
            mesh.vertex_groups[index].remove([vertex.index])
        for name, weight in ((side + "Foot", 1 - shin), (side + "Leg", shin)):
            if weight > 1e-6:
                mesh.vertex_groups["mixamorig:" + name].add([vertex.index], weight, "REPLACE")
        ankle_vertices += 1
    report = {"ankle_vertices": ankle_vertices, "ankle_transition_m": [.16, .48]}
    if shorts_path:
        data = np.load(shorts_path, allow_pickle=False)
        points, weights, names = data["positions"], data["weights"], data["bone_names"]
        assert points.shape == weights.shape and points.shape[1] == 3
        assert np.isfinite(points).all() and np.isfinite(weights).all()
        assert weights.min() >= -1e-8 and np.allclose(weights.sum(axis=1), 1)
        assert list(names) == ["Hips", "LeftUpLeg", "RightUpLeg"]
        tree = KDTree(len(points))
        for i, point in enumerate(points):
            tree.insert(point, i)
        tree.balance()
        slot = next(i for i, s in enumerate(mesh.material_slots) if s.name == "tripo_part_1_material")
        indices = {i for p in mesh.data.polygons if p.material_index == slot for i in p.vertices}
        assert indices
        for i in indices:
            vertex = mesh.data.vertices[i]
            _, reference, distance = tree.find(vertex.co)
            assert distance < .0003, "The weight file does not match this mesh."
            for group in [g.group for g in vertex.groups]:
                mesh.vertex_groups[group].remove([i])
            for name, weight in zip(names, weights[reference]):
                if weight > 1e-6:
                    mesh.vertex_groups["mixamorig:" + name].add([i], float(weight), "REPLACE")
        report["shorts"] = {"source": str(shorts_path.resolve()), "vertices": len(indices),
                            "sha256": hashlib.sha256(shorts_path.read_bytes()).hexdigest()}
    return report


def main():
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", choices=("nia", "marcus"), required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--shorts-weights", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    version = "v4" if args.name == "nia" else "v6"
    source = ROOT / "assets/skaters" / args.name / "raw" / ("review-" + version) / (args.name + "-review.blend")
    bpy.ops.wm.open_mainfile(filepath=str(source))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH"
                and any(m.type == "ARMATURE" for m in o.modifiers))
    reset(arm)
    assert all(abs(arm.matrix_world[i][j] - Matrix.Identity(4)[i][j]) < 1e-5
               for i in range(4) for j in range(4))
    assert all(abs(mesh.matrix_world[i][j] - Matrix.Identity(4)[i][j]) < 1e-5
               for i in range(4) for j in range(4))
    arm_report = lengthen_nia_arms(arm, mesh) if args.name == "nia" else None
    knee_report = fit_marcus_knees(arm) if args.name == "marcus" else None
    weight_report = repair_marcus_weights(mesh, args.shorts_weights) if args.name == "marcus" else None
    scope = {"__name__": "forward_motion", "SKATER_CFG": {
        "arm": arm.name, "mesh": mesh.name, "continuous_foot_rotation": True}}
    exec(compile((HERE / "nia_clips.py").read_text(), "nia_clips.py", "exec"), scope)
    soles = sole_points(arm, mesh)
    root = arm.data.bones["mixamorig:Hips"].head_local.copy()
    legs = {}
    for side, full, sign in (("L", "Left", 1), ("R", "Right", -1)):
        thigh, shin, foot = [arm.data.bones["mixamorig:" + full + part]
                            for part in ("UpLeg", "Leg", "Foot")]
        legs[side] = {
            "name": foot.name, "sign": sign, "hip_offset": thigh.head_local - root,
            "length": (shin.head_local - thigh.head_local).length + (foot.head_local - shin.head_local).length,
            "rest": foot.matrix_local.copy(),
        }
    half_width = max(.13, *(abs(v["hip_offset"].x) + .035 for v in legs.values()))
    nia = args.name == "nia"
    frames = 60 if nia else 48
    angles = {}

    def pose_at(frame, pushing):
        t = (frame / frames + (0 if nia else .5)) % 1
        half = 0 if t < .5 else 1
        support = (1 if half == 0 else -1) * (1 - 2 * ease((t % .5) / .12))
        if not pushing:
            support = .25 * math.sin(2 * math.pi * t)
        hip_x = (half_width - .035) * support
        hip_y = root.y - (.025 if pushing else .012)
        feet = {}
        targets = {}
        for side, leg in legs.items():
            p = (t + (0 if side == "L" else .5)) % 1
            sign = leg["sign"]
            outward = .16 if nia else .145
            back = .15 if nia else .20
            lift = 0
            if pushing and p < .32:
                q = ease(p / .32)
                x, y, yaw = sign * (half_width + outward * q), back * q, sign * 15 * q
            elif pushing and p < .5:
                q = (p - .32) / .18
                x = sign * (half_width + outward * (1 - ease(q)))
                y = back + (-.075 - back) * ease(q)
                lift = (.065 if nia else .08) * math.sin(math.pi * q) ** 2
                yaw = sign * (15 - 13 * ease(q))
            elif pushing:
                q = ease((p - .5) / .5)
                x, y, yaw = sign * half_width, -.075 * (1 - q), sign * 2 * (1 - q)
            else:
                x = sign * half_width
                y = -.06 if (side == "L") == nia else .04
                yaw = sign * 3
            rotation = Matrix.Rotation(math.radians(yaw), 4, "Z") @ leg["rest"].to_quaternion().to_matrix().to_4x4()
            z = lift - min((rotation @ point).z for point in soles[leg["name"]])
            targets[side] = Vector((x, y, z))
            feet[side] = {
                "pos": targets[side] - leg["rest"].translation,
                "rot": [(scope["UP"], yaw)],
            }
        base = min(targets[s].z + leg["length"] * (.90 if pushing else .95) - leg["hip_offset"].z
                   for s, leg in legs.items())
        hip_z = base
        for side, leg in legs.items():
            dx = targets[side].x - hip_x - leg["hip_offset"].x
            dy = targets[side].y - hip_y - leg["hip_offset"].y
            available = (leg["length"] * .985) ** 2 - dx * dx - dy * dy
            assert available > 0
            hip_z = min(hip_z, targets[side].z + math.sqrt(available) - leg["hip_offset"].z)
        rhythm = math.sin(2 * math.pi * t)
        swing = rhythm * (26 if nia else 20) if pushing else 0
        lean = (10 if nia else 16) if pushing else (6 if nia else 10)
        if nia and pushing:
            lean += 2 * math.sin(4 * math.pi * t - math.pi / 3)
        torso_turn = -9 * rhythm if nia and pushing else 0
        left_elbow = 40 + 12 * rhythm if nia and pushing else 30 if nia else 48
        right_elbow = 40 - 12 * rhythm if nia and pushing else 30 if nia else 48
        pose = {
            "hips": (hip_x - root.x, hip_y - root.y, hip_z - root.z),
            "Spine": [(scope["LEFT"], lean), (scope["FWD"], -(5 if nia else 3) * support)],
            "Spine1": [(scope["UP"], torso_turn * 2 / 3 if nia else 3 * rhythm if pushing else 0)],
            "Spine2": [(scope["UP"], torso_turn / 3)],
            "Neck": [(scope["LEFT"], -lean * .4), (scope["UP"], -torso_turn * .5)],
            "Head": [(scope["LEFT"], -lean * .3), (scope["UP"], -torso_turn * .35)],
            "L": feet["L"], "R": feet["R"],
            "LeftArm": [(scope["FWD"], -76), (scope["LEFT"], -swing)],
            "RightArm": [(scope["FWD"], 76), (scope["LEFT"], swing)],
            "LeftForeArm": [(scope["UP"], -left_elbow)],
            "RightForeArm": [(scope["UP"], right_elbow)],
            "LeftHand": [(scope["UP"], -5)],
            "RightHand": [(scope["UP"], 5)],
        }
        pose.update(scope["_relaxed_hands"]())
        return pose

    original_apply = scope["apply_pose"]
    original_setup = scope["setup_ik"]

    def apply_pose(target, ik, pose, frame):
        original_apply(target, ik, pose, frame)
        for side in ("L", "R"):
            pole = ik[side][1]
            knee = ik[side][3] - Vector((0, -.6, 0))
            yaw = pose[side]["rot"][0][1]
            pole.location = knee + Vector(pose["hips"]) + Matrix.Rotation(
                math.radians(yaw), 3, "Z") @ Vector((0, -.6, 0))
            pole.keyframe_insert("location", frame=frame)

    def setup_ik(target):
        ik = original_setup(target)
        apply_pose(target, ik, pose_at(0, False), 0)
        for side, full in (("L", "Left"), ("R", "Right")):
            constraint = next(c for c in target.pose.bones["mixamorig:" + full + "Leg"].constraints if c.type == "IK")
            best = (float("inf"), 0)
            for degree in range(-180, 181, 2):
                constraint.pole_angle = math.radians(degree)
                bpy.context.view_layer.update()
                hip, knee, ankle = [target.pose.bones["mixamorig:" + full + part].head
                                    for part in ("UpLeg", "Leg", "Foot")]
                axis = (ankle - hip).normalized()
                bend = knee - hip - axis * (knee - hip).dot(axis)
                forward = Vector((0, -1, 0))
                forward -= axis * forward.dot(axis)
                score = bend.angle(forward)
                best = min(best, (score, degree))
            constraint.pole_angle = math.radians(best[1])
            angles[side] = best[1]
        target.animation_data_clear()
        for values in ik.values():
            values[0].animation_data_clear()
            values[1].animation_data_clear()
        for action in list(bpy.data.actions):
            bpy.data.actions.remove(action)
        return ik

    scope["apply_pose"] = apply_pose
    scope["setup_ik"] = setup_ik
    scope["CLIPS"] = {
        "coast": lambda: (True, [(f, pose_at(f, False)) for f in range(frames + 1)]),
        "push": lambda: (True, [(f, pose_at(f, True)) for f in range(frames + 1)]),
    }
    scope["build_all"]()
    scope["prune_static_channels"]()
    args.out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(args.out / (args.name + "-forward.blend")))
    scope["export"](str(args.out / (args.name + "-forward.glb")), True,
                    export_image_format="JPEG", export_jpeg_quality=88)
    report = {"name": args.name, "source": str(source), "arm_change": arm_report,
              "knee_change": knee_report,
              "weight_change": weight_report,
              "tool": "Blender Python", "date": date.today().isoformat(),
              "prompt": "Create distinct forward strides and coast poses. Correct Nia's short arms.",
              "pole_angles": angles, "half_stance_m": half_width,
              "cycle_frames": frames, "fps": 30, "clips": ["coast", "push"],
              "reference": "https://www.youtube.com/watch?v=aNGNDFPs8O4",
              "method": "Author the push, skate recovery, weight transfer, and coast as separate phases.",
              "credits": 0, "status": "Review candidate"}
    (args.out / "provenance.json").write_text(json.dumps(report, indent=2) + "\n")
    print("FORWARD_BUILD", json.dumps(report), flush=True)


if __name__ == "__main__":
    main()
