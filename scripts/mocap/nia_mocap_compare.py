# Compares a mocap test clip with a shipped clip of Nia: renders at 3 points
# of each loop (side and front view, level orthographic cameras, so the ground
# is a line and a wheel under it is easy to see), and measures both clips the
# same way.
#
# Metrics (each clip, each frame):
#   penetration: the lowest skate point under the ground (m, negative).
#   hover: frames where the lower skate is more than 1 cm above the ground.
#   jitter: the RMS of the second difference of the ankle, wrist, and head
#     positions, in m/s^2. Noise of a capture shows as a high value.
#   skid: the game moves the body forward at --speed m/s. A skate on the
#     ground can roll only along its own length. The sideways speed of a
#     grounded skate (m/s) is skid. The mean and the 95th percentile.
#   seam: the largest change of joint speed between the last step of the
#     loop and the first step (m/s). A high value is a visible hitch.
#
# Run:
#   blender -b --factory-startup -P scripts/mocap/nia_mocap_compare.py -- \
#     --ref assets/skaters/nia/skater.glb --ref-clip push \
#     --mocap assets/skaters/nia/mocap-test/mocap_test_push.glb --mocap-clip mocap_test_push \
#     --out assets/skaters/nia/mocap-test/compare --speed 3.0
import argparse
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

SIDES = {"L": "Left", "R": "Right"}
TILE_W, TILE_H = 560, 640


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--ref", required=True)
    p.add_argument("--ref-clip", default="push")
    p.add_argument("--mocap", required=True)
    p.add_argument("--mocap-clip", default="mocap_test_push")
    p.add_argument("--out", required=True)
    p.add_argument("--speed", type=float, default=3.0)
    p.add_argument("--phases", default="0,0.333,0.667")
    p.add_argument("--fps", type=int, default=30)
    return p.parse_args(argv)


def import_skater(path, clip, tag):
    before = set(bpy.data.objects)
    acts_before = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    new = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new if o.type == "ARMATURE")
    mesh = next(o for o in new if o.type == "MESH" and o.find_armature() is arm)
    for o in new:
        if o.type == "MESH" and o is not mesh:
            bpy.data.objects.remove(o, do_unlink=True)
    new_acts = [x for x in bpy.data.actions if x not in acts_before]
    act = next((x for x in new_acts if x.name == clip or x.name.split(".")[0] == clip), None)
    if act is None:
        raise SystemExit(f"clip {clip!r} not in {path}: {[x.name for x in new_acts]}")
    if arm.animation_data:
        for t in arm.animation_data.nla_tracks:
            t.mute = True
    else:
        arm.animation_data_create()
    arm.animation_data.action = act
    if act.slots:
        arm.animation_data.action_slot = act.slots[0]
    arm.name, mesh.name = tag + "Rig", tag
    return arm, mesh, act


def skate_index(mesh):
    out = {}
    for side, full in SIDES.items():
        groups = {f"mixamorig:{full}{b}" for b in ("Foot", "ToeBase", "Toe_End")}
        gi = {g.index for g in mesh.vertex_groups if g.name in groups}
        out[side] = np.array([v.index for v in mesh.data.vertices
                              if sum(g.weight for g in v.groups if g.group in gi) > 0.5])
    return out


def mesh_world(mesh):
    ev = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
    co = np.empty(len(ev.data.vertices) * 3)
    ev.data.vertices.foreach_get("co", co)
    M = np.array(mesh.matrix_world)
    return co.reshape(-1, 3) @ M[:3, :3].T + M[:3, 3]


def measure(arm, mesh, act, speed, fps):
    f0, f1 = (int(round(v)) for v in act.frame_range)
    sk = skate_index(mesh)
    pb = arm.pose.bones
    joints = ["LeftFoot", "RightFoot", "LeftHand", "RightHand", "Head"]
    P, low, foot = [], [], {s: [] for s in SIDES}
    for f in range(f0, f1 + 1):
        bpy.context.scene.frame_set(f)
        m = arm.matrix_world
        P.append([np.array(m @ pb["mixamorig:" + j].head) for j in joints])
        co = mesh_world(mesh)
        low.append([float(co[sk[s], 2].min()) for s in SIDES])
        for s, full in SIDES.items():
            a = m @ pb[f"mixamorig:{full}Foot"].head
            t = m @ pb[f"mixamorig:{full}ToeBase"].tail
            foot[s].append((np.array(a), np.array(t)))
    P, low = np.array(P), np.array(low)
    n = len(P) - 1                                   # the last frame repeats the first
    dt = 1.0 / fps
    acc = (P[2:] - 2 * P[1:-1] + P[:-2]) / dt ** 2
    jitter = float(np.sqrt(np.mean(np.sum(acc ** 2, -1))))
    skids = []
    for k, s in enumerate(SIDES):
        A = np.array([x[0] for x in foot[s]])
        Tt = np.array([x[1] for x in foot[s]])
        vel = (A[1:] - A[:-1]) / dt + np.array([0.0, -speed, 0.0])   # the game moves the body forward (-Y)
        heading = Tt[:-1] - A[:-1]
        heading[:, 2] = 0
        heading /= np.maximum(np.linalg.norm(heading, axis=1, keepdims=True), 1e-9)
        lateral = np.stack([-heading[:, 1], heading[:, 0], np.zeros(len(heading))], 1)
        down = (low[:-1, k] < 0.01) & (low[1:, k] < 0.01)
        skids += list(np.abs(np.sum(vel * lateral, 1))[down])
    v = (P[1:] - P[:-1]) / dt
    seam = float(np.max(np.linalg.norm(v[0] - v[-1], axis=-1)))
    lower = low[:n].min(1)
    return {
        "frames": n, "seconds": round(n / fps, 3),
        "penetration_m": round(float(min(0.0, low[:n].min())), 4),
        "frames_wheel_under_ground_1cm": int(np.sum(low[:n].min(1) < -0.01)),
        "hover_frames_over_1cm": int(np.sum(lower > 0.01)),
        "lowest_skate_range_m": [round(float(lower.min()), 4), round(float(lower.max()), 4)],
        "jitter_rms_m_s2": round(jitter, 2),
        "skid_mean_m_s": round(float(np.mean(skids)), 3) if skids else None,
        "skid_p95_m_s": round(float(np.percentile(skids, 95)), 3) if skids else None,
        "grounded_skate_frames": len(skids),
        "loop_seam_m_s": round(seam, 3),
    }


