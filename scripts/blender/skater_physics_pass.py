"""A physics pass on the shipped skater clips, in headless Blender.

The clips of nia_clips.py and skater_anim_v3.py are keyed by hand. This pass
makes the body motion more physically plausible and does not move the skates:

1. Centre of mass (CoM): mass-weighted segment centres of the 65-joint Mixamo
   rig (segment masses after Winter, "Biomechanics and Motor Control of Human
   Movement", table 4.1, plus 1.2 kg for each skate).
2. Inertia on rollers: the wheels roll freely, so a gliding skater gets no
   fore-aft force from the ground. The game moves the root at the skate
   speed, so the fore-aft CoM must stay nearly still in root space. The pass
   removes part of the fore-aft CoM oscillation (STILL), by a shift of the
   hips. The push keeps more of it, because the pushing skate gives a force.
3. Balance: the zero moment point (ZMP, from the CoM and its acceleration)
   must be in the support polygon of the skates that touch the ground. When
   it is outside, the pass moves the CoM by the excess.
4. Smoothness: a symmetric Gaussian filter (no time shift) removes the kinks
   of the linear keys from the hips path and from the upper-body rotations.
5. Follow-through: the forearms, the hands, and the head trail their parents
   by a small lag (FOLLOW).
6. The skates do not move: a two-bone IK solve puts each ankle back at its
   old position, with the old foot rotation and the old knee bend direction.
   The foot and toe bones keep their old armature-space matrices, so the
   wheels are where they were.

The clip length, the key times (every frame at 30 fps), and the loop stay the
same. There is no root travel: the hips shift is periodic.

carve_right is the mirror of the new carve_left across the skater's mid plane,
with the same IK solve, as in nia_clips.py.

Run:
  blender -b --factory-startup --python-exit-code 1 \
    -P scripts/blender/skater_physics_pass.py -- \
    --in assets/skaters/nia/skater.glb --out <dir> [--clips push,coast,carve_left]
It writes <dir>/<name>-physics.glb (no Draco: the clips and the rig only) and
<dir>/<name>-physics.json (the metrics before and after).
scripts/assets/graft-clips.mjs then puts the clips into the shipped GLBs.
"""
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import skater_joint_limits as joint_limits  # noqa: E402
import skater_clip_probe as clip_probe  # noqa: E402
from mathutils import Matrix, Quaternion, Vector

FPS = 30
BEAT = 24  # frames: one beat at 75 BPM
G = 9.81
P = "mixamorig:"

# Segment mass fractions (Winter 2009, table 4.1). The trunk is split over the
# spine bones. The shoulders are in Spine2.
MASS = {
    "Hips": 0.142, "Spine": 0.100, "Spine1": 0.100, "Spine2": 0.155,
    "Neck": 0.020, "Head": 0.061,
    "LeftArm": 0.028, "LeftForeArm": 0.016, "LeftHand": 0.006,
    "RightArm": 0.028, "RightForeArm": 0.016, "RightHand": 0.006,
    "LeftUpLeg": 0.100, "LeftLeg": 0.0465, "LeftFoot": 0.0145,
    "RightUpLeg": 0.100, "RightLeg": 0.0465, "RightFoot": 0.0145,
}
BODY_KG = 60.0
SKATE_KG = 1.2

# Fore-aft CoM oscillation removed: 0 keeps it, 1 removes it all.
STILL = {"push": 0.5, "coast": 0.8, "carve_left": 0.7}
# Gaussian sigma in frames for the hips path and the upper-body rotations.
SIGMA = 1.2
# (bone, lag in frames, blend weight) for the follow-through.
FOLLOW = [
    ("LeftForeArm", 2, 0.45), ("RightForeArm", 2, 0.45),
    ("LeftHand", 3, 0.55), ("RightHand", 3, 0.55),
    ("Head", 2, 0.35),
]
SMOOTH_BONES = ["Spine", "Spine1", "Spine2", "Neck", "Head",
                "LeftShoulder", "RightShoulder", "LeftArm", "RightArm",
                "LeftForeArm", "RightForeArm", "LeftHand", "RightHand"]
# The largest hips shift (m): to the side, fore-aft, vertical. In the push, a
# skater moves the hips far over the glide skate, so the side limit is the
# largest. In the carve, 12 cm to the side put the Nia knee 35 degrees off its
# hinge (the joint-limit gate WARN), so the other clips keep 6 cm.
MAX_SHIFT = {"push": (0.12, 0.06, 0.03)}
MAX_SHIFT_DEFAULT = (0.06, 0.06, 0.03)
# A skate touches the ground when its lowest vertex is this close (m).
CONTACT = 0.015
# The margin of the support polygon around the wheel points (m).
SUPPORT_MARGIN = 0.02
# The vertical CoM acceleration range (m/s^2) of a skater on bent knees.
A_UP = (-0.45 * G, 0.6 * G)
# The smallest g + z'' in the ZMP formula (m/s^2), against a divide by zero.
G_MIN = 3.0
# A skate that floats less than this (m) goes down to the ground.
SNAP = 0.006
# A skate whose highest point in the clip is lower than this (m) is a
# dragging or gliding skate, not a step.
DRAG_LIFT = 0.04
# Recoil (the Crossroads attacker recoil rule, docs/animation/attacker-recoil-rule.md,
# #765): at the end of a drive, the body mass continues along its momentum,
# stops, and comes back one time. Events: "lift" = the drive skate leaves the
# ground (the end of a push stroke), "land" = a stepping skate touches down,
# "beat" = each downbeat (24 frames). pelvis in m; chest, arms, head in degrees;
# fwd, side, drop = the weights of the direction (forward, toward the glide
# skate or along the CoM velocity, down).
RECOIL = {
    "push": {"event": "lift", "pelvis": 0.025, "chest": 5.0, "arms": 6.0, "head": 3.0, "fwd": 1.0, "side": 0.5, "drop": 0.4},
    "carve_left": {"event": "land", "pelvis": 0.02, "chest": 4.0, "arms": 4.0, "head": 2.5, "fwd": 0.3, "side": 0.6, "drop": 0.25},
    "coast": {"event": "beat", "pelvis": 0.012, "chest": 2.5, "arms": 3.0, "head": 1.5, "fwd": 0.0, "side": 1.0, "drop": 0.5},
}
# The bounce at 30 fps: it starts LEAD frames before the stop frame, peaks at
# the stop frame, and comes back in BACK frames (the rule: 3 to 5 frames
# before, 2 to 5 out, 6 to 7 back at 60 Hz; a skate stroke is slower than a
# punch, so this uses the slow end: 6 frames up and 8 back at 60 Hz). The
# pelvis bounce goes into the target CoM path before the balance solve, so
# the solve cuts the part of a bounce that the skates cannot hold. Each segment is 1 frame later
# than the one before: pelvis, chest, arms, head.
# Per skater: Nia's carve landing ends an unstable one-skate step (beat 2),
# and any pelvis bounce there spread out of balance (ZMP excess 0.034 m
# without it, 0.048 to 0.051 m with it). Her chest, arms, and head still
# follow through.
RECOIL_SKATER = {"nia": {"carve_left": {"pelvis": 0.0}}}
SKATER = {"who": ""}
RECOIL_LEAD, RECOIL_BACK = 3, 4
RECOIL_DELAY = {"pelvis": 0, "chest": 1, "arms": 2, "head": 3}
# A faster drive (the Crossroads recipe: the swing length times 10/18, and a
# deeper load before it). For the push only: each drive (both skates on the
# ground, from the touch-down of the other skate to the lift-off of the drive
# skate) plays in DRIVE_RATIO of its frames. The lift-off frames stay, the
# other skate lands later, so the glide on one skate gets the saved frames.
# The clip length does not change. LOAD (m): an extra dip of the CoM at the
# start of the drive.
DRIVE = {"push": {"ratio": 10 / 18, "load": 0.01, "load_sigma": 2.5}}
# Athletic stance (owner feedback 2026-11-21: the coast looked upright). The
# derby and coaching cues: bend at the knees and the hips, not at the waist;
# the back straight, the chest and head up; the shoulders, knees, and toes in
# one vertical line; the weight over the skates. The stance pass hinges the
# body forward at the hips until the shoulders (Neck) are over the knees,
# lowers the hips to hip_ankle x the leg length, keeps the gaze level
# (head_keep of the hinge goes back in the neck and head), and brings the
# upper arms forward. The skates do not move (leg IK).
STANCE = {
    "coast": {"hip_ankle": 0.78, "max_hinge_deg": 35.0, "head_keep": 0.8, "arms_fwd_deg": 12.0},
    # The push is already lower than 0.78; it gets the same hinge rule, so a
    # blend between the coast and the push does not lift the chest.
    "push": {"hip_ankle": 0.78, "max_hinge_deg": 35.0, "head_keep": 0.8, "arms_fwd_deg": 0.0},
}
# Arm mirror (owner feedback 2026-11-21: Marcus's right arm stays bent for no
# reason). skater_anim_v3.py keys his right elbow at 84 degrees with half the
# swing of the left arm ("like a drum stick"); in the game it reads as a
# stiff arm. In these clips the right arm becomes the mirror of the left arm
# half a clip later (the arms swing in opposition), in the frame of the chest.
ARM_MIRROR = {"marcus": {"push": "Left", "coast": "Left"}}
ARM_CHAIN = ["Shoulder", "Arm", "ForeArm", "Hand"]
# Clipping (owner feedback 2026-11-21): limb capsules and skate boxes
# (skater_clip_probe.py). A leg that goes into the other leg moves its skate
# away in the ground plane; a hand or forearm in a thigh swings the upper arm
# out. CLEAR (m) is the gap that the fix leaves.
CLEAR = 0.005
# A hand or forearm against the cloth of a thigh is light contact up to this
# depth (m); only a deeper clip swings the arm out.
ARM_CLIP = 0.02
CLIP_ITERS = 4
LEG_PAIRS = {"l_knee>r_knee", "l_knee>r_shin", "r_knee>l_shin", "l_knee>r_thigh", "r_knee>l_thigh", "l_shin>r_shin", "l_thigh>r_shin", "r_thigh>l_shin",
             "l_skate>r_skate", "l_skate>r_shin", "r_skate>l_shin"}
