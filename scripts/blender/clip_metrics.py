# Measures the leg poses of the skater clips (#290).
#
# For each clip and each 2nd frame, the script measures:
#   knee gap: the distance between the two knee joints (metres).
#   shin gap: the smallest distance between the left and the right shin
#     bones (knee joint to ankle joint).
#   mesh gap: the smallest distance between the left leg mesh and the right
#     leg mesh, from the mid thigh down to the ankle. Knees that touch give
#     a value near 0. Cross steps (coast, The Prep, Crisscross) pass one shin
#     close to the other on purpose.
#   knee mesh gap: the same, but only for the mesh within 0.10 m of each knee
#     joint. This is the "knees touch" check of #290.
#   skate z: the lowest point of each skate mesh above the ground (metres).
#     A value near 0 means that the wheels are on the ground.
# It prints one line per clip with the minimum and maximum values.
#
# Run (it keys the clips first, as scripts/blender/skater_reclip.py does):
#   blender -b --factory-startup -P scripts/blender/clip_metrics.py -- \
#     --in assets/skaters/nia/skater.glb [--clips idle,coast] [--json out.json]
import argparse
import json
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--clips", default="")
    p.add_argument("--json", default="")
    return p.parse_args(argv)


def seg_dist(p1, q1, p2, q2):
    # The smallest distance between two line segments.
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    denom = a * e - b * b
    s = min(max((b * f - c * e) / denom, 0.0), 1.0) if denom > 1e-12 else 0.0
    t = (b * s + f) / e
    if t < 0:
        t, s = 0.0, min(max(-c / a, 0.0), 1.0)
    elif t > 1:
        t, s = 1.0, min(max((b - c) / a, 0.0), 1.0)
    return ((p1 + d1 * s) - (p2 + d2 * t)).length


def skate_vertices(mesh, side):
    names = {f"mixamorig:{side}{b}" for b in ("Foot", "ToeBase", "Toe_End")}
    idx = {g.index for g in mesh.vertex_groups if g.name in names}
    out = []
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in idx)
        if w > 0.5:
            out.append(v.index)
    return np.array(out)


def leg_vertices(mesh, side):
    names = {f"mixamorig:{side}{b}" for b in ("UpLeg", "Leg")}
    idx = {g.index for g in mesh.vertex_groups if g.name in names}
    out = []
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if g.group in idx)
        if w > 0.5:
            out.append(v.index)
    return np.array(out)


def mesh_gap(a, b, zmax):
    a = a[a[:, 2] < zmax]
    b = b[b[:, 2] < zmax]
    if len(a) == 0 or len(b) == 0:
        return 9.0
    best = 9.0
    for chunk in np.array_split(a, max(1, len(a) // 500)):
        d = np.sqrt(((chunk[:, None, :] - b[None, :, :]) ** 2).sum(-1)).min()
        best = min(best, float(d))
    return best


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    left = arm.data.bones["mixamorig:LeftFoot"].head_local
    right = arm.data.bones["mixamorig:RightFoot"].head_local
    feet = (round(left.x, 3), round(right.x, 3), round((left.y + right.y) / 2, 3))
    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name, "feet": feet}}
    with open(os.path.join(HERE, "nia_clips.py")) as f:
        exec(compile(f.read(), "nia_clips.py", "exec"), g)
    names = [n for n in a.clips.split(",") if n] or list(g["CLIPS"])
    g["build_all"](names)
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    skate = {s: skate_vertices(mesh, s) for s in ("Left", "Right")}
    legs = {s: leg_vertices(mesh, s) for s in ("Left", "Right")}
    pb = arm.pose.bones
    report = {}
    for name in names:
        action = bpy.data.actions[name]
        arm.animation_data.action = action
        if hasattr(arm.animation_data, "action_slot") and action.slots:
            arm.animation_data.action_slot = action.slots[0]
        end = int(action.frame_range[1])
        rows = []
        for frame in range(0, end + 1, 2):
            bpy.context.scene.frame_set(frame)
            m = arm.matrix_world
            kl, kr = m @ pb["mixamorig:LeftLeg"].head, m @ pb["mixamorig:RightLeg"].head
            al, ar = m @ pb["mixamorig:LeftFoot"].head, m @ pb["mixamorig:RightFoot"].head
            ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            co = np.empty(len(ev.data.vertices) * 3)
            ev.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            z = {s: float(co[skate[s], 2].min()) for s in skate}
            # From the mid thigh down: the hip joint height minus 0.2 m.
            zmax = (m @ pb["mixamorig:LeftUpLeg"].head).z - 0.2
            gap = mesh_gap(co[legs["Left"]], co[legs["Right"]], zmax)
            ll, rr = co[legs["Left"]], co[legs["Right"]]
            ll = ll[np.linalg.norm(ll - np.array(kl), axis=1) < 0.10]
            rr = rr[np.linalg.norm(rr - np.array(kr), axis=1) < 0.10]
            kgap = mesh_gap(ll, rr, 9.0)
            rows.append({
                "frame": frame,
                "knee": (kl - kr).length,
                "leg": seg_dist(kl, al, kr, ar),
                "mesh": gap,
                "kneeMesh": kgap,
                "zl": z["Left"], "zr": z["Right"],
            })
        report[name] = rows
        kmin = min(r["knee"] for r in rows)
        lmin = min(r["leg"] for r in rows)
        gmin = min(r["mesh"] for r in rows)
        kgmin = min(r["kneeMesh"] for r in rows)
        zmin = min(min(r["zl"], r["zr"]) for r in rows)
        zmax = max(min(r["zl"], r["zr"]) for r in rows)
        print(f"[metrics] {name:18s} knee gap min {kmin:.3f}  shin gap min {lmin:.3f}  mesh gap min {gmin:.3f}  knee mesh gap min {kgmin:.3f}  lowest skate z {zmin:+.3f}..{zmax:+.3f}")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(report, f)


main()
