"""Joint-limit gate for the skater clips (Mixamo rig, 65 mixamorig: joints).

A port of the Crossroads gate `pipeline/joint_limit_gate.py` (#465) to the
Skate ATL rig. The angles come from world joint positions and world bone
rotations, so the gate does not depend on the bone rolls of the rig:

- pelvis frame: lateral = LeftUpLeg - RightUpLeg, up = Spine1 - Hips;
- chest frame: lateral = LeftArm - RightArm, up = Neck - Spine2.

Knee and elbow are hinges. The rest hinge axis comes from anatomy (a knee
bends the shin to the back, an elbow bends the forearm to the front) and turns
with the upper bone. For each frame the gate measures the signed bend
(negative = hyperextension) and, when the joint bends more than 25 degrees,
the angle between the bend plane and the hinge (a hinge cannot bend sideways).

Two levels, the same values as Crossroads:
  LIMITS      the edge of a trained athlete's range: WARN (look at it).
  IMPOSSIBLE  past what any body does: FAIL. An off-hinge value fails only
              when it holds for half of the frames or more.

Head yaw is not measured: the Mixamo rig has no face-front joint.

Run alone (all clips of one GLB):
  blender -b --factory-startup -P scripts/blender/skater_joint_limits.py -- \
    --in assets/skaters/nia/skater.glb [--clips push,coast] [--json out.json]
It exits 1 when a clip fails.

Control (the gate must catch broken poses):
  blender -b --factory-startup -P scripts/blender/skater_joint_limits.py -- \
    --in assets/skaters/nia/skater.glb --self-test
The rest pose and normal knee and elbow bends must PASS; a knee bent to the
side, a hyperextended knee and elbow, and a spine bent 130 degrees must FAIL.
"""
import argparse
import json
import math
import os
import sys

import numpy as np

P = "mixamorig:"
LIMITS = {
    "knee_flex_max_deg": 160.0, "knee_hyperextension_max_deg": 12.0, "knee_off_hinge_max_deg": 30.0,
    "elbow_flex_max_deg": 160.0, "elbow_hyperextension_max_deg": 15.0, "elbow_off_hinge_max_deg": 35.0,
    "hip_flex_max_deg": 150.0, "hip_extension_max_deg": 50.0,
    "hip_abduction_max_deg": 105.0, "hip_adduction_max_deg": 40.0,
    "spine_bend_max_deg": 80.0, "spine_twist_max_deg": 75.0, "neck_bend_max_deg": 75.0,
}
IMPOSSIBLE = {
    "knee_flex_max_deg": 175.0, "knee_hyperextension_max_deg": 30.0, "knee_off_hinge_max_deg": 60.0,
    "elbow_flex_max_deg": 175.0, "elbow_hyperextension_max_deg": 45.0, "elbow_off_hinge_max_deg": 60.0,
    "hip_flex_max_deg": 170.0, "hip_extension_max_deg": 80.0,
    "hip_abduction_max_deg": 130.0, "hip_adduction_max_deg": 60.0,
    "spine_bend_max_deg": 110.0, "spine_twist_max_deg": 110.0, "neck_bend_max_deg": 100.0,
}
SUSTAINED_SHARE = 0.5
HINGE_MIN_BEND_DEG = 25.0
SAGITTAL_MIN_SHARE = 0.35
JOINTS = ("Hips", "Spine1", "Spine2", "Neck", "Head",
          "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
          "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand")