ARM_PAIRS = {"l_hand>l_thigh": "Left", "r_hand>r_thigh": "Right", "l_hand>l_knee": "Left", "r_hand>r_knee": "Right",
             "l_forearm>l_thigh": "Left", "r_forearm>r_thigh": "Right"}
# Support (owner request 2026-11-21: fix Nia's carve step on beat 2). When
# one skate is in the air, the skate on the ground must be under the centre
# of mass. A skate can roll along its own heading without a skid, so the
# support skate rolls along its heading until the CoM is over the middle
# "core" share of its wheelbase. The roll starts while both skates are still
# down and ends after the other skate lands (dilate and smooth).
# The skate in the ATL Ryde drag is on its toe stop (pitched up); a skater
# cannot stand on a dragging toe stop, so the support skate is also levelled
# onto its wheels (its yaw stays). Only Nia: Marcus's crossover carve was
# already in balance (ZMP excess 0.024 m), and the roll made it worse.
SUPPORT = {"nia": {"carve_left": {"core": 0.3, "dilate_frames": 4, "sigma_frames": 2.5}}}
# The heading of the skater in Blender: the model faces -Y, X is the side.
FORWARD = 1  # axis index of fore-aft (Y)
SIDE = 0


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--clips", default="push,coast,carve_left")
    p.add_argument("--no-mirror", action="store_true")
    return p.parse_args(argv)


# ---------------------------------------------------------------- helpers

def circ_gauss(x, sigma):
    """Symmetric Gaussian filter on a periodic series (axis 0)."""
    n = len(x)
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = np.zeros_like(x, dtype=float)
    for i, w in zip(range(-r, r + 1), k):
        out += w * np.roll(x, i, axis=0)
    return out


def circ_d2(x, dt):
    return (np.roll(x, -1, axis=0) - 2 * x + np.roll(x, 1, axis=0)) / dt ** 2


def circ_d3(x, dt):
    return (np.roll(x, -2, axis=0) - 2 * np.roll(x, -1, axis=0) + 2 * np.roll(x, 1, axis=0) - np.roll(x, 2, axis=0)) / (2 * dt ** 3)


def hull(points):
    """Convex hull (monotone chain) of 2D points, counter-clockwise."""
    pts = sorted(set(map(tuple, np.round(points, 4))))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def outside(poly, p, margin):
    """The vector from p to the nearest point of the polygon grown by margin,
    or zero when p is inside."""
    if len(poly) < 3:
        if len(poly) == 0:
            return np.zeros(2)
        # A segment or a point: the nearest point on it.
        a, b = poly[0], poly[-1]
        ab = b - a
        t = 0.0 if ab.dot(ab) < 1e-12 else min(max((p - a).dot(ab) / ab.dot(ab), 0), 1)
        q = a + t * ab
        d = p - q
        dist = np.linalg.norm(d)
        return np.zeros(2) if dist <= margin else -(d / dist) * (dist - margin)
    inside = True
    best, bestd = None, 1e9
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ab = b - a
        if ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0]) < 0:
            inside = False
        t = min(max((p - a).dot(ab) / max(ab.dot(ab), 1e-12), 0), 1)
        q = a + t * ab
        d = np.linalg.norm(p - q)
        if d < bestd:
            best, bestd = q, d
    if inside or bestd <= margin:
        return np.zeros(2)
    d = p - best
    return -(d / bestd) * (bestd - margin)


def bind(arm, action):
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]


# ---------------------------------------------------------------- sampling

class Skater:
    def __init__(self, src):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        scene = bpy.context.scene
        scene.render.fps = FPS
        scene.render.fps_base = 1.0
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(src))
        self.arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        self.mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
        assert self.arm.matrix_world == Matrix.Identity(4), "the armature must be at the origin"
        for t in self.arm.animation_data.nla_tracks:
            t.mute = True
        self.pb = self.arm.pose.bones
        self.names = [b.name for b in self.arm.data.bones]
        self.skate = {s: self._skate_vertices(s) for s in ("Left", "Right")}
        total = sum(MASS.values()) * BODY_KG + 2 * SKATE_KG
        self.mass = {P + k: v * BODY_KG / total for k, v in MASS.items()}
        for s in ("Left", "Right"):
            self.mass[P + s + "Foot"] += SKATE_KG / total

    def _skate_vertices(self, side):
        names = {f"{P}{side}{b}" for b in ("Foot", "ToeBase", "Toe_End")}
        idx = {g.index for g in self.mesh.vertex_groups if g.name in names}
        out = [v.index for v in self.mesh.data.vertices if sum(g.weight for g in v.groups if g.group in idx) > 0.5]
        return np.array(out)

    def frames(self, action):
        return int(round(action.frame_range[1]))

    def sample(self, action, with_mesh=True):
        """Per frame 0..n-1: the armature-space matrix of each bone, the local
        basis of each bone, and the skate vertices."""
        # A shipped clip has no curves for the bones that stay at rest, so
        # put every bone at rest first: else they keep the last pose set.
        for pb in self.pb:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)
        bind(self.arm, action)
        n = self.frames(action)
        out = {"n": n, "mat": [], "basis": [], "skate": []}
        scene = bpy.context.scene
        for f in range(n):
            scene.frame_set(f)
            out["mat"].append({b: self.pb[b].matrix.copy() for b in self.names})
            out["basis"].append({b: (self.pb[b].location.copy(), self.pb[b].rotation_quaternion.copy()) for b in self.names})
            if with_mesh:
                ev = self.mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
                co = np.empty(len(ev.data.vertices) * 3)
                ev.data.vertices.foreach_get("co", co)
                co = co.reshape(-1, 3)
                out["skate"].append({s: co[self.skate[s]] for s in self.skate})
        # The loop check: the last key is the first pose again.
        scene.frame_set(n)
        last = {b: self.pb[b].matrix.copy() for b in self.names}
        err = max((last[b].to_translation() - out["mat"][0][b].to_translation()).length for b in self.names)
        out["loop_error_m"] = err
        return out

    def com(self, mats):
        c = Vector()
        for b, m in self.mass.items():
            pb = self.pb[b]
            M = mats[b]
            head = M.to_translation()
            tail = M @ Vector((0, pb.bone.length, 0))
            c += m * (head + tail) / 2
        return np.array(c)


# ---------------------------------------------------------------- metrics

