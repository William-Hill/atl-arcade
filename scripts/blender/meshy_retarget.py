# Retargets a Meshy text-to-motion clip onto a shipped skater rig (#293).
#
# Meshy gives an SMPL-H skeleton (Pelvis, L_Hip, ...) in an FBX file. This
# script:
#   1. imports the shipped skater.glb (Mixamo rig) and the Meshy motion,
#   2. finds the window of the motion that loops best near 2 beats,
#   3. copies the world-space rotation of each SMPL-H bone onto the matching
#      Mixamo bone (the change from the rest pose, so the 2 rest poses can
#      differ a small amount), and scales the hip motion by the leg length,
#   4. closes the loop seam and retimes the window to 2 clip beats
#      (48 frames at 30 fps, the same as the hand-keyed dances),
#   5. holds the wheels on the ground with the leg IK of nia_clips.py (the
#      ankles stay at the rest height, the feet stay flat and keep only the
#      yaw of the motion), and bakes the result to plain bone keys,
#   6. exports a GLB with only the skeleton and the new clip. The game and the
#      viewers bind the clip to a skater by bone name.
#
# Run:
#   blender -b --factory-startup -P scripts/blender/meshy_retarget.py -- \
#     --skater assets/skaters/nia/skater.glb --name nia \
#     --motion /path/to/bankhead.fbx --clip dance_bankhead_meshy \
#     --out assets/dances/meshy-293/bankhead/nia.glb --report /tmp/nia-bankhead.json
#
# --motion takes the Meshy FBX (prime), the Meshy BVH (swift), a Meshy
# animation-library GLB (rigged character), or the source GLB that this script writes with
# --save-source (the Meshy skeleton and motion with no mesh).
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 30
CLIP_FRAMES = 48  # 2 clip beats of 24 frames (ANIM.clipBeat = 0.8 s).
BEATS = 2
REACH = 0.99  # the IK reaches the ankle target at 99 % of the leg length or less.

# SMPL-H joint -> Mixamo bone (without the "mixamorig:" prefix).
CORE = {
    "Pelvis": "Hips", "Spine1": "Spine", "Spine2": "Spine1", "Spine3": "Spine2",
    "Neck": "Neck", "Head": "Head",
}
SIDE = {
    # L_Foot -> ToeBase is not mapped: the skate boot is rigid, so the toe
    # bone stays at its rest pose (the same as the hand-keyed clips).
    "Hip": "UpLeg", "Knee": "Leg", "Ankle": "Foot",
    "Collar": "Shoulder", "Shoulder": "Arm", "Elbow": "ForeArm", "Wrist": "Hand",
}
FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")


# Meshy swift gives a BVH skeleton, and the Meshy rigging and animation API
# gives a third skeleton. Each maps onto the SMPL-H names above. The same name
# can mean another bone: "LeftLeg" is the thigh in the BVH skeleton and the
# shin in the rigged skeleton. Thus the script picks the map by the bone names.
ALIAS_BVH = {"Hips": "Pelvis", "Spine1": "Spine1", "Spine2": "Spine2", "Chest": "Spine3", "Neck1": "Neck", "Head": "Head"}
ALIAS_RIG = {"Hips": "Pelvis", "Spine02": "Spine1", "Spine01": "Spine2", "Spine": "Spine3", "neck": "Neck", "Head": "Head"}
for _s, _full in (("L", "Left"), ("R", "Right")):
    ALIAS_BVH.update({f"{_full}Shoulder": f"{_s}_Collar", f"{_full}Arm": f"{_s}_Shoulder", f"{_full}ForeArm": f"{_s}_Elbow",
                      f"{_full}Hand": f"{_s}_Wrist", f"{_full}Leg": f"{_s}_Hip", f"{_full}Shin": f"{_s}_Knee",
                      f"{_full}Foot": f"{_s}_Ankle", f"{_full}ToeBase": f"{_s}_Foot"})
    ALIAS_RIG.update({f"{_full}Shoulder": f"{_s}_Collar", f"{_full}Arm": f"{_s}_Shoulder", f"{_full}ForeArm": f"{_s}_Elbow",
                      f"{_full}Hand": f"{_s}_Wrist", f"{_full}UpLeg": f"{_s}_Hip", f"{_full}Leg": f"{_s}_Knee",
                      f"{_full}Foot": f"{_s}_Ankle", f"{_full}ToeBase": f"{_s}_Foot"})
    for _f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        for _i in (1, 2, 3):
            ALIAS_BVH[f"{_full}Hand{_f}{_i}"] = f"{_s}_{_f}{_i}"


