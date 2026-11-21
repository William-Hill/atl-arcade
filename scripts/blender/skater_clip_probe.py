"""Mesh clipping probe for the skater clips, with limb capsules.

Each limb is a capsule around its bone segment, and each skate is a box in
the frame of its foot bone (a skate is a box, not a tube). The radius is the 70th
percentile (the median for the thighs and forearms, which wear cloth) of the distance from the limb's own vertices (skin weight more
than 0.5) to the segment, in the rest pose, so a loose sleeve or a knee pad
does not make the capsule too fat. Two capsules clip when the distance
between their segments is less than the sum of the radii; the overlap is the
depth. The thigh capsules start 30% down the thigh, because the inner thighs
touch at the top in a normal body.

The pairs are limbs that must not go through each other: the legs, the
skates, the hands and forearms against the thighs, and the hands against the
torso. Joined limbs (a thigh and its own shin) are not tested.

Run:
  blender -b --factory-startup -P scripts/blender/skater_clip_probe.py -- \
    --in assets/skaters/marcus/skater.glb [--clips push,coast] [--json out.json]
"""
import argparse
import json
import os
import sys

import numpy as np

P = "mixamorig:"
DEPTH_LIMIT = 0.01  # m: less than this is skin contact, not a visible clip
# part: (bone at the start, bone at the end, start along the segment)
CAPSULES = {
    "l_thigh": ("LeftUpLeg", "LeftLeg", 0.3), "r_thigh": ("RightUpLeg", "RightLeg", 0.3),
    "l_shin": ("LeftLeg", "LeftFoot", 0.0), "r_shin": ("RightLeg", "RightFoot", 0.0),
    "l_skate": ("LeftFoot", "LeftToe_End", 0.0), "r_skate": ("RightFoot", "RightToe_End", 0.0),
    "l_forearm": ("LeftForeArm", "LeftHand", 0.0), "r_forearm": ("RightForeArm", "RightHand", 0.0),
    "l_hand": ("LeftHand", "LeftHandMiddle1", 0.0), "r_hand": ("RightHand", "RightHandMiddle1", 0.0),
    "torso": ("Hips", "Spine2", 0.0),
    # The knees (with the knee pads) as spheres at the knee joint.
    "l_knee": ("LeftLeg", "LeftLeg", 0.0), "r_knee": ("RightLeg", "RightLeg", 0.0),
}
KNEE_REACH = 0.12  # m: the mesh within this distance of the knee joint is the knee
WEIGHT_BONES = {
    "l_thigh": ["LeftUpLeg"], "r_thigh": ["RightUpLeg"], "l_shin": ["LeftLeg"], "r_shin": ["RightLeg"],
    "l_skate": ["LeftFoot", "LeftToeBase", "LeftToe_End"], "r_skate": ["RightFoot", "RightToeBase", "RightToe_End"],
    "l_forearm": ["LeftForeArm"], "r_forearm": ["RightForeArm"],
    "l_hand": ["LeftHand"], "r_hand": ["RightHand"], "torso": ["Hips", "Spine", "Spine1"],
    "l_knee": ["LeftUpLeg", "LeftLeg"], "r_knee": ["RightUpLeg", "RightLeg"],
}
# Thigh against thigh is not a pair: the inner thighs touch in a normal body.
PAIRS = [
    ("l_shin", "r_shin"), ("l_thigh", "r_shin"), ("r_thigh", "l_shin"),
    ("l_skate", "r_skate"), ("l_skate", "r_shin"), ("r_skate", "l_shin"),
    ("l_hand", "l_thigh"), ("r_hand", "r_thigh"), ("l_forearm", "l_thigh"), ("r_forearm", "r_thigh"),
    ("l_hand", "torso"), ("r_hand", "torso"),
    ("l_knee", "r_knee"), ("l_knee", "r_shin"), ("r_knee", "l_shin"), ("l_knee", "r_thigh"), ("r_knee", "l_thigh"),
    ("l_hand", "l_knee"), ("r_hand", "r_knee"),
]


