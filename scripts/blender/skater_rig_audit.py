"""Measure separation between nearby parts through the exported clips."""
import argparse
import collections
import json
import math
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


def activate(arm, action):
    arm.animation_data_create()
    arm.animation_data.action = None
    for track in arm.animation_data.nla_tracks:
        track.mute = True
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    arm.animation_data.action = action
    if action and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    bpy.context.view_layer.update()


def audit(path, all_clips=False, clips=None, check_deformation=False):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    if path.endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.context.scene.objects
                if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    activate(arm, None)
    rest = [mesh.matrix_world @ v.co for v in mesh.data.vertices]
    material = {}
    for p in mesh.data.polygons:
        for vi in p.vertices:
            material[vi] = p.material_index
    tree = KDTree(len(rest))
    for i, co in enumerate(rest):
        tree.insert(co, i)
    tree.balance()
    pairs = set()
    for i, co in enumerate(rest):
        for _, j, distance in tree.find_range(co, 0.008):
            if j > i and material.get(i) != material.get(j):
                pairs.add((i, j))
    assert pairs, "No adjacent parts found; this check cannot assess separation."
    strain_edges = {}
    if check_deformation:
        rest_array = np.array(rest)
        for number in (1, 3, 4, 6, 8):
            name = f"tripo_part_{number}_material"
            index = next(i for i, slot in enumerate(mesh.material_slots) if slot.name == name)
            edges = np.array(sorted({tuple(sorted(edge)) for polygon in mesh.data.polygons
                                    if polygon.material_index == index for edge in polygon.edge_keys}))
            lengths = np.linalg.norm(rest_array[edges[:, 0]] - rest_array[edges[:, 1]], axis=1)
            keep = lengths > .003
            assert keep.sum() > 0, f"No measurable edges in {name}"
            strain_edges[name] = (edges[keep], lengths[keep])
    stats = {}
    for idx, slot in enumerate(mesh.material_slots):
        vertices = [v for v in mesh.data.vertices if material.get(v.index) == idx]
        counts = collections.Counter()
        influences = collections.Counter()
        for v in vertices:
            groups = [g for g in v.groups if g.weight > 0.01]
            influences[len(groups)] += 1
            for g in groups:
                counts[mesh.vertex_groups[g.group].name] += g.weight
        stats[slot.name] = {"vertices": len(vertices), "influences": dict(influences),
                            "top_bones": counts.most_common(3)}
    worst = []
    foot_steps = {}
    deformation = {}
    names = sorted(a.name for a in bpy.data.actions) if all_clips else clips or [
        "coast", "bail", "air_japan", "dance_bankhead"]
    assert "coast" in names, "Include coast for the foot-motion check."
    if all_clips:
        assert len(names) == 24, f"Expected 24 clips, got {len(names)}"
    for name in names:
        action = bpy.data.actions.get(name)
        assert action, f"Missing {name}"
        activate(arm, action)
        previous = {}
        max_steps = collections.defaultdict(float)
        strain_stats = {part: {"edges": len(edges), "max_ratio": 0, "min_ratio": math.inf,
                              "max_p99": 0, "min_p01": math.inf}
                        for part, (edges, _) in strain_edges.items()}
        max_twist, sampled_frames = 0, 0
        for frame in range(int(action.frame_range[0]), int(action.frame_range[1]) + 1):
            bpy.context.scene.frame_set(frame)
            for side in ("Left", "Right"):
                q = arm.pose.bones["mixamorig:" + side + "Foot"].matrix.to_quaternion()
                if side in previous:
                    angle = 2 * math.acos(min(1.0, abs(q.dot(previous[side]))))
                    max_steps[side] = max(max_steps[side], math.degrees(angle))
                previous[side] = q.copy()
            if frame % 6 and not check_deformation:
                continue
            ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            points = [ev.matrix_world @ v.co for v in ev.data.vertices]
            assert len(points) == len(rest)
            if check_deformation:
                sampled_frames += 1
                posed = np.array(points)
                for part, (edges, lengths) in strain_edges.items():
                    ratios = np.linalg.norm(posed[edges[:, 0]] - posed[edges[:, 1]], axis=1) / lengths
                    record = strain_stats[part]
                    record["max_ratio"] = max(record["max_ratio"], float(ratios.max()))
                    record["min_ratio"] = min(record["min_ratio"], float(ratios.min()))
                    record["max_p99"] = max(record["max_p99"], float(np.percentile(ratios, 99)))
                    record["min_p01"] = min(record["min_p01"], float(np.percentile(ratios, 1)))
                for side in ("Left", "Right"):
                    for part in ("UpLeg", "Leg"):
                        bone = arm.pose.bones["mixamorig:" + side + part]
                        axis = (bone.bone.tail_local - bone.bone.head_local).normalized()
                        swing = axis.rotation_difference((bone.tail - bone.head).normalized())
                        delta = bone.matrix.to_quaternion() @ bone.bone.matrix_local.to_quaternion().inverted()
                        twist = swing.inverted() @ delta
                        angle = math.degrees(2 * math.atan2(
                            Vector((twist.x, twist.y, twist.z)).dot(axis), twist.w))
                        max_twist = max(max_twist, abs((angle + 180) % 360 - 180))
            if frame % 6:
                continue
            values = sorted(((points[i] - points[j]).length - (rest[i] - rest[j]).length,
                             i, j) for i, j in pairs)
            gap, i, j = values[-1]
            worst.append({"clip": name, "frame": frame, "increase_m": round(gap, 5),
                          "parts": [mesh.material_slots[material[k]].name for k in (i, j)]})
        foot_steps[name] = dict(max_steps)
        if check_deformation:
            assert sampled_frames == int(action.frame_range[1]) - int(action.frame_range[0]) + 1
            deformation[name] = {"frames": sampled_frames, "parts": strain_stats,
                                 "max_axial_twist_degrees": max_twist,
                                 "strain_pass": all(p["max_p99"] <= 1.25 for p in strain_stats.values()),
                                 "twist_pass": max_twist <= 20}
    worst.sort(key=lambda x: x["increase_m"], reverse=True)
    return {"source": path, "fps": bpy.context.scene.render.fps, "deformation": deformation,
            "adjacent_pairs": len(pairs), "weights": stats,
            "clips_checked": len(names),
            "worst_separation": worst[:12], "foot_max_step_degrees": foot_steps,
            "separation_pass": worst[0]["increase_m"] < 0.025,
            "coast_foot_motion_pass": max(foot_steps["coast"].values()) < 15}


if __name__ == "__main__":
    if not bpy.app.background:
        raise RuntimeError("Run with blender -b. This script replaces the process scene.")
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--report", required=True)
    parser.add_argument("--all-clips", action="store_true")
    parser.add_argument("--clips", nargs="+")
    parser.add_argument("--check-deformation", action="store_true",
                        help="Check Marcus's shorts, boot cuffs, ankles, and leg twist.")
    a = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    result = audit(a.source, a.all_clips, a.clips, a.check_deformation)
    with open(a.report, "w") as f:
        json.dump(result, f, indent=2)
    print(json.dumps({k: v for k, v in result.items() if k != "weights"}, indent=2))
    if not result["separation_pass"]:
        raise RuntimeError("Adjacent parts separate by more than 25 mm.")
    if not result["coast_foot_motion_pass"]:
        raise RuntimeError("A foot turns more than 15 degrees per frame during coast.")
    if any(not clip["strain_pass"] or not clip["twist_pass"] for clip in result["deformation"].values()):
        raise RuntimeError("The forward motion fails the cloth or leg-twist check.")