def metrics(sk, s):
    n, dt = s["n"], 1.0 / FPS
    C = np.array([sk.com(m) for m in s["mat"]])
    A = circ_d2(C, dt)
    J = circ_d3(C, dt)
    zmp_out, zmp_out_frames, wheel = [], 0, {"Left": [], "Right": []}
    contact = []
    for f in range(n):
        pts, on = [], []
        for side, co in s["skate"][f].items():
            z = float(co[:, 2].min())
            wheel[side].append(z)
            if z < CONTACT:
                on.append(side)
                pts.append(co[co[:, 2] < z + 0.02][:, :2])
        contact.append(on)
        poly = hull(np.concatenate(pts)) if pts else np.zeros((0, 2))
        zmp = C[f, :2] - C[f, 2] * A[f, :2] / max(G + A[f, 2], G_MIN)
        d = np.linalg.norm(outside(poly, zmp, SUPPORT_MARGIN))
        zmp_out.append(d)
        zmp_out_frames += d > 0
    # Upper-body angular jerk: the chest and head world rotation as vectors.
    def rotvec(b):
        q = [s["mat"][f][P + b].to_quaternion() for f in range(n)]
        for i in range(1, n):
            if q[i].dot(q[i - 1]) < 0:
                q[i].negate()
        return np.array([list(x) for x in q])
    ang = {}
    for b in ("Spine2", "Head", "LeftHand", "RightHand"):
        q = rotvec(b)
        ang[b] = float(np.sqrt((circ_d3(q, dt) ** 2).sum(1).mean()))
    fore = C[:, FORWARD] - C[:, FORWARD].mean()
    return {
        "frames": n,
        "loop_error_m": round(s["loop_error_m"], 5),
        "com_fore_aft_range_m": round(float(fore.max() - fore.min()), 4),
        "com_fore_aft_accel_peak_ms2": round(float(np.abs(A[:, FORWARD]).max()), 3),
        "com_side_accel_peak_ms2": round(float(np.abs(A[:, SIDE]).max()), 3),
        "com_up_accel_min_ms2": round(float(A[:, 2].min()), 3),
        "com_up_accel_max_ms2": round(float(A[:, 2].max()), 3),
        "com_jerk_rms_ms3": round(float(np.sqrt((J ** 2).sum(1).mean())), 2),
        "zmp_outside_frames": int(zmp_out_frames),
        "zmp_outside_max_m": round(float(max(zmp_out)), 4),
        "zmp_outside_mean_m": round(float(np.mean(zmp_out)), 4),
        "zmp_outside_by_frame_m": [round(float(x), 3) for x in zmp_out],
        "angular_jerk_rms": {k: round(v, 1) for k, v in ang.items()},
        "wheel_z_min_m": {k: round(min(v), 4) for k, v in wheel.items()},
        "wheel_z_max_m": {k: round(max(v), 4) for k, v in wheel.items()},
        "contact": ["".join(x[0] for x in c) or "-" for c in contact],
        "_C": C,
    }


# ---------------------------------------------------------------- the pass

def leg_ik(sk, mats, side, hips_new, target_mats):
    """Two-bone IK in armature space. Returns new matrices for UpLeg, Leg."""
    up, lo, ft = P + side + "UpLeg", P + side + "Leg", P + side + "Foot"
    M_up, M_lo, M_ft = mats[up], mats[lo], target_mats[ft]
    H0, K0, A0 = M_up.to_translation(), M_lo.to_translation(), mats[ft].to_translation()
    A = M_ft.to_translation()
    # The hip joint moves rigidly with the hips.
    H = (hips_new @ mats[P + "Hips"].inverted() @ M_up).to_translation()
    l1, l2 = (K0 - H0).length, (A0 - K0).length
    d_vec = A - H
    d = min(d_vec.length, 0.9995 * (l1 + l2))
    u = d_vec.normalized()
    # The old bend direction, square to the new hip-ankle line.
    mid0 = H0 + (A0 - H0).normalized() * ((K0 - H0).dot((A0 - H0).normalized()))
    bend = K0 - mid0
    # When the foot target moved (the support roll), the knee points over the
    # skate again: blend the bend toward the heading of the target foot, as
    # the knee pole of skater_runtime.py does.
    moved = (A - A0).length
    if moved > 0.01 and P + side + "ToeBase" in target_mats:
        h = target_mats[P + side + "ToeBase"].to_translation() - M_ft.to_translation()
        h.z = 0
        if h.length > 1e-6 and bend.length > 1e-6:
            w = min(1.0, moved / 0.05)
            bend = bend.normalized() * (1 - w) + h.normalized() * w
    bend = (bend - u * bend.dot(u))
    if bend.length < 1e-6:
        bend = Vector((0, -1, 0)) - u * u.y
    bend.normalize()
    a = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0.0))
    K = H + u * a + bend * h
    r_up = (K0 - H0).rotation_difference(K - H)
    r_lo = (A0 - K0).rotation_difference(A - K)
    new_up = Matrix.Translation(H) @ (r_up.to_matrix() @ M_up.to_3x3()).to_4x4()
    new_lo = Matrix.Translation(K) @ (r_lo.to_matrix() @ M_lo.to_3x3()).to_4x4()
    reach = d_vec.length / (l1 + l2)
    return new_up, new_lo, reach


def reach_ok(sk, mats, hips_new):
    for side in ("Left", "Right"):
        up, ft = P + side + "UpLeg", P + side + "Foot"
        l1 = (mats[P + side + "Leg"].to_translation() - mats[up].to_translation()).length
        l2 = (mats[ft].to_translation() - mats[P + side + "Leg"].to_translation()).length
        H = (hips_new @ mats[P + "Hips"].inverted() @ mats[up]).to_translation()
        if (mats[ft].to_translation() - H).length > 0.995 * (l1 + l2):
            return False
    return True


def quat_series(s, bone):
    q = [s["basis"][f][bone][1].copy() for f in range(s["n"])]
    for i in range(1, len(q)):
        if q[i].dot(q[i - 1]) < 0:
            q[i].negate()
    return np.array([list(x) for x in q])


def upper_body(s):
    """New local rotations of the upper body: smoothed, then follow-through."""
    n = s["n"]
    out = {}
    for b in SMOOTH_BONES:
        name = P + b
        q = circ_gauss(quat_series(s, name), SIGMA)
        q /= np.linalg.norm(q, axis=1, keepdims=True)
        out[name] = q
    for b, lag, w in FOLLOW:
        name = P + b
        q = out[name]
        lagged = np.roll(q, lag, axis=0)
        new = np.array([list(Quaternion(q[f]).slerp(Quaternion(lagged[f]), w)) for f in range(n)])
        out[name] = new
    return out


def write_pose(sk, f, s, hips_mat, rots, target_mats):
    """Sets the pose of frame f and returns the new armature-space matrices."""
    pb = sk.pb
    base = s["basis"][f]
    for b in sk.names:
        loc, rot = base[b]
        pb[b].location = loc
        pb[b].rotation_quaternion = rot
    for b, q in rots.items():
        pb[b].rotation_quaternion = Quaternion(q[f])
    pb[P + "Hips"].matrix = hips_mat
    bpy.context.view_layer.update()
    mats = s["mat"][f]
    reach = {}
    for side in ("Left", "Right"):
        new_up, new_lo, reach[side] = leg_ik(sk, mats, side, hips_mat, target_mats)
        for b, M in ((P + side + "UpLeg", new_up), (P + side + "Leg", new_lo), (P + side + "Foot", target_mats[P + side + "Foot"])):
            loc = pb[b].location.copy()
            pb[b].matrix = M
            pb[b].location = loc  # rotation only: the joint stays connected
            bpy.context.view_layer.update()
        toe = P + side + "ToeBase"
        if toe in target_mats:
            loc = pb[toe].location.copy()
            pb[toe].matrix = target_mats[toe]
            pb[toe].location = loc
            bpy.context.view_layer.update()
    return {b: pb[b].matrix.copy() for b in sk.names}, reach


def key_frame(sk, f):
    for b in sk.names:
        pb = sk.pb[b]
        pb.keyframe_insert("location", frame=f)
        pb.keyframe_insert("rotation_quaternion", frame=f)


def d2_matrix(n, dt):
    D = np.zeros((n, n))
    for i in range(n):
        D[i, (i - 1) % n] += 1
        D[i, i] -= 2
        D[i, (i + 1) % n] += 1
    return D / dt ** 2


def zmp_of(T, A):
    den = np.maximum(G + A[:, 2], G_MIN)
    return T[:, :2] - (T[:, 2] / den)[:, None] * A[:, :2]