def alias_for(names):
    if "Pelvis" in names:
        return {}
    if "Spine02" in names:
        return ALIAS_RIG
    if "LeftShin" in names:
        return ALIAS_BVH
    raise SystemExit(f"unknown source skeleton: {sorted(names)[:12]}")


def bone_map():
    m = {k: "mixamorig:" + v for k, v in CORE.items()}
    for s, full in (("L", "Left"), ("R", "Right")):
        for k, v in SIDE.items():
            m[f"{s}_{k}"] = f"mixamorig:{full}{v}"
        for f in FINGERS:
            for i in (1, 2, 3):
                m[f"{s}_{f}{i}"] = f"mixamorig:{full}Hand{f}{i}"
    return m


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--skater", required=True)
    p.add_argument("--name", required=True)
    p.add_argument("--motion", required=True)
    p.add_argument("--clip", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--report", default="")
    p.add_argument("--save-source", default="", help="write the Meshy skeleton and motion (no mesh) to this GLB")
    p.add_argument("--min-frames", type=int, default=24, help="shortest window (source frames)")
    p.add_argument("--max-frames", type=int, default=64, help="longest window (source frames)")
    p.add_argument("--start", type=int, default=-1, help="force the window start (source frame)")
    p.add_argument("--length", type=int, default=-1, help="force the window length (source frames)")
    return p.parse_args(argv)


def decompose(m):
    loc, rot, _ = m.decompose()
    return loc, rot.normalized()


def import_motion(path):
    before = set(bpy.data.objects)
    low = path.lower()
    if low.endswith(".fbx"):
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    elif low.endswith(".bvh"):
        # Meshy swift gives a BVH file in centimetres.
        bpy.ops.import_anim.bvh(filepath=path, global_scale=0.01, use_fps_scale=False, update_scene_fps=False,
                                update_scene_duration=False, rotate_mode="NATIVE")
    else:
        bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE" and ("Pelvis" in o.data.bones or "Hips" in o.data.bones))
    keep = {arm}
    p = arm.parent
    while p:
        keep.add(p)
        p = p.parent
    for o in new:
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    act = arm.animation_data.action
    lo, hi = (int(round(v)) for v in act.frame_range)
    return arm, act, lo, hi


def sample_source(arm, lo, hi):
    # World-space (metres) location and rotation of each source joint per frame.
    scene = bpy.context.scene
    alias = alias_for({b.name for b in arm.data.bones})
    frames = []
    for f in range(lo, hi + 1):
        scene.frame_set(f)
        mw = arm.matrix_world
        frames.append({alias.get(pb.name, pb.name): decompose(mw @ pb.matrix) for pb in arm.pose.bones})
    rest = {alias.get(b.name, b.name): decompose(arm.matrix_world @ b.matrix_local) for b in arm.data.bones}
    # Turn the source so that its rest pose faces -Y, the same as the skater.
    # The rest facing is at a right angle to the line from the right hip joint
    # to the left hip joint (the toe joints of a rig can be off). Turn only
    # above 2 degrees.
    fwd = (rest["L_Hip"][0] - rest["R_Hip"][0]).cross(Vector((0, 0, 1)))
    face = Quaternion(Vector((0, 0, 1)), -math.atan2(fwd.x, -fwd.y))
    if abs(face.angle) > math.radians(2):
        print(f"[meshy] source rest faces {math.degrees(face.angle):.1f} deg off -Y; turned")
        rest = {k: (face @ l, (face @ q).normalized()) for k, (l, q) in rest.items()}
        frames = [{k: (face @ l, (face @ q).normalized()) for k, (l, q) in fr.items()} for fr in frames]
    return frames, rest


def yaw_of(q):
    # Yaw of the body forward axis. The rest pose faces -Y.
    f = q @ Vector((0, -1, 0))
    return math.atan2(f.x, -f.y)


def feature(fr):
    # Joint positions relative to the pelvis, plus the pelvis height.
    p, _ = fr["Pelvis"]
    out = []
    for n in ("L_Wrist", "R_Wrist", "L_Elbow", "R_Elbow", "L_Ankle", "R_Ankle", "L_Knee", "R_Knee", "Head"):
        out.append(fr[n][0] - p)
    out.append(Vector((0, 0, p.z)))
    return out


def pick_window(frames, lo_len, hi_len, force_start, force_len):
    target = round(BEATS * 60 / 100 * FPS)  # 2 beats at the game tempo (100 BPM) = 36 frames.
    feats = [feature(fr) for fr in frames]
    n = len(frames)

    def cost(s, L):
        return sum((a - b).length for a, b in zip(feats[s], feats[s + L]))

    if force_start >= 0 and force_len > 0:
        return force_start, force_len, cost(force_start, force_len), []
    best = None
    table = []
    for L in range(lo_len, hi_len + 1):
        # Skip the first 6 frames: the motion can start from a rest pose.
        for s in range(6, n - L):
            c = cost(s, L) + 0.004 * abs(L - target)
            table.append((c, s, L))
            if best is None or c < best[0]:
                best = (c, s, L)
    table.sort()
    return best[1], best[2], best[0], table[:5]


def slerp_list(a, b, t):
    if a.dot(b) < 0:
        b = -b
    return a.slerp(b, t)


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS

    # The skater: keep the armature and the skinned mesh, remove the clips.
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.skater))
    tgt = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    mesh = next(o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers))
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    title = a.name.capitalize()
    tgt.name, mesh.name = title + "Rig", title
    if tgt.animation_data:
        tgt.animation_data.action = None
        for t in list(tgt.animation_data.nla_tracks):
            tgt.animation_data.nla_tracks.remove(t)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)

    src, src_act, lo, hi = import_motion(os.path.abspath(a.motion))
    print(f"[meshy] source {src.name}: frames {lo}..{hi}")
    if a.save_source:
        for o in bpy.context.scene.objects:
            o.select_set(o == src or (src.parent is not None and o == src.parent))
        bpy.ops.export_scene.gltf(filepath=os.path.abspath(a.save_source), export_format="GLB", use_selection=True,
                                  export_animations=True, export_animation_mode="ACTIVE_ACTIONS",
                                  export_force_sampling=True, export_yup=True, export_extras=False)
        print(f"[meshy] wrote source {a.save_source}, {os.path.getsize(a.save_source)} bytes")

    frames, srest = sample_source(src, lo, hi)
    start, length, seam_cost, top = pick_window(frames, a.min_frames, a.max_frames, a.start, a.length)
    bpm = BEATS * 60 * FPS / length
    print(f"[meshy] window start {start} length {length} (source tempo {bpm:.1f} BPM), seam cost {seam_cost:.3f}")
    win = frames[start:start + length + 1]

    # Face the motion to -Y: remove the mean pelvis yaw of the window.
    yaws = [yaw_of(fr["Pelvis"][1] @ srest["Pelvis"][1].inverted()) for fr in win]
    mean_yaw = math.atan2(sum(math.sin(y) for y in yaws), sum(math.cos(y) for y in yaws))
    turn = Quaternion(Vector((0, 0, 1)), -mean_yaw)

    # The hip motion scales by the leg length (hip joint to ankle).
    def leg(rest, hip, ankle):
        return (rest[hip][0] - rest[ankle][0]).length

    trest = {b.name: decompose(b.matrix_local) for b in tgt.data.bones}
    ratio = leg(trest, "mixamorig:LeftUpLeg", "mixamorig:LeftFoot") / leg(srest, "L_Hip", "L_Ankle")
    s_ground_rest = min(srest[n][0].z for n in ("L_Ankle", "R_Ankle"))
    s_hip_h = srest["Pelvis"][0].z - s_ground_rest
    # The ground of the motion: the lowest ankle in the window.
    s_ground = min(fr[n][0].z for fr in win for n in ("L_Ankle", "R_Ankle"))
    p0, p1 = win[0]["Pelvis"][0], win[-1]["Pelvis"][0]

    bmap = bone_map()
    inv = {v: k for k, v in bmap.items()}
    order = []  # target bones, parents first

    def walk(b):
        order.append(b)
        for c in b.children:
            walk(c)

    walk(next(b for b in tgt.data.bones if b.parent is None))

    # Retarget each window frame to local quaternions + the hips location.
    hips_rest_loc, hips_rest_rot = trest["mixamorig:Hips"]
    keys = []
    for i, fr in enumerate(win):
        t = i / length
        world = {}
        local = {}
        for b in order:
            rb = trest[b.name][1]
            sname = inv.get(b.name)
            if sname and sname in fr:
                qs = turn @ fr[sname][1]
                qw = qs @ srest[sname][1].inverted() @ rb
            else:
                qp = world[b.parent.name]
                rp = trest[b.parent.name][1]
                qw = qp @ rp.inverted() @ rb
            world[b.name] = qw
            if b.parent is None:
                local[b.name] = rb.inverted() @ qw
            else:
                rp = trest[b.parent.name][1]
                local[b.name] = (rb.inverted() @ rp @ world[b.parent.name].inverted() @ qw).normalized()
        # Hips: drift removed (straight line from the first to the last frame),
        # height above the ground scaled to the skater.
        pc = fr["Pelvis"][0] - (p0.lerp(p1, t))
        pc = turn @ Vector((pc.x, pc.y, 0))
        h = (fr["Pelvis"][0].z - s_ground - s_hip_h) * ratio
        hips_world = hips_rest_loc + Vector((pc.x * ratio, pc.y * ratio, h))
        keys.append((local, hips_world))

    # Close the loop seam: spread the end-to-start error over the window.
    first, last = keys[0], keys[-1]
    for name in first[0]:
        q0, qL = first[0][name], last[0][name]
        if q0.dot(qL) < 0:
            qL = -qL
        err = q0 @ qL.inverted()
        for i, (loc_q, _) in enumerate(keys):
            loc_q[name] = (slerp_list(Quaternion(), err, i / length) @ loc_q[name]).normalized()
    dz = first[1] - last[1]
    keys = [(q, hw + dz * (i / length)) for i, (q, hw) in enumerate(keys)]

    # Retime the window to CLIP_FRAMES frames.
    out = []
    for f in range(CLIP_FRAMES + 1):
        x = f * length / CLIP_FRAMES
        i = min(int(math.floor(x)), length - 1)
        u = x - i
        qa, ha = keys[i]
        qb, hb = keys[i + 1]
        out.append(({n: slerp_list(qa[n], qb[n], u) for n in qa}, ha.lerp(hb, u)))

    # Key the FK pose, then put the leg IK on top and bake.
    g = {"__name__": "skater_clips", "SKATER_CFG": {"arm": tgt.name, "mesh": mesh.name, "feet": (0, 0, 0)}}
    with open(os.path.join(HERE, "nia_clips.py")) as fh:
        exec(compile(fh.read(), "nia_clips.py", "exec"), g)
    ik = g["setup_ik"](tgt)
    tgt.animation_data_create()
    fk = bpy.data.actions.new(a.clip + "_src")
    tgt.animation_data.action = fk
    for side in ("L", "R"):
        for j, kind in ((0, "_ik_"), (1, "_pole_")):
            ik[side][j].animation_data_create()
            ik[side][j].animation_data.action = bpy.data.actions.new(a.clip + kind + side)
    for pb in tgt.pose.bones:
        pb.rotation_mode = "QUATERNION"
    hips_pb = tgt.pose.bones["mixamorig:Hips"]

    # The IK is off while the FK pose is read, so the ankle and knee
    # positions are those of the motion.
    def ik_on(on):
        for side in ("Left", "Right"):
            for c in tgt.pose.bones[f"mixamorig:{side}Leg"].constraints:
                c.mute = not on
            for c in tgt.pose.bones[f"mixamorig:{side}Foot"].constraints:
                c.mute = not on

    lift = {"L": [], "R": []}
    drops = []
    for f, (q, hw) in enumerate(out):
        ik_on(False)
        for pb in tgt.pose.bones:
            pb.rotation_quaternion = q.get(pb.name, Quaternion())
            pb.location = Vector()
        hips_pb.location = hips_rest_rot.inverted() @ (hw - hips_rest_loc)
        bpy.context.view_layer.update()
        # If an ankle target on the ground is out of reach of the leg, lower
        # the hips by the needed amount, so the IK can plant the wheels.
        drop = 0.0
        plant = {}
        for full in ("Left", "Right"):
            up = tgt.pose.bones[f"mixamorig:{full}UpLeg"]
            foot = tgt.pose.bones[f"mixamorig:{full}Foot"]
            hip = (tgt.matrix_world @ up.matrix).to_translation()
            ank = (tgt.matrix_world @ foot.matrix).to_translation()
            ank.z = trest[foot.name][0].z
            reach = REACH * (up.bone.length + tgt.pose.bones[f"mixamorig:{full}Leg"].bone.length)
            dxy = math.hypot(hip.x - ank.x, hip.y - ank.y)
            # A lower hip cannot help an ankle that is horizontally out of
            # reach. Move that ankle target toward the hip, into reach.
            if dxy >= reach:
                k = REACH * reach / dxy
                ank.x = hip.x + (ank.x - hip.x) * k
                ank.y = hip.y + (ank.y - hip.y) * k
                dxy = REACH * reach
            plant[full] = (ank.x, ank.y)
            need = (hip.z - ank.z) - math.sqrt(reach * reach - dxy * dxy)
            drop = max(drop, need)
        if drop > 0:
            hw = hw - Vector((0, 0, drop))
            hips_pb.location = hips_rest_rot.inverted() @ (hw - hips_rest_loc)
            bpy.context.view_layer.update()
        drops.append(drop)
        for pb in tgt.pose.bones:
            pb.keyframe_insert("rotation_quaternion", frame=f)
        hips_pb.keyframe_insert("location", frame=f)
        hips_q = (tgt.matrix_world @ hips_pb.matrix).to_quaternion()
        hips_yaw = yaw_of(hips_q @ hips_rest_rot.inverted())
        for side, full in (("L", "Left"), ("R", "Right")):
            tgt_o, pole, rest_m, pole_rest = ik[side]
            foot = tgt.pose.bones[f"mixamorig:{full}Foot"]
            fm = tgt.matrix_world @ foot.matrix
            ankle = fm.to_translation()
            lift[side].append(ankle.z - rest_m.to_translation().z)
            # Flat foot: keep only the yaw of the motion.
            fyaw = yaw_of(fm.to_quaternion() @ trest[foot.name][1].inverted())
            rq = Quaternion(Vector((0, 0, 1)), fyaw)
            pos = Vector((plant[full][0], plant[full][1], rest_m.to_translation().z))
            tgt_o.matrix_world = Matrix.Translation(pos) @ rq.to_matrix().to_4x4() @ rest_m.to_3x3().to_4x4()
            tgt_o.keyframe_insert("location", frame=f)
            tgt_o.keyframe_insert("rotation_euler", frame=f)
            # The knee points along the hips yaw, from the hips position.
            hturn = Matrix.Rotation(hips_yaw, 3, "Z")
            pole.location = hw + hturn @ (pole_rest - hips_rest_loc)
            pole.keyframe_insert("location", frame=f)
    ik_on(True)

    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, CLIP_FRAMES
    bpy.context.view_layer.objects.active = tgt
    for o in bpy.context.view_layer.objects:
        o.select_set(o == tgt)
    with bpy.context.temp_override(**g["view3d_context"]()):
        bpy.ops.object.mode_set(mode="POSE")
        bpy.ops.pose.select_all(action="SELECT")
        bpy.ops.nla.bake(frame_start=0, frame_end=CLIP_FRAMES, only_selected=False, visual_keying=True,
                         clear_constraints=False, use_current_action=False, bake_types={"POSE"})
        bpy.ops.object.mode_set(mode="OBJECT")
    baked = tgt.animation_data.action
    baked.name = a.clip
    baked.use_fake_user = True
    track = tgt.animation_data.nla_tracks.new()
    track.name = a.clip
    track.strips.new(a.clip, 0, baked)
    track.mute = True
    tgt.animation_data.action = None
    for act in list(bpy.data.actions):
        if act is not baked and act.name.startswith(a.clip + "_"):
            bpy.data.actions.remove(act)
    g["clear_rig"](tgt)
    removed = g["prune_static_channels"]()

    # Check the result: the wheel height (ankle z minus rest) in the baked clip.
    tgt.animation_data.action = baked
    wheel = []
    for f in range(CLIP_FRAMES + 1):
        scene.frame_set(f)
        for full in ("Left", "Right"):
            pb = tgt.pose.bones[f"mixamorig:{full}Foot"]
            wheel.append((tgt.matrix_world @ pb.head).z - pb.bone.head_local.z)
    tgt.animation_data.action = None

    # Export only the skeleton and the clip.
    bpy.data.objects.remove(src, do_unlink=True)
    for o in list(bpy.data.objects):
        if o is not tgt and o.type != "ARMATURE":
            bpy.data.objects.remove(o, do_unlink=True)
    for pb in tgt.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    scene.frame_set(0)
    for o in bpy.context.view_layer.objects:
        o.select_set(o is tgt)
    outp = os.path.abspath(a.out)
    os.makedirs(os.path.dirname(outp), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=outp, export_format="GLB", use_selection=True, export_skins=False, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=False, export_optimize_animation_size=True,
        export_anim_slide_to_zero=True, export_reset_pose_bones=True, export_extras=False, export_yup=True,
    )
    report = {
        "skater": a.name, "clip": a.clip, "source_frames": [lo, hi],
        "window": {"start": start, "length": length, "source_bpm": round(bpm, 1), "seam_cost": round(seam_cost, 4),
                   "candidates": [{"cost": round(c, 4), "start": s, "length": L} for c, s, L in top]},
        "facing_turn_deg": round(math.degrees(-mean_yaw), 1), "leg_ratio": round(ratio, 4),
        "clip_frames": CLIP_FRAMES, "fps": FPS, "static_curves_removed": removed,
        "fk_ankle_lift_m": {s: [round(min(v), 3), round(max(v), 3)] for s, v in lift.items()},
        "hips_drop_for_reach_m": round(max(drops), 4),
        "baked_ankle_lift_m": [round(min(wheel), 4), round(max(wheel), 4)],
        "bytes": os.path.getsize(outp),
    }
    print("[meshy] report " + json.dumps(report))
    if a.report:
        with open(a.report, "w") as fh:
            json.dump(report, fh, indent=2)


main()