def _unit(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.where(n < 1e-9, 1.0, n)


def _dot(a, b):
    return np.sum(a * b, axis=-1)


def _frame(left, right, low, high):
    lat = _unit(left - right)
    up = high - low
    up = _unit(up - lat * _dot(up, lat)[..., None])
    return lat, up, np.cross(lat, up)


def measure(pos, rot, rest_pos, rest_rot):
    """Per-frame angles in degrees. pos: name -> [F, 3]; rot: name -> [F, 3, 3]
    world rotation matrices; rest_pos / rest_rot: the same for the rest pose."""
    p = {k: np.asarray(v, float) for k, v in pos.items()}
    frames = len(p["Hips"])
    lat, up, fwd = _frame(p["LeftUpLeg"], p["RightUpLeg"], p["Hips"], p["Spine1"])
    clat, cup, cfwd = _frame(p["LeftArm"], p["RightArm"], p["Spine2"], p["Neck"])
    rlat, rup, rfwd = _frame(*(np.asarray(rest_pos[n], float) for n in ("LeftUpLeg", "RightUpLeg", "Hips", "Spine1")))
    out = {}

    def hinge(side, upper, mid, low, flex_toward, key):
        a, b = p[side + mid] - p[side + upper], p[side + low] - p[side + mid]
        rest_a = _unit(np.asarray(rest_pos[side + mid]) - np.asarray(rest_pos[side + upper]))
        axis_rest = _unit(np.cross(rest_a, flex_toward))
        local = np.asarray(rest_rot[side + upper]).T @ axis_rest
        axis = _unit(np.einsum("fij,j->fi", np.asarray(rot[side + upper]), local))
        ua, ub = _unit(a), _unit(b)
        bend = np.degrees(np.arccos(np.clip(_dot(ua, ub), -1, 1)))
        n = np.cross(ua, ub)
        s = np.sign(_dot(n, axis))
        out[key + "_flex"] = np.where(s < 0, -bend, bend)
        off = np.degrees(np.arccos(np.clip(np.abs(_dot(_unit(n), axis)), 0, 1)))
        out[key + "_off_hinge"] = np.where(bend > HINGE_MIN_BEND_DEG, off, 0.0)

    for side in ("Left", "Right"):
        k = side.lower()
        hinge(side, "UpLeg", "Leg", "Foot", -rfwd, k + "_knee")
        hinge(side, "Arm", "ForeArm", "Hand", rfwd, k + "_elbow")
        d = _unit(p[side + "Leg"] - p[side + "UpLeg"])
        out_side = lat if side == "Left" else -lat
        down, forward = _dot(d, -up), _dot(d, fwd)
        sag = np.hypot(down, forward)
        out[k + "_hip_flex"] = np.where(sag > SAGITTAL_MIN_SHARE, np.degrees(np.arctan2(forward, down)), 0.0)
        out[k + "_hip_abduction"] = np.degrees(np.arcsin(np.clip(_dot(d, out_side), -1, 1)))
    out["spine_bend"] = np.degrees(np.arccos(np.clip(_dot(up, cup), -1, 1)))
    lp = _unit(lat - cup * _dot(lat, cup)[..., None])
    out["spine_twist"] = np.degrees(np.arctan2(_dot(np.cross(lp, clat), cup), _dot(lp, clat)))
    head = _unit(p["Head"] - p["Neck"])
    out["neck_bend"] = np.degrees(np.arccos(np.clip(_dot(head, cup), -1, 1)))
    assert all(len(v) == frames for v in out.values())
    return out


CHECKS = [
    # (check, metric keys, limit key, value function)
    ("knee bend", ("left_knee_flex", "right_knee_flex"), "knee_flex_max_deg", lambda v: v),
    ("knee hyperextension", ("left_knee_flex", "right_knee_flex"), "knee_hyperextension_max_deg", lambda v: -v),
    ("knee off hinge", ("left_knee_off_hinge", "right_knee_off_hinge"), "knee_off_hinge_max_deg", lambda v: v),
    ("elbow bend", ("left_elbow_flex", "right_elbow_flex"), "elbow_flex_max_deg", lambda v: v),
    ("elbow hyperextension", ("left_elbow_flex", "right_elbow_flex"), "elbow_hyperextension_max_deg", lambda v: -v),
    ("elbow off hinge", ("left_elbow_off_hinge", "right_elbow_off_hinge"), "elbow_off_hinge_max_deg", lambda v: v),
    ("hip flexion", ("left_hip_flex", "right_hip_flex"), "hip_flex_max_deg", lambda v: v),
    ("hip extension", ("left_hip_flex", "right_hip_flex"), "hip_extension_max_deg", lambda v: -v),
    ("hip abduction", ("left_hip_abduction", "right_hip_abduction"), "hip_abduction_max_deg", lambda v: v),
    ("hip adduction", ("left_hip_abduction", "right_hip_abduction"), "hip_adduction_max_deg", lambda v: -v),
    ("spine bend", ("spine_bend",), "spine_bend_max_deg", lambda v: v),
    ("spine twist", ("spine_twist",), "spine_twist_max_deg", lambda v: np.abs(v)),
    ("neck bend", ("neck_bend",), "neck_bend_max_deg", lambda v: v),
]


def evaluate(angles):
    """{'status': PASS | WARN | FAIL, 'warn': [...], 'fail': [...], 'peaks': {...}}."""
    warn, fail, peaks = [], [], {}
    for check, keys, limit, fn in CHECKS:
        for key in keys:
            v = fn(np.asarray(angles[key]))
            peak = float(v.max())
            peaks[f"{key}:{check}"] = round(peak, 1)
            if peak > LIMITS[limit]:
                warn.append(f"{key} {check} {peak:.1f} > {LIMITS[limit]:.0f}")
            over = v > IMPOSSIBLE[limit]
            sustained = "off_hinge" in key
            if over.any() and (not sustained or over.mean() >= SUSTAINED_SHARE):
                fail.append(f"{key} {check} {peak:.1f} > {IMPOSSIBLE[limit]:.0f}")
    status = "FAIL" if fail else ("WARN" if warn else "PASS")
    return {"status": status, "warn": warn, "fail": fail, "peaks": peaks}


def sample_world(arm, action, frames=None):
    """World joint positions and rotations of one action, every frame, with
    every bone at rest first (the shipped clips leave out rest curves)."""
    import bpy
    pb = arm.pose.bones
    for b in pb:
        b.location = (0, 0, 0)
        b.rotation_quaternion = (1, 0, 0, 0)
        b.scale = (1, 1, 1)
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    n = frames or int(round(action.frame_range[1]))
    pos = {j: [] for j in JOINTS}
    rot = {j: [] for j in JOINTS}
    mw = arm.matrix_world
    for f in range(n):
        bpy.context.scene.frame_set(f)
        for j in JOINTS:
            m = mw @ pb[P + j].matrix
            pos[j].append(list(m.to_translation()))
            rot[j].append([list(r) for r in m.to_3x3()])
    return pos, rot


def rest_world(arm):
    rp, rr = {}, {}
    for j in JOINTS:
        m = arm.matrix_world @ arm.data.bones[P + j].matrix_local
        rp[j] = list(m.to_translation())
        rr[j] = [list(r) for r in m.to_3x3()]
    return rp, rr


def gate_action(arm, action):
    pos, rot = sample_world(arm, action)
    rp, rr = rest_world(arm)
    return evaluate(measure(pos, rot, rp, rr))


def self_test(arm):
    import bpy
    from mathutils import Quaternion
    pb = arm.pose.bones
    # The Tripo Mixamo rig bends the knee and the elbow about the local Z axis.
    cases = [
        ("rest pose", {}, "PASS"),
        ("knee bent 90", {"LeftLeg": ((0, 0, 1), 90)}, "PASS"),
        ("elbow bent 80", {"LeftForeArm": ((0, 0, 1), -80)}, "PASS"),
        ("knee bent 60 to the side", {"LeftLeg": ((1, 0, 0), 60)}, "FAIL"),
        ("knee hyperextended 90", {"LeftLeg": ((0, 0, 1), -90)}, "FAIL"),
        ("elbow hyperextended 80", {"LeftForeArm": ((0, 0, 1), 80)}, "FAIL"),
        ("spine bent 130", {"Spine1": ((1, 0, 0), 130)}, "FAIL"),
    ]
    bad = 0
    for desc, pose, want in cases:
        arm.animation_data.action = None
        for b in pb:
            b.location = (0, 0, 0)
            b.rotation_quaternion = (1, 0, 0, 0)
        for bone, (axis, deg) in pose.items():
            pb[P + bone].rotation_quaternion = Quaternion(axis, math.radians(deg))
        for f in (0, 1):
            for b in pb:
                b.keyframe_insert("rotation_quaternion", frame=f)
        act = arm.animation_data.action
        pos, rot = sample_world(arm, act, frames=2)
        got = evaluate(measure(pos, rot, *rest_world(arm)))["status"]
        got = "PASS" if got == "WARN" and want == "PASS" else got
        ok = got == want
        bad += not ok
        print(f"[joint-limits self-test] {desc:28s} want {want} got {got} {'ok' if ok else 'WRONG'}")
        bpy.data.actions.remove(act)
    return bad


def main():
    import bpy
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--clips", default="")
    ap.add_argument("--json", default="")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for t in arm.animation_data.nla_tracks:
        t.mute = True
    if a.self_test:
        sys.exit(1 if self_test(arm) else 0)
    names = [n for n in a.clips.split(",") if n] or sorted(x.name for x in bpy.data.actions)
    report, failed = {}, 0
    for name in names:
        r = gate_action(arm, bpy.data.actions[name])
        report[name] = r
        failed += r["status"] == "FAIL"
        print(f"[joint-limits] {name:18s} {r['status']:4s} " + "; ".join(r["fail"] or r["warn"]))
    if a.json:
        with open(a.json, "w") as f:
            json.dump(report, f, indent=1)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