def setup_render(scene):
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_object_outline = True
    scene.render.resolution_x, scene.render.resolution_y = TILE_W, TILE_H
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("bg")
    world.color = (0.93, 0.93, 0.93)
    scene.world = world
    # A solid slab with its top at z = 0: a wheel under the ground is hidden in it.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, -0.1))
    ground = bpy.context.active_object
    ground.scale = (8, 8, 0.2)
    mat = bpy.data.materials.new("ground")
    mat.diffuse_color = (0.35, 0.38, 0.42, 1)
    ground.data.materials.append(mat)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2.1
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


VIEWS = {
    # Level cameras: the ground is a line in each view.
    "side": ((4.0, 0.0, 0.85), (math.radians(90), 0, math.radians(90))),
    "front": ((0.0, -4.0, 0.85), (math.radians(90), 0, 0)),
}


def label(text, x, z, y=0.0, rot=None):
    cu = bpy.data.curves.new("lbl", "FONT")
    cu.body = text
    cu.size = 0.08
    cu.align_x = "CENTER"
    ob = bpy.data.objects.new("lbl", cu)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = (x, y, z)
    ob.rotation_euler = rot
    mat = bpy.data.materials.new("lbl")
    mat.diffuse_color = (0.05, 0.05, 0.05, 1)
    cu.materials.append(mat)
    return ob


def render_tiles(a, rigs, out_dir):
    scene = bpy.context.scene
    cam = setup_render(scene)
    phases = [float(p) for p in a.phases.split(",")]
    tiles = {}
    for view, (loc, rot) in VIEWS.items():
        cam.location, cam.rotation_euler = loc, rot
        for tag, (arm, mesh, act, title) in rigs.items():
            for other_tag, (oa, om, _, _) in rigs.items():
                om.hide_render = other_tag != tag
            f0, f1 = (int(round(v)) for v in act.frame_range)
            for k, ph in enumerate(phases):
                f = f0 + int(round(ph * (f1 - f0)))
                scene.frame_set(f)
                lb = label(f"{title}  {view}  f{f}/{f1}", 0.0, 1.78, rot=rot)
                path = os.path.join(out_dir, f"tile_{view}_{tag}_{k}.png")
                scene.render.filepath = path
                bpy.ops.render.render(write_still=True)
                bpy.data.objects.remove(lb, do_unlink=True)
                tiles[(view, tag, k)] = path
    return tiles, phases


def compose(tiles, phases, tags, out_path):
    views = list(VIEWS)
    cols = len(phases) * len(tags)
    W, H = TILE_W * cols, TILE_H * len(views)
    sheet = np.ones((H, W, 4), dtype=np.float32)
    for r, view in enumerate(views):
        for k in range(len(phases)):
            for j, tag in enumerate(tags):
                img = bpy.data.images.load(tiles[(view, tag, k)])
                px = np.array(img.pixels[:], dtype=np.float32).reshape(TILE_H, TILE_W, 4)
                c = k * len(tags) + j
                y0 = H - (r + 1) * TILE_H                   # Blender pixels start at the bottom
                sheet[y0:y0 + TILE_H, c * TILE_W:(c + 1) * TILE_W] = px
                bpy.data.images.remove(img)
    out = bpy.data.images.new("sheet", W, H, alpha=True)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = out_path
    out.file_format = "PNG"
    out.save()


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = a.fps
    os.makedirs(a.out, exist_ok=True)
    ref = import_skater(a.ref, a.ref_clip, "Ref")
    moc = import_skater(a.mocap, a.mocap_clip, "Mocap")
    for arm, mesh, act in (ref, moc):
        print(f"[compare] {act.name}: frames {tuple(act.frame_range)}")
    metrics = {a.ref_clip + " (hand-keyed)": measure(*ref, a.speed, a.fps),
               a.mocap_clip + " (GVHMR)": measure(*moc, a.speed, a.fps)}
    metrics["skid_speed_m_s"] = a.speed
    with open(os.path.join(a.out, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=1)
    print(json.dumps(metrics, indent=1))
    rigs = {"ref": (*ref, f"{a.ref_clip} (hand-keyed)"), "mocap": (*moc, f"{a.mocap_clip} (GVHMR)")}
    tiles, phases = render_tiles(a, rigs, a.out)
    sheet = os.path.join(a.out, "compare_sheet.png")
    compose(tiles, phases, list(rigs), sheet)
    for p in tiles.values():
        os.remove(p)
    print(f"[compare] wrote {sheet}")


main()
