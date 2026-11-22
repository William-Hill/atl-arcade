# Makes one in-place, looping skate clip on Nia from a GVHMR retarget
# (motion.npz from squall01337/mixamo-llm-mocap, pipeline/retarget_smplx.py,
# run with the rig profile of scripts/mocap/nia_rig_profile.py).
#
# This is an evaluation tool. It does not change the shipped clips.
#
# Steps:
#   1. Read the local bone rotations and the hips location of motion.npz.
#   2. Find a loop window: two frames 1 to 3 s apart with nearly the same pose.
#   3. Remove the heading drift and the root travel (in place). The linear
#      trend over the loop window comes off, so the loop closes, and the
#      body sway about that line stays.
#   4. Blend the last frames of the loop into the frames before its start,
#      so the last frame is equal to the first frame.
#   5. Put the lower skate on the ground (hips height, smoothed), then move
#      each ankle up or down with a two-bone leg IK: a skate under the ground
#      comes up, and a skate less than 4 cm above the ground goes down to it.
#      The foot keeps its world rotation, so the skate moves as one part.
#   6. Bake one key on each frame for each bone (plain bone keys, no
#      constraints), remove static curves, and export a Draco GLB with only
#      this clip.
#
# Run:
#   blender -b --factory-startup -P scripts/mocap/nia_mocap_clip.py -- \
#     --in assets/skaters/nia/skater.glb --motion clips/skate/motion.npz \
#     --name mocap_test_push --out assets/skaters/nia/mocap-test/mocap_test_push.glb \
#     --report assets/skaters/nia/mocap-test/clip_report.json [--loop auto|START:LEN]
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
HIPS = "mixamorig:Hips"
SIDES = {"L": "Left", "R": "Right"}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--in", dest="src", required=True)
    p.add_argument("--motion", required=True)
    p.add_argument("--name", default="mocap_test_push")
    p.add_argument("--out", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--loop", default="auto", help="auto, or START:LEN in motion frames (0-based)")
    p.add_argument("--min-s", type=float, default=1.0)
    p.add_argument("--max-s", type=float, default=3.0)
    p.add_argument("--blend", type=int, default=6, help="frames of the loop blend")
    p.add_argument("--snap-lo", type=float, default=0.015, help="a skate this near the ground goes fully down")
    p.add_argument("--snap-hi", type=float, default=0.04, help="a skate above this height stays free")
    p.add_argument("--ground-sigma", type=float, default=2.0, help="frames, smoothing of the body height")
    p.add_argument("--smooth-sigma", type=float, default=0.0,
                   help="frames, circular Gaussian on the bone rotations and the hips (0 = off)")
    p.add_argument("--no-draco", action="store_true")
    return p.parse_args(argv)


# ---------------------------------------------------------------------------
# quaternions (w, x, y, z), numpy

def q_norm(q):
    return q / np.linalg.norm(q, axis=-1, keepdims=True)


def q_mul(a, b):
    w1, x1, y1, z1 = np.moveaxis(a, -1, 0)
    w2, x2, y2, z2 = np.moveaxis(b, -1, 0)
    return np.stack([w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
                     w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
                     w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
                     w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2], -1)


def q_slerp(a, b, t):
    a, b = q_norm(a), q_norm(b)
    d = np.sum(a * b, -1, keepdims=True)
    b = np.where(d < 0, -b, b)
    d = np.abs(d)
    t = np.asarray(t, dtype=np.float64)[..., None] if np.ndim(t) else t
    lin = d > 0.9995
    th = np.arccos(np.clip(d, -1, 1))
    s = np.sin(th)
    s = np.where(s < 1e-9, 1.0, s)
    w0 = np.where(lin, 1 - t, np.sin((1 - t) * th) / s)
    w1 = np.where(lin, t, np.sin(t * th) / s)
    return q_norm(w0 * a + w1 * b)


def q_unroll(q):
    q = q.copy()
    for t in range(1, q.shape[0]):
        flip = np.sum(q[t] * q[t - 1], -1) < 0
        q[t, flip] *= -1
    return q


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def gauss_circular(x, sigma):
    if sigma <= 0:
        return x.copy()
    n = len(x)
    r = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = np.zeros_like(x)
    for i, w in zip(range(-r, r + 1), k):
        out += w * np.roll(x, -i, axis=0)
    return out


# ---------------------------------------------------------------------------

def pick_loop(quat, names, fps, min_s, max_s, blend):
    """The loop window [a, a+L) whose end pose is closest to its start pose.
    Legs, spine and arms count; fingers do not."""
    T = quat.shape[0]
    keep = [i for i, n in enumerate(names)
            if any(k in n for k in ("UpLeg", "Leg", "Foot", "Spine", "Arm", "ForeArm", "Hips", "Neck"))
            and "Hand" not in n]
    q = quat[:, keep]
    vel = np.zeros_like(q)
    vel[1:] = q[1:] - q[:-1]
    best = None
    lo, hi = int(round(min_s * fps)), int(round(max_s * fps))
    for L in range(lo, min(hi, T - blend - 1) + 1):
        for a in range(blend, T - L):
            b = a + L
            dot = np.abs(np.sum(q[a] * q[b], -1))
            cost = float(np.mean(1 - dot)) + 0.5 * float(np.mean(np.abs(vel[a] - vel[b])))
            if best is None or cost < best[0]:
                best = (cost, a, L)
    if best is None:
        raise SystemExit(f"motion too short for a {min_s}-{max_s} s loop ({T} frames)")
    return best


def main():
    a = args()
    z = np.load(a.motion, allow_pickle=False)
    names = [str(n) for n in z["bone_names"]]
    quat = q_unroll(q_norm(np.asarray(z["quat"], dtype=np.float64)))
    hips_loc = np.asarray(z["hips_location"], dtype=np.float64)
    fps = float(z["fps"]) if "fps" in z.files else 30.0
    T = quat.shape[0]
    print(f"[mocap] {a.motion}: {T} frames at {fps:.0f} fps, {len(names)} bones")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.src))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and o.find_armature() is arm)
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    if arm.animation_data:
        for t in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(t)
        arm.animation_data.action = None
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    scene = bpy.context.scene
    scene.render.fps = int(round(fps))
    pb = arm.pose.bones
    for p in pb:
        p.rotation_mode = "QUATERNION"
    bi = {n: i for i, n in enumerate(names)}
    missing = [p.name for p in pb if p.name not in bi]
    if missing:
        raise SystemExit(f"motion lacks bones {missing[:5]}")

    # -- loop window ----------------------------------------------------------
    if a.loop == "auto":
        cost, start, L = pick_loop(quat, names, fps, a.min_s, a.max_s, a.blend)
    else:
        start, L = (int(v) for v in a.loop.split(":"))
        cost = None
    if start - a.blend < 0 or start + L >= T:
        raise SystemExit(f"loop {start}:{L} does not fit in {T} frames with a {a.blend}-frame blend")
    print(f"[mocap] loop: motion frames {start}..{start + L} ({L / fps:.2f} s), cost {cost}")

    # -- heading and travel, armature space (= world for this rig) -------------
    hb = arm.data.bones[HIPS]
    R0 = np.array(hb.matrix_local.to_3x3())
    head0 = np.array(hb.head_local)
    hips_q = quat[:, bi[HIPS]]
    pos = head0 + hips_loc @ R0.T                       # hips world position
    D = np.array([R0 @ np.array(Quaternion(q).to_matrix()) @ R0.T for q in hips_q])
    fwd = D @ np.array([0.0, -1.0, 0.0])
    yaw = np.unwrap(np.arctan2(fwd[:, 0], -fwd[:, 1]))   # 0 = facing -Y, + = turned left
    idx = np.arange(T)
    w = slice(start - a.blend, start + L + 1)
    k_yaw, c_yaw = np.polyfit(idx[w], yaw[w], 1)
    yaw_trend = k_yaw * idx + c_yaw
    rel = pos - pos[start]
    # turn the travel and the body by -trend about the vertical axis
    new_pos = np.empty_like(pos)
    new_q = np.empty_like(hips_q)
    for t in range(T):
        Rz = Matrix.Rotation(-yaw_trend[t], 3, "Z")
        new_pos[t] = np.array(Rz) @ rel[t]
        D_new = np.array(Rz) @ D[t]
        new_q[t] = np.array(Matrix(R0.T @ D_new @ R0).to_quaternion())
    new_q = q_unroll(new_q)
    travel = new_pos[start + L, :2] - new_pos[start, :2]
    lin = (idx - start)[:, None] / L * travel[None, :]
    sway = new_pos[:, :2] - lin
    sway -= sway[start:start + L].mean(0)
    new_pos[:, :2] = sway
    new_pos[:, :2] += head0[:2]
    new_pos[:, 2] = pos[:, 2]
    src_speed = float(np.linalg.norm(travel) / (L / fps))
    print(f"[mocap] source travel {np.linalg.norm(travel):.2f} m over the loop ({src_speed:.2f} m/s), "
          f"heading drift {math.degrees(k_yaw) * fps:.1f} deg/s removed")

    quat = quat.copy()
    quat[:, bi[HIPS]] = new_q
    hips_new = (new_pos - head0) @ R0                  # back to the hips bone frame

    # -- loop blend: the end of the loop goes into the frames before its start --
    N = L
    out_q = np.empty((N + 1, len(names), 4))
    out_h = np.empty((N + 1, 3))
    for i in range(N + 1):
        s = start + i
        wgt = smoothstep((i - (N - a.blend)) / a.blend) if i > N - a.blend else 0.0
        out_q[i] = q_slerp(quat[s], quat[s - N], wgt)
        out_h[i] = (1 - wgt) * hips_new[s] + wgt * hips_new[s - N]
    out_q[N] = quat[start]
    out_h[N] = hips_new[start]

    # -- optional smoothing: a circular Gaussian over the loop, so the seam ---
    # stays closed. It runs before the leg IK, so the IK still puts the
    # skates on the ground. A bone whose quaternion path does not close
    # (q[N] = -q[0]) keeps its keys, because the average would break there.
    smoothed_bones = 0
    if a.smooth_sigma > 0:
        q = q_unroll(out_q.copy())
        closed = np.sum(q[N] * q[0], -1) > 0
        sm = q_norm(gauss_circular(q[:N], a.smooth_sigma))
        out_q[:N, closed] = sm[:, closed]
        out_q[N] = out_q[0]
        out_h[:N] = gauss_circular(out_h[:N], a.smooth_sigma)
        out_h[N] = out_h[0]
        smoothed_bones = int(closed.sum())
        print(f"[mocap] smoothing sigma {a.smooth_sigma} frames on {smoothed_bones} of {len(names)} bones")

    # -- ground and leg IK -----------------------------------------------------
    skate = {}
    for side, full in SIDES.items():
        groups = {f"mixamorig:{full}{b}" for b in ("Foot", "ToeBase", "Toe_End")}
        gi = {g.index for g in mesh.vertex_groups if g.name in groups}
        skate[side] = np.array([v.index for v in mesh.data.vertices
                                if sum(g.weight for g in v.groups if g.group in gi) > 0.5])
    if any(len(v) == 0 for v in skate.values()):
        raise SystemExit("no skate vertices found")

    def set_pose(i):
        for p in pb:
            q = out_q[i, bi[p.name]]
            p.rotation_quaternion = Quaternion(q)
            p.location = Vector(out_h[i]) if p.name == HIPS else Vector()
        bpy.context.view_layer.update()

    def skate_low():
        ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
        co = np.empty(len(ev.data.vertices) * 3)
        ev.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3) @ np.array(mesh.matrix_world.to_3x3()).T + np.array(mesh.matrix_world.translation)
        return {s: float(co[ix, 2].min()) for s, ix in skate.items()}

    raw_low = []
    for i in range(N + 1):
        set_pose(i)
        raw_low.append(skate_low())
    lowest = np.array([min(r["L"], r["R"]) for r in raw_low])
    body_dz = -gauss_circular(lowest[:N], a.ground_sigma)
    body_dz = np.append(body_dz, body_dz[0])
    up_axis = np.array(hb.matrix_local.to_3x3().inverted()) @ np.array([0, 0, 1.0])
    out_h += body_dz[:, None] * up_axis[None, :]

    def two_bone(side, dz):
        full = SIDES[side]
        up, lg, ft = pb[f"mixamorig:{full}UpLeg"], pb[f"mixamorig:{full}Leg"], pb[f"mixamorig:{full}Foot"]
        H, K, A = up.head.copy(), lg.head.copy(), ft.head.copy()
        foot_rot = ft.matrix.to_3x3().copy()
        l1, l2 = (K - H).length, (A - K).length
        At = A + Vector((0, 0, dz))
        d_vec = At - H
        d = d_vec.length
        clamped = d > l1 + l2 - 1e-4
        if clamped:
            d = l1 + l2 - 1e-4
            At = H + d_vec.normalized() * d
        u = (At - H).normalized()
        kv = (K - H) - u * (K - H).dot(u)
        if kv.length < 1e-6:
            kv = Vector((0, -1, 0)) - u * u.y
        v = kv.normalized()
        along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        h = math.sqrt(max(l1 * l1 - along * along, 0.0))
        Kn = H + u * along + v * h
        r1 = (K - H).rotation_difference(Kn - H).to_matrix().to_4x4()
        up.matrix = Matrix.Translation(H) @ r1 @ Matrix.Translation(-H) @ up.matrix
        bpy.context.view_layer.update()
        K2, A2 = lg.head.copy(), ft.head.copy()
        r2 = (A2 - K2).rotation_difference(At - K2).to_matrix().to_4x4()
        lg.matrix = Matrix.Translation(K2) @ r2 @ Matrix.Translation(-K2) @ lg.matrix
        bpy.context.view_layer.update()
        m = foot_rot.to_4x4()
        m.translation = ft.head
        ft.matrix = m
        bpy.context.view_layer.update()
        return clamped

    stats = {"lifted": 0, "lowered": 0, "clamped": 0, "max_adjust_m": 0.0}
    final_low = []
    for i in range(N):
        set_pose(i)
        low = skate_low()
        for side in ("L", "R"):
            zf = low[side]
            if zf < 0:
                dz = -zf
                stats["lifted"] += 1
            elif zf < a.snap_hi:
                wgt = 1.0 - smoothstep((zf - a.snap_lo) / (a.snap_hi - a.snap_lo))
                dz = -zf * wgt
                if wgt > 0:
                    stats["lowered"] += 1
            else:
                dz = 0.0
            if abs(dz) > 1e-5:
                stats["clamped"] += int(two_bone(side, dz))
                stats["max_adjust_m"] = max(stats["max_adjust_m"], abs(dz))
        for p in pb:
            out_q[i, bi[p.name]] = np.array(p.rotation_quaternion)
        final_low.append(skate_low())
    out_q[N] = out_q[0]
    out_h[N] = out_h[0]
    final_low.append(final_low[0])
    out_q = q_unroll(out_q)

    # -- bake to plain bone keys -----------------------------------------------
    action = bpy.data.actions.new(a.name)
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    slot = action.slots.new(id_type="OBJECT", name=arm.name)
    arm.animation_data.action_slot = slot
    bag = action.layers.new("Layer").strips.new(type="KEYFRAME").channelbag(slot, ensure=True)
    frames = np.arange(N + 1, dtype=np.float64)

    def key(path, index, group, values):
        fc = bag.fcurves.new(path, index=index)
        fc.group = group
        fc.keyframe_points.add(len(frames))
        co = np.empty(len(frames) * 2)
        co[0::2], co[1::2] = frames, values
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [1] * len(frames))   # LINEAR
        fc.update()

    for p in pb:
        grp = bag.groups.get(p.name) or bag.groups.new(p.name)
        base = f'pose.bones["{p.name}"]'
        for c in range(4):
            key(base + ".rotation_quaternion", c, grp, out_q[:, bi[p.name], c])
        if p.name == HIPS:
            for c in range(3):
                key(base + ".location", c, grp, out_h[:, c])
    action["loop"] = True
    scene.frame_start, scene.frame_end = 0, N

    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": arm.name, "mesh": mesh.name,
                                                   "feet": (0.183, -0.183, -0.017)}}
    with open(os.path.join(REPO, "scripts", "blender", "nia_clips.py")) as f:
        exec(compile(f.read(), "nia_clips.py", "exec"), g)
    removed = g["prune_static_channels"]()
    track = arm.animation_data.nla_tracks.new()
    track.name = a.name
    track.strips.new(a.name, 0, action)
    track.mute = True
    out = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    g["export"](out, not a.no_draco)
    size = os.path.getsize(out)
    print(f"[mocap] wrote {out}, {size} bytes, {N} frames, removed {removed} static curves")

    lows = np.array([[r["L"], r["R"]] for r in final_low[:N]])
    report = {
        "clip": a.name,
        "motion": os.path.basename(a.motion),
        "frames": N, "fps": fps, "seconds": round(N / fps, 3),
        "loop_motion_frames": [int(start), int(start + L)],
        "loop_cost": None if cost is None else round(cost, 5),
        "blend_frames": a.blend,
        "smooth_sigma_frames": a.smooth_sigma,
        "smoothed_bones": smoothed_bones,
        "source_travel_m": round(float(np.linalg.norm(travel)), 3),
        "source_speed_m_s": round(src_speed, 3),
        "heading_drift_removed_deg_s": round(math.degrees(k_yaw) * fps, 2),
        "sway_range_m": [round(float(v), 3) for v in np.ptp(sway[start:start + L], axis=0)],
        "body_ground_shift_m": [round(float(body_dz.min()), 3), round(float(body_dz.max()), 3)],
        "raw_lowest_skate_m": [round(float(lowest.min()), 3), round(float(lowest.max()), 3)],
        "ik": {k: (round(v, 4) if isinstance(v, float) else v) for k, v in stats.items()},
        "final_lowest_skate_m": [round(float(lows.min(1).min()), 4), round(float(lows.min(1).max()), 4)],
        "glb_bytes": size,
    }
    with open(a.report, "w") as f:
        json.dump(report, f, indent=1)
    print(json.dumps(report, indent=1))


main()