def physics_pass(sk, name, s, m0):
    n, dt = s["n"], 1.0 / FPS
    C = m0["_C"]
    D2 = d2_matrix(n, dt)
    T = C.copy()
    # 1. Inertia on rollers: less fore-aft CoM oscillation.
    mean = C[:, FORWARD].mean()
    T[:, FORWARD] = mean + (1 - STILL[name]) * (C[:, FORWARD] - mean)
    T[:, :2] = circ_gauss(T[:, :2], SIGMA)
    # 2. Vertical: the ground can only push, and a skater on bent knees does
    #    not drop or rise faster than A_UP. Widen the symmetric filter until
    #    the vertical CoM acceleration is in range (no time shift).
    sigma_z = SIGMA
    z = circ_gauss(C[:, 2], sigma_z)
    while sigma_z < 6 and ((D2 @ z).min() < A_UP[0] or (D2 @ z).max() > A_UP[1]):
        sigma_z += 0.25
        z = circ_gauss(C[:, 2], sigma_z)
    T[:, 2] = z
    # 2b. Recoil (pelvis part) on the target CoM path: the CoM moves about
    #     0.68 of a hips shift.
    events = recoil_events(name, s, C)
    rec = recoil_offsets(name, events, n)
    T += 0.68 * rec
    # 2c. The deeper load at the start of each drive (DRIVE).
    if s.get("drive"):
        cfg = s["drive"]
        for d in cfg["drives"]:
            k = ((np.arange(n) - d["land_new"] + n // 2) % n) - n // 2
            T[:, 2] -= cfg["load"] * np.exp(-0.5 * (k / cfg["load_sigma"]) ** 2)
    # 3. Balance, cart-table model: ZMP = C - k C'' with k = z / (g + z'').
    #    Clamp the ZMP of the target path into the support polygon, then
    #    solve (I - K D2) C = ZMP* for the horizontal CoM. The solve is a
    #    low-pass, so the new path is smooth, and a frame that is already in
    #    balance keeps its path.
    polys = []
    for f in range(n):
        pts = [co[co[:, 2] < co[:, 2].min() + 0.02][:, :2] for co in s["skate"][f].values() if co[:, 2].min() < CONTACT]
        polys.append(hull(np.concatenate(pts)) if pts else np.zeros((0, 2)))
    A = D2 @ T
    K = np.diag(T[:, 2] / np.maximum(G + A[:, 2], G_MIN))
    M = np.eye(n) - K @ D2
    for _ in range(4):
        Z = M @ T[:, :2]
        fix = np.array([outside(polys[f], Z[f], SUPPORT_MARGIN) for f in range(n)])
        if np.abs(fix).max() < 1e-4:
            break
        T[:, :2] = np.linalg.solve(M, Z + fix)
    # 4. The wheels: a skate in the ground goes up, a skate that floats less
    #    than SNAP above the ground goes down.
    targets = []
    lift = {}
    for side in ("Left", "Right"):
        zmin = np.array([float(s["skate"][f][side][:, 2].min()) for f in range(n)])
        if zmin.max() < DRAG_LIFT:
            # A skate that never lifts more than DRAG_LIFT drags or glides:
            # it stays on the ground for the whole clip.
            lift[side] = -zmin
            continue
        dz = np.where(zmin < 0, -zmin, np.where(zmin < SNAP, -zmin, 0.0))
        up = np.maximum(dz, 0)
        up = np.maximum(up, circ_gauss(up, 1.5))
        lift[side] = np.where(dz < 0, dz, up)
    for f in range(n):
        tm = dict(s["mat"][f])
        for side in ("Left", "Right"):
            for b in ("Foot", "ToeBase"):
                key = P + side + b
                tm[key] = Matrix.Translation((0, 0, float(lift[side][f]))) @ s["mat"][f][key]
        targets.append(tm)
    # 5. Hips shift that gives the target CoM (the legs follow by IK).
    hips0 = [s["mat"][f][P + "Hips"] for f in range(n)]
    shift = np.zeros((n, 3))
    rots = upper_body(s)
    recoil_rotations(name, s, events, rots)
    best = None
    for it in range(4):
        C_now = []
        for f in range(n):
            H = Matrix.Translation(Vector(shift[f])) @ hips0[f]
            mats, _ = write_pose(sk, f, s, H, rots, targets[f])
            C_now.append(sk.com(mats))
        err = T - np.array(C_now)
        e = float(np.abs(err).max())
        if best is None or e < best[0]:
            best = (e, shift.copy())
        else:
            break
        shift = shift + err / 0.68
        for axis, cap in enumerate(MAX_SHIFT.get(name, MAX_SHIFT_DEFAULT)):
            shift[:, axis] = np.clip(shift[:, axis], -cap, cap)
    shift = best[1]
    # 6. Keep the legs in reach: scale the shift down on a frame if needed.
    for f in range(n):
        for _ in range(12):
            H = Matrix.Translation(Vector(shift[f])) @ hips0[f]
            if reach_ok(sk, targets[f], H):
                break
            shift[f] *= 0.8
    info = {"sigma_z_frames": sigma_z, "com_target_error_max_m": round(best[0], 4),
            "wheel_lift_max_m": {k: round(float(v.max()), 4) for k, v in lift.items()},
            "wheel_drop_max_m": {k: round(float(-v.min()), 4) for k, v in lift.items()},
            "recoil_events": [{"frame": e["frame"], "skate": e["skate"], "dir": [round(float(x), 3) for x in e["dir"]]} for e in events],
            "recoil_pelvis_target_max_m": round(float(np.abs(0.68 * rec).max()), 4)}
    return shift, rots, targets, info


def smoothstep(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def bounce(k):
    """One bounce: 0 at k = -LEAD, 1 at k = 0, 0 at k = BACK, 0 outside."""
    if k <= -RECOIL_LEAD or k >= RECOIL_BACK:
        return 0.0
    if k <= 0:
        return smoothstep((k + RECOIL_LEAD) / RECOIL_LEAD)
    return 1.0 - smoothstep(k / RECOIL_BACK)


def recoil_events(name, s, C):
    cfg = RECOIL.get(name)
    n = s["n"]
    if not cfg:
        return []
    z = {side: np.array([float(s["skate"][f][side][:, 2].min()) for f in range(n)]) for side in ("Left", "Right")}
    vel = (np.roll(C, -1, axis=0) - np.roll(C, 1, axis=0)) * FPS / 2
    out = []
    for side in ("Left", "Right"):
        zz = z[side]
        for f in range(n):
            prev, cur = zz[f - 1], zz[f]
            if cfg["event"] == "lift" and prev < CONTACT <= cur and max(zz[(f + i) % n] for i in range(10)) >= DRAG_LIFT:
                other = "Right" if side == "Left" else "Left"
                glide_x = float(s["skate"][(f - 1) % n][other][:, 0].mean())
                lat = np.array([math.copysign(1.0, glide_x - C[(f - 1) % n, 0]), 0, 0])
                out.append({"frame": (f - 1) % n, "skate": side, "lat": lat})
            if cfg["event"] == "land" and prev >= CONTACT > cur and max(zz[(f - i) % n] for i in range(10)) >= DRAG_LIFT:
                v = vel[f].copy()
                v[2] = 0
                lat = v / max(np.linalg.norm(v), 1e-9)
                # A landing bounce starts at the touch-down, not before it:
                # before the touch-down the body is still on one skate.
                out.append({"frame": (f + RECOIL_LEAD) % n, "skate": side, "lat": lat})
    if cfg["event"] == "beat":
        for f in range(0, n, BEAT):
            v = vel[f].copy()
            v[2] = 0
            out.append({"frame": f, "skate": "both", "lat": v / max(np.linalg.norm(v), 1e-9)})
    for e in out:
        d = cfg["fwd"] * np.array([0.0, -1.0, 0.0]) + cfg["side"] * e["lat"] + cfg["drop"] * np.array([0.0, 0.0, -1.0])
        e["dir"] = d / np.linalg.norm(d)
    return sorted(out, key=lambda e: e["frame"])


def _active(events, f, delay, n):
    """(weight, event) of the event with the largest bounce on frame f."""
    best, bw = None, 0.0
    for e in events:
        w = bounce(((f - e["frame"] - delay + n // 2) % n) - n // 2)
        if w > bw:
            best, bw = e, w
    return bw, best


def recoil_offsets(name, events, n):
    """The pelvis bounce (m) on each frame, [n, 3]."""
    out = np.zeros((n, 3))
    cfg = RECOIL.get(name)
    if not cfg:
        return out
    cfg = {**cfg, **RECOIL_SKATER.get(SKATER["who"], {}).get(name, {})}
    for f in range(n):
        w, e = _active(events, f, RECOIL_DELAY["pelvis"], n)
        if e:
            out[f] = cfg["pelvis"] * w * e["dir"]
    return out


def recoil_rotations(name, s, events, rots):
    """The chest, upper arm, and head bounce: a lean along the horizontal
    direction of the event, 1 frame later for each segment."""
    cfg = RECOIL.get(name)
    if not cfg:
        return
    n = s["n"]
    parts = {"chest": ["Spine2"], "arms": ["LeftArm", "RightArm"], "head": ["Head"]}
    for part, bones in parts.items():
        for f in range(n):
            w, e = _active(events, f, RECOIL_DELAY[part], n)
            if not e:
                continue
            dh = Vector((e["dir"][0], e["dir"][1], 0.0))
            if dh.length < 1e-6:
                continue
            W = Quaternion(Vector((0, 0, 1)).cross(dh.normalized()), math.radians(cfg[part] * w))
            for b in bones:
                key = P + b
                M = s["mat"][f][key].to_quaternion()
                rots[key][f] = list(Quaternion(rots[key][f]) @ (M.inverted() @ W @ M))


def contact_events(s):
    """Per skate: lift-off frames (the last frame on the ground before a step)
    and touch-down frames (the first frame on the ground after a step)."""
    n = s["n"]
    out = {}
    for side in ("Left", "Right"):
        z = np.array([float(s["skate"][f][side][:, 2].min()) for f in range(n)])
        lifts, lands = [], []
        for f in range(n):
            if z[f - 1] < CONTACT <= z[f] and max(z[(f + i) % n] for i in range(10)) >= DRAG_LIFT:
                lifts.append((f - 1) % n)
            if z[f - 1] >= CONTACT > z[f] and max(z[(f - i) % n] for i in range(10)) >= DRAG_LIFT:
                lands.append(f)
        out[side] = {"lift": lifts, "land": lands}
    return out


def pchip(xk, yk, x):
    """Monotone cubic interpolation (Fritsch-Carlson)."""
    xk, yk = np.asarray(xk, float), np.asarray(yk, float)
    h = np.diff(xk)
    d = np.diff(yk) / h
    m = np.zeros_like(yk)
    for i in range(1, len(xk) - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0], m[-1] = d[0], d[-1]
    out = []
    for t in np.atleast_1d(x):
        i = int(np.clip(np.searchsorted(xk, t) - 1, 0, len(h) - 1))
        u = (t - xk[i]) / h[i]
        h00, h10, h01, h11 = 2 * u**3 - 3 * u**2 + 1, u**3 - 2 * u**2 + u, -2 * u**3 + 3 * u**2, u**3 - u**2
        out.append(h00 * yk[i] + h10 * h[i] * m[i] + h01 * yk[i + 1] + h11 * h[i] * m[i + 1])
    return np.array(out)


def drive_plan(name, s):
    """The drives of a clip and the time warp: output frame -> source frame."""
    cfg = DRIVE.get(name)
    if not cfg:
        return None
    n = s["n"]
    ev = contact_events(s)
    drives = []
    for side, other in (("Left", "Right"), ("Right", "Left")):
        for lo in ev[side]["lift"]:
            lands = ev[other]["land"]
            if not lands:
                continue
            land = max(lands, key=lambda f: -((lo - f) % n))  # the nearest touch-down before the lift-off
            length = (lo - land) % n
            new = max(2, int(round(length * cfg["ratio"])))
            drives.append({"skate": side, "lift": lo, "land": land, "frames": length,
                           "land_new": (lo - new) % n, "frames_new": new})
    if not drives:
        return None
    knots = sorted({(d["lift"], d["lift"]) for d in drives} | {(d["land_new"], d["land"]) for d in drives})
    # Unwrap the source frames so that they rise with the output frames.
    xs, ys = [], []
    for x, y in knots:
        if ys and y < ys[-1]:
            y += n
        xs.append(x)
        ys.append(y)
    k = len(xs)
    xk = [x - n for x in xs] + xs + [x + n for x in xs]
    yk = [y - n for y in ys] + ys + [y + n for y in ys]
    warp = pchip(xk, yk, np.arange(n)) % n
    return {"drives": drives, "warp": [float(w) for w in warp], **cfg}


def retime(sk, action, plan, name):
    """A new action: frame f shows the pose of the source at warp[f]."""
    scene = bpy.context.scene
    pb = sk.pb
    n = len(plan["warp"])
    poses = []
    for f in range(n):
        t = plan["warp"][f]
        for b in pb:
            b.location = (0, 0, 0)
            b.rotation_quaternion = (1, 0, 0, 0)
        bind(sk.arm, action)
        scene.frame_set(int(math.floor(t)), subframe=t - math.floor(t))
        poses.append({b.name: (b.location.copy(), b.rotation_quaternion.copy()) for b in pb})
    sk.arm.animation_data.action = None
    for f in range(n + 1):
        for b in pb:
            loc, rot = poses[f % n][b.name]
            b.location = loc
            b.rotation_quaternion = rot
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name
    return act


def drive_speed(s, plan_drives):
    """The peak speed (m/s) of the drive skate against the hips, in each drive."""
    n = s["n"]
    out = []
    for d in plan_drives:
        side = d["skate"]
        pos = [s["skate"][f][side][:, :2].mean(0) - np.array(s["mat"][f][P + "Hips"].to_translation())[:2] for f in range(n)]
        frames = [(d["lift"] - k) % n for k in range(d["frames_new"] if "frames_new" in d else d["frames"])]
        v = [np.linalg.norm(pos[f] - pos[f - 1]) * FPS for f in frames]
        out.append(round(float(max(v)), 3))
    return out


def local_delta(s, f, bone, W):
    """The local rotation that turns bone by the armature-space rotation W."""
    M = s["mat"][f][bone].to_quaternion()
    return M.inverted() @ W @ M


def stance_pose(sk, s, f, drop, hinge, cfg):
    """(hips matrix, rots) of frame f with the stance applied."""
    H0 = s["mat"][f][P + "Hips"]
    piv = H0.to_translation()
    R = Matrix.Rotation(math.radians(hinge), 4, "X")  # +X tilts up toward -Y (forward)
    H = Matrix.Translation((0, 0, -drop)) @ Matrix.Translation(piv) @ R @ Matrix.Translation(-piv) @ H0
    rots = {}
    back = -hinge * cfg["head_keep"]
    for bone, share in ((P + "Neck", 0.4), (P + "Head", 0.6)):
        W = Quaternion((1, 0, 0), math.radians(back * share))
        rots[bone] = s["basis"][f][bone][1] @ local_delta(s, f, bone, W)
    for side in ("Left", "Right"):
        bone = P + side + "Arm"
        W = Quaternion((1, 0, 0), math.radians(cfg["arms_fwd_deg"]))
        rots[bone] = s["basis"][f][bone][1] @ local_delta(s, f, bone, W)
    return H, rots


def leg_length(sk):
    b = sk.arm.data.bones
    return ((b[P + "LeftLeg"].head_local - b[P + "LeftUpLeg"].head_local).length
            + (b[P + "LeftFoot"].head_local - b[P + "LeftLeg"].head_local).length)


def stance_pass(sk, name, s):
    """A new action with the athletic stance, or None. Returns (action, info)."""
    cfg = STANCE.get(name)
    if not cfg:
        return None, None
    n = s["n"]
    leg = leg_length(sk)

    def hip_ankle(mats):
        return min((mats[P + sd + "UpLeg"].to_translation() - mats[P + sd + "Foot"].to_translation()).length
                   for sd in ("Left", "Right")) / leg

    def lean(mats):
        t = mats[P + "Neck"].to_translation() - mats[P + "Hips"].to_translation()
        return math.degrees(math.atan2(-t.y, t.z))

    ratio0 = float(np.mean([hip_ankle(s["mat"][f]) for f in range(n)]))
    lean0 = float(np.mean([lean(s["mat"][f]) for f in range(n)]))
    drop = max(0.0, (ratio0 - cfg["hip_ankle"]) * leg)
    probe = list(range(0, n, 4))

    def apply(f, hinge):
        H, r = stance_pose(sk, s, f, drop, hinge, cfg)
        rq = {b: np.array([list(q)] * n) for b, q in r.items()}
        mats, _ = write_pose(sk, f, s, H, rq, s["mat"][f])
        return mats

    def offset(hinge):
        # Fore-aft distance (m) of the shoulders in front of the knees: + = in front.
        d = []
        for f in probe:
            m = apply(f, hinge)
            knee = (m[P + "LeftLeg"].to_translation() + m[P + "RightLeg"].to_translation()) / 2
            d.append(-(m[P + "Neck"].to_translation().y - knee.y))
        return float(np.mean(d))

    best = min(range(0, int(cfg["max_hinge_deg"]) + 1), key=lambda h: abs(offset(h)))
    sk.arm.animation_data.action = None
    for f in range(n + 1):
        g = f % n
        H, r = stance_pose(sk, s, g, drop, best, cfg)
        rq = {b: np.array([list(q)] * n) for b, q in r.items()}
        write_pose(sk, g, s, H, rq, s["mat"][g])
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name + "_stance"
    s1 = sk.sample(act, with_mesh=False)
    info = {"hinge_deg": best, "hips_drop_m": round(drop, 4),
            "trunk_lean_deg": [round(lean0, 1), round(float(np.mean([lean(s1["mat"][f]) for f in range(n)])), 1)],
            "hip_ankle_over_leg": [round(ratio0, 3), round(float(np.mean([hip_ankle(s1["mat"][f]) for f in range(n)])), 3)],
            "shoulders_ahead_of_knees_m": [round(offset(0), 3), round(offset(best), 3)]}
    return act, info


def arm_mirror_pass(sk, who, name, s):
    """A new action with one arm the mirror of the other, half a clip later."""
    src = ARM_MIRROR.get(who, {}).get(name)
    if not src:
        return None, None
    dst = "Right" if src == "Left" else "Left"
    n = s["n"]
    S = Matrix.Diagonal((-1, 1, 1, 1))
    rest = {b.name: b.matrix_local.copy() for b in sk.arm.data.bones}
    chest = P + "Spine2"
    pb = sk.pb
    sk.arm.animation_data.action = None
    before = []
    for f in range(n + 1):
        g = f % n
        h = (g + n // 2) % n
        for b in sk.names:
            loc, rot = s["basis"][g][b]
            pb[b].location = loc
            pb[b].rotation_quaternion = rot
        bpy.context.view_layer.update()
        C_g, C_h = s["mat"][g][chest], s["mat"][h][chest]
        for part in ARM_CHAIN:
            sb, db = P + src + part, P + dst + part
            # The source bone with the chest at rest, mirrored, then put on the chest of frame g.
            X = rest[chest] @ C_h.inverted() @ s["mat"][h][sb]
            Xm = S @ (X @ rest[sb].inverted()) @ S @ rest[db]
            loc = pb[db].location.copy()
            pb[db].matrix = C_g @ rest[chest].inverted() @ Xm
            pb[db].location = loc
            bpy.context.view_layer.update()
        if f < n:
            before.append(pb[P + dst + "ForeArm"].matrix.copy())
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name + "_arms"
    return act, {"source_arm": src, "mirrored_arm": dst, "phase_frames": n // 2}


def clip_setup(sk):
    radii = clip_probe.capsule_radii(sk.arm, sk.mesh)
    boxes = clip_probe.skate_boxes(sk.arm, sk.mesh)
    return radii, boxes


def com_path(sk, s, shift, rots, targets):
    hips0 = [s["mat"][f][P + "Hips"] for f in range(s["n"])]
    out = []
    for f in range(s["n"]):
        mats, _ = write_pose(sk, f, s, Matrix.Translation(Vector(shift[f])) @ hips0[f], rots, targets[f])
        out.append(sk.com(mats))
    return np.array(out)


def rebalance(sk, name, s, shift, rots, targets, C_ref, iters=2):
    """After the clip fix: shift the hips until the CoM path is C_ref again."""
    caps = MAX_SHIFT.get(name, MAX_SHIFT_DEFAULT)
    for _ in range(iters):
        err = C_ref - com_path(sk, s, shift, rots, targets)
        shift += err / 0.68
        for axis, cap in enumerate(caps):
            shift[:, axis] = np.clip(shift[:, axis], -cap, cap)
    return float(np.abs(C_ref - com_path(sk, s, shift, rots, targets)).max())


def resolve_clips(sk, s, shift, rots, targets, radii, boxes):
    """Moves skates and upper arms until the limbs are clear. Returns info."""
    n = s["n"]
    foot_off = {sd: np.zeros((n, 3)) for sd in ("Left", "Right")}
    arm_deg = {sd: np.zeros(n) for sd in ("Left", "Right")}
    arm_axis = {sd: [Vector((0, 1, 0))] * n for sd in ("Left", "Right")}
    hips0 = [s["mat"][f][P + "Hips"] for f in range(n)]
    zs = {sd: np.array([float(s["skate"][f][sd][:, 2].min()) for f in range(n)]) for sd in ("Left", "Right")}
    base_t = [dict(t) for t in targets]
    base_r = {b: q.copy() for b, q in rots.items()}
    first = None

    def apply():
        for f in range(n):
            tm = dict(base_t[f])
            for sd in ("Left", "Right"):
                for b in ("Foot", "ToeBase"):
                    tm[P + sd + b] = Matrix.Translation(Vector(foot_off[sd][f])) @ base_t[f][P + sd + b]
            targets[f] = tm
        for sd in ("Left", "Right"):
            key = P + sd + "Arm"
            if key not in base_r:
                continue
            for f in range(n):
                q = Quaternion(base_r[key][f])
                if arm_deg[sd][f]:
                    W = Quaternion(arm_axis[sd][f], math.radians(arm_deg[sd][f]))
                    q = q @ local_delta(s, f, key, W)
                rots[key][f] = list(q)

    def measure():
        out = []
        for f in range(n):
            H = Matrix.Translation(Vector(shift[f])) @ hips0[f]
            mats, _ = write_pose(sk, f, s, H, rots, targets[f])
            out.append((mats, clip_probe.overlaps(sk.arm, radii, mats, boxes)))
        return out

    for it in range(CLIP_ITERS + 1):
        res = measure()
        worst = max(max(v - (ARM_CLIP if k in ARM_PAIRS else 0) for k, v in o.items()) for _, o in res)
        if first is None:
            first = {k: round(max(o[k] for _, o in res), 4) for k in res[0][1]}
        if it == CLIP_ITERS or worst <= CLEAR:
            break
        add_f = {sd: np.zeros((n, 3)) for sd in ("Left", "Right")}
        add_a = {sd: np.zeros(n) for sd in ("Left", "Right")}
        for f, (mats, o) in enumerate(res):
            seg = clip_probe.capsule_segments(sk.arm, mats)
            for k, d in o.items():
                if d <= CLEAR:
                    continue
                need = d + CLEAR - 0.0
                if k in LEG_PAIRS:
                    # The skate that is higher (in the air) or moves more is the one that goes.
                    vl = np.linalg.norm(base_t[(f + 1) % n][P + "LeftFoot"].to_translation() - base_t[f - 1][P + "LeftFoot"].to_translation())
                    vr = np.linalg.norm(base_t[(f + 1) % n][P + "RightFoot"].to_translation() - base_t[f - 1][P + "RightFoot"].to_translation())
                    mover = "Left" if (zs["Left"][f] - zs["Right"][f] > 0.01 or (abs(zs["Left"][f] - zs["Right"][f]) <= 0.01 and vl >= vr)) else "Right"
                    other = "Right" if mover == "Left" else "Left"
                    a = (seg[mover[0].lower() + "_shin"][0] + seg[mover[0].lower() + "_shin"][1]) / 2
                    b = (seg[other[0].lower() + "_shin"][0] + seg[other[0].lower() + "_shin"][1]) / 2
                    dvec = np.array([a[0] - b[0], a[1] - b[1], 0.0])
                    if np.linalg.norm(dvec) < 1e-6:
                        dvec = np.array([1.0 if mover == "Left" else -1.0, 0, 0])
                    dvec /= np.linalg.norm(dvec)
                    if need > np.linalg.norm(add_f[mover][f]):
                        add_f[mover][f] = dvec * need
                elif k in ARM_PAIRS and d > ARM_CLIP:
                    sd = ARM_PAIRS[k]
                    shoulder = np.array(mats[P + sd + "Arm"].to_translation())
                    hand = np.array(mats[P + sd + "Hand"].to_translation())
                    thigh = seg[sd[0].lower() + "_thigh"]
                    # Swing the hand away from the nearest point of the thigh,
                    # with a bias out to the side, so the arm never swings into
                    # the body.
                    out = np.array([1.0 if sd == "Left" else -1.0, 0.0, 0.0])
                    t0, t1 = thigh
                    tt = np.clip((hand - t0) @ (t1 - t0) / max((t1 - t0) @ (t1 - t0), 1e-9), 0, 1)
                    away = hand - (t0 + tt * (t1 - t0))
                    away[2] = 0
                    nrm = np.linalg.norm(away)
                    away = (away / nrm if nrm > 1e-6 else out) + 0.5 * out
                    arm_dir = hand - shoulder
                    axis = Vector(np.cross(arm_dir, away))
                    if axis.length < 1e-6:
                        continue
                    arm_axis[sd][f] = axis.normalized()
                    add_a[sd][f] = max(add_a[sd][f], math.degrees((d - ARM_CLIP + CLEAR) / max(np.linalg.norm(arm_dir), 0.2)))
        for sd in ("Left", "Right"):
            f_new = foot_off[sd] + add_f[sd]
            mag = np.linalg.norm(f_new, axis=1)
            sm = circ_gauss(f_new, 1.5)
            smag = np.linalg.norm(sm, axis=1)
            scale = np.where(smag > 1e-9, np.maximum(mag, smag) / np.maximum(smag, 1e-9), 0)
            foot_off[sd] = sm * np.minimum(scale, 3)[:, None]
            a_new = arm_deg[sd] + add_a[sd]
            arm_deg[sd] = np.maximum(a_new, circ_gauss(a_new, 1.5))
        apply()
    last = {k: round(max(o[k] for _, o in res), 4) for k in res[0][1]}
    return {"overlap_max_m_before": {k: v for k, v in first.items() if v > 0},
            "overlap_max_m_after": {k: v for k, v in last.items() if v > 0},
            "skate_move_max_m": {sd: round(float(np.linalg.norm(foot_off[sd], axis=1).max()), 4) for sd in foot_off},
            "arm_swing_out_max_deg": {sd: round(float(arm_deg[sd].max()), 1) for sd in arm_deg}}


def support_pass(sk, who, name, s):
    """A new action with the support skate flat and rolled under the CoM."""
    cfg = SUPPORT.get(who, {}).get(name)
    if not cfg:
        return None, None
    n = s["n"]
    C = np.array([sk.com(s["mat"][f]) for f in range(n)])
    z = {sd: np.array([float(s["skate"][f][sd][:, 2].min()) for f in range(n)]) for sd in ("Left", "Right")}
    rest = {sd: sk.arm.data.bones[P + sd + "Foot"].matrix_local.copy() for sd in ("Left", "Right")}

    def heading(M_foot, M_toe):
        v = M_toe.to_translation() - M_foot.to_translation()
        v.z = 0
        return v.normalized()

    single = {sd: np.zeros(n) for sd in ("Left", "Right")}
    for f in range(n):
        for sd, other in (("Left", "Right"), ("Right", "Left")):
            # A drag skate (never higher than DRAG_LIFT) stays on the ground.
            if z[sd][f] < CONTACT <= z[other][f] and z[other].max() >= DRAG_LIFT:
                single[sd][f] = 1.0
    info = {"single_support_frames": {sd: int(single[sd].sum()) for sd in single}}
    if not any(single[sd].any() for sd in single):
        return None, info
    k = cfg["dilate_frames"]
    weight, roll = {}, {}
    for sd in single:
        dil = np.array([max(single[sd][(f + i) % n] for i in range(-k, k + 1)) for f in range(n)])
        weight[sd] = np.clip(circ_gauss(dil, cfg["sigma_frames"]) * 1.25, 0, 1)
        weight[sd] = np.maximum(weight[sd], single[sd])
        r = np.zeros(n)
        for f in range(n):
            if single[sd][f]:
                Mf, Mt = s["mat"][f][P + sd + "Foot"], s["mat"][f][P + sd + "ToeBase"]
                h = heading(Mf, Mt)
                # The middle of the wheelbase: the ankle and the toe, on the ground.
                c = (Mf.to_translation() + Mt.to_translation()) / 2
                half = (Mt.to_translation() - Mf.to_translation()).length
                d = (Vector((C[f, 0], C[f, 1], 0)) - Vector((c.x, c.y, 0))).dot(h)
                lim = cfg["core"] * half
                r[f] = d - min(max(d, -lim), lim)
        dil = np.array([max((r[(f + i) % n] for i in range(-k, k + 1)), key=abs) for f in range(n)])
        sm = circ_gauss(dil, cfg["sigma_frames"])
        roll[sd] = np.where(np.abs(r) > np.abs(sm), r, sm)
    sk.arm.animation_data.action = None
    for f in range(n + 1):
        g = f % n
        tm = dict(s["mat"][g])
        for sd in ("Left", "Right"):
            w = float(weight[sd][g])
            if w <= 0 and abs(roll[sd][g]) < 1e-4:
                continue
            Mf, Mt = s["mat"][g][P + sd + "Foot"], s["mat"][g][P + sd + "ToeBase"]
            h = heading(Mf, Mt)
            h0 = Vector((0, -1, 0))  # the rest foot points forward
            yaw = math.atan2(h0.x * h.y - h0.y * h.x, h0.dot(h))
            flat = (Matrix.Rotation(yaw, 3, "Z") @ rest[sd].to_3x3()).to_quaternion()
            q = Mf.to_quaternion().slerp(flat, w)
            pos = Mf.to_translation() + Vector((h.x, h.y, 0)) * float(roll[sd][g])
            M_new = Matrix.Translation(pos) @ q.to_matrix().to_4x4()
            tm[P + sd + "Foot"] = M_new
            tm[P + sd + "ToeBase"] = M_new @ Mf.inverted() @ Mt
        write_pose(sk, g, s, s["mat"][g][P + "Hips"], {}, tm)
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name + "_support"
    info["roll_max_m"] = {sd: round(float(np.abs(roll[sd]).max()), 3) for sd in roll}
    info["level_weight_max"] = {sd: round(float(weight[sd].max()), 2) for sd in weight}
    return act, info


def build_action(sk, name, s, shift, rots, targets):
    # keyframe_insert makes a new action (with its slot) when none is bound.
    sk.arm.animation_data.action = None
    n = s["n"]
    reach_max = 0.0
    for f in range(n + 1):
        g = f % n
        H = Matrix.Translation(Vector(shift[g])) @ s["mat"][g][P + "Hips"]
        _, reach = write_pose(sk, g, s, H, rots, targets[g])
        reach_max = max(reach_max, *reach.values())
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name
    return act, reach_max


# ---------------------------------------------------------------- mirror

def mirror_name(b):
    if "Left" in b:
        return b.replace("Left", "Right")
    if "Right" in b:
        return b.replace("Right", "Left")
    return b


def mirror_sample(sk, s):
    """The mirror of a sampled clip across the X = 0 plane, as armature-space
    matrices: D' = S D S, M' = D' R', with D = M R^-1 (R: the rest matrix)."""
    S = Matrix.Diagonal((-1, 1, 1, 1))
    rest = {b.name: b.matrix_local.copy() for b in sk.arm.data.bones}
    out = {"n": s["n"], "mat": [], "basis": [], "skate": []}
    for f in range(s["n"]):
        mats = {}
        for b in sk.names:
            src = mirror_name(b)
            D = s["mat"][f][src] @ rest[src].inverted()
            mats[b] = S @ D @ S @ rest[b]
        out["mat"].append(mats)
    return out


def pose_from_mats(sk, mats):
    """Local basis of every bone from armature-space matrices (rotation only,
    the Hips also keep the translation)."""
    pb = sk.pb
    for b in sk.names:
        pb[b].location = (0, 0, 0)
        pb[b].rotation_quaternion = (1, 0, 0, 0)
    bpy.context.view_layer.update()
    # Parents first: the bone order of the armature is parent before child.
    for b in sk.names:
        loc = pb[b].location.copy()
        pb[b].matrix = mats[b]
        if b != P + "Hips":
            pb[b].location = loc
        bpy.context.view_layer.update()
    return {b: (pb[b].location.copy(), pb[b].rotation_quaternion.copy()) for b in sk.names}


def build_mirror(sk, src_action, name):
    s = sk.sample(src_action, with_mesh=False)
    m = mirror_sample(sk, s)
    n = s["n"]
    # The mirrored pose as it is on the rig (rotations only, the Hips also
    # move). The asymmetry of the rest pose moves the feet a little, so the IK
    # solve below puts each foot at its mirrored target.
    real = {"n": n, "basis": [], "mat": []}
    sk.arm.animation_data.action = None
    for f in range(n):
        real["basis"].append(pose_from_mats(sk, m["mat"][f]))
        real["mat"].append({b: sk.pb[b].matrix.copy() for b in sk.names})
    reach_max = 0.0
    for f in range(n + 1):
        g = f % n
        tm = dict(real["mat"][g])
        for side in ("Left", "Right"):
            for b in ("Foot", "ToeBase"):
                tm[P + side + b] = m["mat"][g][P + side + b]
        _, reach = write_pose(sk, g, real, real["mat"][g][P + "Hips"], {}, tm)
        reach_max = max(reach_max, *reach.values())
        key_frame(sk, f)
    act = sk.arm.animation_data.action
    act.name = name
    return act, reach_max


# ---------------------------------------------------------------- main

def main():
    a = args()
    os.makedirs(a.out, exist_ok=True)
    sk = Skater(a.src)
    base = os.path.splitext(os.path.basename(a.src))[0]
    who = sk.arm.name.replace("Rig", "").lower()
    SKATER["who"] = who
    report = {"source": a.src, "skater": who, "settings": {
        "still": STILL, "sigma_frames": SIGMA, "follow": FOLLOW, "max_shift_m": {**MAX_SHIFT, "default": MAX_SHIFT_DEFAULT},
        "contact_m": CONTACT, "support_margin_m": SUPPORT_MARGIN, "body_kg": BODY_KG, "skate_kg": SKATE_KG,
        "recoil": RECOIL, "recoil_skater": RECOIL_SKATER, "stance": STANCE, "arm_mirror": ARM_MIRROR, "support": SUPPORT, "clip_clear_m": CLEAR, "recoil_lead_back_frames": [RECOIL_LEAD, RECOIL_BACK], "recoil_delay_frames": RECOIL_DELAY}, "clips": {}}
    rest = {b: (bn.head_local.x, bn.head_local.y, bn.head_local.z) for b, bn in ((b, sk.arm.data.bones[b]) for b in (P + "LeftFoot", P + "RightFoot"))}
    report["rest_feet"] = rest
    originals = {}
    new = {}
    for name in a.clips.split(","):
        act = bpy.data.actions[name]
        originals[name] = act
        gate0 = joint_limits.gate_action(sk.arm, act)
        s = sk.sample(act)
        m0 = metrics(sk, s)
        arm_act, arm_info = arm_mirror_pass(sk, who, name, s)
        if arm_act:
            s = sk.sample(arm_act)
        sup_act, support_info = support_pass(sk, who, name, s)
        if sup_act:
            s = sk.sample(sup_act)
        stance_info = None
        st_act, stance_info = stance_pass(sk, name, s)
        if st_act:
            s = sk.sample(st_act)
        plan = drive_plan(name, s)
        drive_info = None
        if plan:
            # The physics pass works on the retimed clip; "before" stays the
            # shipped clip.
            src_act = retime(sk, st_act or sup_act or arm_act or act, plan, name + "_drive")
            s0 = s
            s = sk.sample(src_act)
            s["drive"] = plan
            mw = metrics(sk, s)
            drive_info = {"drives": plan["drives"], "ratio": plan["ratio"], "load_m": plan["load"],
                          "drive_skate_peak_speed_ms_before": drive_speed(s0, [{**d, "frames_new": d["frames"]} for d in plan["drives"]]),
                          "drive_skate_peak_speed_ms_after_warp": drive_speed(s, plan["drives"]),
                          "warp": [round(w, 2) for w in plan["warp"]]}
            m_pass = mw
        else:
            m_pass = metrics(sk, s) if (st_act or arm_act or sup_act) else m0
        shift, rots, targets, info = physics_pass(sk, name, s, m_pass)
        if drive_info:
            info["drive"] = drive_info
        if stance_info:
            info["stance"] = stance_info
        if arm_info:
            info["arm_mirror"] = arm_info
        if support_info:
            info["support"] = support_info
        C_ref = com_path(sk, s, shift, rots, targets)
        setup = clip_setup(sk)
        info["clipping"] = resolve_clips(sk, s, shift, rots, targets, *setup)
        info["clipping"]["com_error_after_rebalance_m"] = round(rebalance(sk, name, s, shift, rots, targets, C_ref), 4)
        # The rebalance moves the hips: measure the clips once more.
        hips0 = [s["mat"][f][P + "Hips"] for f in range(s["n"])]
        final = {}
        for f in range(s["n"]):
            mats, _ = write_pose(sk, f, s, Matrix.Translation(Vector(shift[f])) @ hips0[f], rots, targets[f])
            for k, d in clip_probe.overlaps(sk.arm, setup[0], mats, setup[1]).items():
                final[k] = max(final.get(k, 0.0), round(d, 4))
        info["clipping"]["overlap_max_m_final"] = {k: v for k, v in final.items() if v > 0}
        act.name = name + "_before"
        new_act, reach = build_action(sk, name, s, shift, rots, targets)
        new[name] = new_act
        gate1 = joint_limits.gate_action(sk.arm, new_act)
        s1 = sk.sample(new_act)
        m1 = metrics(sk, s1)
        # The skates: the largest move of a skate vertex between before and after.
        moved = max(float(np.abs(s1["skate"][f][side] - s["skate"][f][side]).max()) for f in range(s["n"]) for side in ("Left", "Right"))
        report["clips"][name] = {
            "before": {k: v for k, v in m0.items() if not k.startswith("_")},
            "after": {k: v for k, v in m1.items() if not k.startswith("_")},
            "hips_shift_max_m": [round(float(np.abs(shift[:, i]).max()), 4) for i in range(3)],
            "leg_reach_max": round(reach, 4),
            "skate_vertex_move_max_m": round(moved, 5),
            "joint_limits": {"before": gate0, "after": gate1},
            **info,
        }
        print(f"[physics] {who} {name}: zmp out {m0['zmp_outside_frames']} -> {m1['zmp_outside_frames']} frames, "
              f"fore-aft {m0['com_fore_aft_range_m']} -> {m1['com_fore_aft_range_m']} m, "
              f"jerk {m0['com_jerk_rms_ms3']} -> {m1['com_jerk_rms_ms3']}, skate move {moved:.5f} m, "
              f"recoil {[e['frame'] for e in info['recoil_events']]}, joints {gate0['status']} -> {gate1['status']} {gate1['fail'] or gate1['warn']}")
    if "carve_left" in new and not a.no_mirror:
        old_right = bpy.data.actions.get("carve_right")
        s_old = sk.sample(old_right) if old_right else None
        m_old = metrics(sk, s_old) if s_old else None
        if old_right:
            old_right.name = "carve_right_before"
        gate0 = joint_limits.gate_action(sk.arm, old_right) if old_right else None
        act, reach = build_mirror(sk, new["carve_left"], "carve_right")
        # The rig is not exactly symmetric: the mirror can move a skate into
        # the other leg. Run the clip fix on the mirror too.
        s_m = sk.sample(act)
        nm = s_m["n"]
        shift_m = np.zeros((nm, 3))
        rots_m = {P + b: quat_series(s_m, P + b) for b in ("LeftArm", "RightArm")}
        targets_m = [dict(s_m["mat"][f]) for f in range(nm)]
        mirror_clip = resolve_clips(sk, s_m, shift_m, rots_m, targets_m, *clip_setup(sk))
        act.name = "carve_right_mirror"
        act, _ = build_action(sk, "carve_right", s_m, shift_m, rots_m, targets_m)
        new["carve_right"] = act
        gate1 = joint_limits.gate_action(sk.arm, act)
        s1 = sk.sample(act)
        m1 = metrics(sk, s1)
        report["clips"]["carve_right"] = {
            "method": "mirror of the new carve_left across X = 0, the feet put back by the IK solve",
            "before": {k: v for k, v in m_old.items() if not k.startswith("_")} if m_old else None,
            "after": {k: v for k, v in m1.items() if not k.startswith("_")},
            "leg_reach_max": round(reach, 4),
            "joint_limits": {"before": gate0, "after": gate1},
            "clipping": mirror_clip,
        }
        print(f"[physics] {who} carve_right (mirror): zmp out {m_old and m_old['zmp_outside_frames']} -> {m1['zmp_outside_frames']}, wheel z {m1['wheel_z_min_m']}")
    # Export: the rig, the mesh, and the new clips only, without Draco.
    keep = set(a.name for a in new.values())
    for t in list(sk.arm.animation_data.nla_tracks):
        sk.arm.animation_data.nla_tracks.remove(t)
    for act in list(bpy.data.actions):
        if act.name not in keep:
            bpy.data.actions.remove(act)
    for name, act in new.items():
        track = sk.arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, 0, act)
    sk.arm.animation_data.action = None
    for o in list(bpy.data.objects):
        if o.type not in ("ARMATURE", "MESH"):
            bpy.data.objects.remove(o)
    glb = os.path.join(a.out, f"{who}-physics.glb")
    bpy.ops.export_scene.gltf(
        filepath=glb, export_format="GLB", export_draco_mesh_compression_enable=False,
        export_animations=True, export_animation_mode="NLA_TRACKS", export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=False, export_bake_animation=False,
        export_def_bones=False, export_reset_pose_bones=True, export_apply=False)
    report["glb"] = glb
    report["glb_bytes"] = os.path.getsize(glb)
    with open(os.path.join(a.out, f"{who}-physics.json"), "w") as f:
        json.dump(report, f, indent=1)
    print("[physics] wrote", glb, report["glb_bytes"])


main()