def seg_dist(p1, q1, p2, q2):
    d1, d2, r = q1 - p1, q2 - p2, p1 - p2
    a, e, f = d1.dot(d1), d2.dot(d2), d2.dot(r)
    c, b = d1.dot(r), d1.dot(d2)
    denom = a * e - b * b
    s = min(max((b * f - c * e) / denom, 0.0), 1.0) if denom > 1e-12 else 0.0
    t = (b * s + f) / e if e > 1e-12 else 0.0
    if t < 0:
        t, s = 0.0, (min(max(-c / a, 0.0), 1.0) if a > 1e-12 else 0.0)
    elif t > 1:
        t, s = 1.0, (min(max((b - c) / a, 0.0), 1.0) if a > 1e-12 else 0.0)
    return float(np.linalg.norm((p1 + d1 * s) - (p2 + d2 * t)))


def _point_seg(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


SKATES = {"l_skate": "LeftFoot", "r_skate": "RightFoot"}


def skate_boxes(arm, mesh):
    """Each skate as a box in the rest frame of its foot bone: (min, max)."""
    out = {}
    for part, bone in SKATES.items():
        names = {P + x for x in WEIGHT_BONES[part]}
        idx = {g.index for g in mesh.vertex_groups if g.name in names}
        sel = [v.co for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in idx) > 0.5]
        if not sel:
            continue
        inv = arm.data.bones[P + bone].matrix_local.inverted() @ arm.matrix_world.inverted() @ mesh.matrix_world
        loc = np.array([list(inv @ c) for c in sel])
        # The 2nd and 98th percentiles, so a stray vertex does not grow the box.
        out[part] = (np.percentile(loc, 2, axis=0), np.percentile(loc, 98, axis=0))
    return out


def _box(mats, part, box):
    M = mats[P + SKATES[part]]
    R = np.array(M.to_3x3())
    lo, hi = box
    c = np.array(M @ __import__("mathutils").Vector(((lo + hi) / 2).tolist()))
    return c, R, (hi - lo) / 2


def box_overlap(b1, b2):
    """Penetration depth of two oriented boxes (separating-axis test); <= 0 = apart."""
    c1, R1, h1 = b1
    c2, R2, h2 = b2
    axes = [R1[:, i] for i in range(3)] + [R2[:, i] for i in range(3)]
    axes += [np.cross(R1[:, i], R2[:, j]) for i in range(3) for j in range(3)]
    best = 1e9
    d = c2 - c1
    for ax in axes:
        n = np.linalg.norm(ax)
        if n < 1e-6:
            continue
        ax = ax / n
        r1 = sum(h1[i] * abs(R1[:, i] @ ax) for i in range(3))
        r2 = sum(h2[i] * abs(R2[:, i] @ ax) for i in range(3))
        best = min(best, r1 + r2 - abs(d @ ax))
    return best


def point_box(p, b):
    c, R, h = b
    q = R.T @ (p - c)
    return float(np.linalg.norm(np.maximum(np.abs(q) - h, 0)))


def capsule_radii(arm, mesh):
    """The radius of each capsule, from the rest mesh."""
    bones = arm.data.bones
    co = np.array([list(mesh.matrix_world @ v.co) for v in mesh.data.vertices])
    out = {}
    for part, (b0, b1, start) in CAPSULES.items():
        a = np.array(bones[P + b0].head_local)
        b = np.array(bones[P + b1].head_local) if P + b1 in bones else np.array(bones[P + b0].tail_local)
        a = a + (b - a) * start
        names = {P + x for x in WEIGHT_BONES[part]}
        idx = {g.index for g in mesh.vertex_groups if g.name in names}
        sel = [v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in idx) > 0.5]
        pts = co[sel] if sel else np.zeros((0, 3))
        if part.endswith("knee") and len(pts):
            pts = pts[np.linalg.norm(pts - a, axis=1) < KNEE_REACH]
        d = _point_seg(pts, a, b) if len(pts) else np.array([0.03])
        # Cloth (baggy pants, sleeves) makes the thigh and forearm meshes wide,
        # so those capsules use the median: the body is inside the cloth.
        out[part] = float(np.percentile(d, 50 if part.endswith(("thigh", "forearm")) else 70))
    return out


def capsule_segments(arm, mats):
    """mats: bone name -> armature-space matrix. Returns part -> (a, b)."""
    bones = arm.data.bones
    out = {}
    for part, (b0, b1, start) in CAPSULES.items():
        a = np.array(mats[P + b0].to_translation())
        if P + b1 in mats:
            b = np.array(mats[P + b1].to_translation())
        else:
            from mathutils import Vector
            b = np.array(mats[P + b0] @ Vector((0, bones[P + b0].length, 0)))
        out[part] = (a + (b - a) * start, b)
    return out


def overlaps(arm, radii, mats, boxes=None):
    seg = capsule_segments(arm, mats)
    out = {}
    for x, y in PAIRS:
        if boxes and x in boxes and y in boxes:
            out[f"{x}>{y}"] = box_overlap(_box(mats, x, boxes[x]), _box(mats, y, boxes[y]))
        elif boxes and x in boxes:
            b = _box(mats, x, boxes[x])
            a, e = seg[y]
            out[f"{x}>{y}"] = radii[y] - min(point_box(a + (e - a) * t, b) for t in np.linspace(0, 1, 9))
        else:
            out[f"{x}>{y}"] = radii[x] + radii[y] - seg_dist(*seg[x], *seg[y])
    return out


def probe_action(arm, radii, action, boxes=None):
    import bpy
    pb = arm.pose.bones
    for b in pb:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    n = int(round(action.frame_range[1]))
    res = {f"{x}>{y}": {"max_depth_m": 0.0, "frames": []} for x, y in PAIRS}
    for f in range(n):
        bpy.context.scene.frame_set(f)
        o = overlaps(arm, radii, {b.name: b.matrix.copy() for b in pb}, boxes)
        for k, d in o.items():
            res[k]["max_depth_m"] = round(max(res[k]["max_depth_m"], d), 4)
            if d > DEPTH_LIMIT:
                res[k]["frames"].append(f)
    return {k: v for k, v in res.items() if v["max_depth_m"] > 0}


def summary(res):
    bad = {k: v for k, v in res.items() if v["frames"]}
    return "; ".join(f"{k} {v['max_depth_m'] * 100:.1f} cm on {len(v['frames'])} frames" for k, v in bad.items()) or "no clip over 1 cm"


def main():
    import bpy
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--clips", default="push,coast,carve_left,carve_right")
    p.add_argument("--json", default="")
    a = p.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    radii = {}
    for m in meshes:
        for k, v in capsule_radii(arm, m).items():
            radii[k] = max(radii.get(k, 0.0), v)
    boxes = {}
    for m in meshes:
        for k, v in skate_boxes(arm, m).items():
            if k not in boxes:
                boxes[k] = v
            else:
                boxes[k] = (np.minimum(boxes[k][0], v[0]), np.maximum(boxes[k][1], v[1]))
    print("[clip-probe] skate boxes " + ", ".join(f"{k} {np.round((v[1] - v[0]) * 100, 1).tolist()} cm" for k, v in boxes.items()))
    print("[clip-probe] radii " + ", ".join(f"{k} {v * 100:.1f} cm" for k, v in radii.items()))
    report = {"radii_m": radii, "skate_box_m": {k: [v[0].tolist(), v[1].tolist()] for k, v in boxes.items()}, "clips": {}}
    for name in [c for c in a.clips.split(",") if c]:
        act = bpy.data.actions.get(name)
        if not act:
            continue
        res = probe_action(arm, radii, act, boxes)
        report["clips"][name] = res
        print(f"[clip-probe] {name:12s} {summary(res)}")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(report, f, indent=1)


if __name__ == "__main__":
    main()
