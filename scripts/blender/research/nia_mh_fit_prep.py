"""Make the MetaHuman conform target for the bare Nia (research spike).

Blender 5.2, headless:
  Blender -b --factory-startup -P scripts/blender/research/nia_mh_fit_prep.py -- \
      --body nia-body-hd.glb --head nia-head-hd.glb --out ~/Development/nia-fit

Steps:
1. Import the Tripo body (HD) and the separate Tripo head (HD, 58k faces).
2. Scale the body to HEIGHT_M, center it on x and y, put the soles on z = 0.
3. Align the head to the head of the body: bounding-box start, then a scaled ICP
   (Umeyama) on the points above the neck.
4. Cut the body above the neck line and put the aligned head there (the conform
   uses the surface as a point target, so the seam can stay open).
5. Decimate the body part to BODY_FACES, export GLB and FBX.
6. Render the front portrait and write its camera (Crossroads portrait.py rules).
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, kdtree

HEIGHT_M = 1.70
BODY_FACES = 200000
argv = sys.argv[sys.argv.index("--") + 1:]
args = dict(zip(argv[::2], argv[1::2]))
OUT = os.path.expanduser(args["--out"])
os.makedirs(OUT, exist_ok=True)
report = {}

bpy.ops.wm.read_factory_settings(use_empty=True)


def import_mesh(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.expanduser(path))
    new = [o for o in bpy.data.objects if o not in before]
    mesh = [o for o in new if o.type == "MESH"][0]
    bpy.ops.object.select_all(action="DESELECT")
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o is not mesh:
            bpy.data.objects.remove(o)
    bm = bmesh.new(); bm.from_mesh(mesh.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(mesh.data); bm.free()
    return mesh


def coords(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def set_coords(o, a):
    o.data.vertices.foreach_set("co", a.reshape(-1))
    o.data.update()


body = import_mesh(args["--body"])
head = import_mesh(args["--head"])

# 1. body to height, centered
b = coords(body)
s = HEIGHT_M / (b[:, 2].max() - b[:, 2].min())
b = b * s
b[:, 0] -= (b[:, 0].max() + b[:, 0].min()) / 2
b[:, 1] -= (b[:, 1].max() + b[:, 1].min()) / 2
b[:, 2] -= b[:, 2].min()
set_coords(body, b)
report["body_scale"] = s
report["body_size_m"] = (b.max(0) - b.min(0)).round(4).tolist()

# 2. neck line: the narrowest x width of the body between 0.78 and 0.90 of the height
zs = np.linspace(0.78 * HEIGHT_M, 0.90 * HEIGHT_M, 40)
cen = np.abs(b[:, 0]) < 0.12  # ignore the arms
widths = []
for z in zs:
    sl = b[cen & (np.abs(b[:, 2] - z) < 0.005)]
    widths.append(np.ptp(sl[:, 0]) if len(sl) else 9)
neck_z = float(zs[int(np.argmin(widths))])
report["neck_z_m"] = neck_z

# 3. head alignment: target = body points above the neck
tgt = b[(b[:, 2] > neck_z) & cen]
h = coords(head)
src_all = h.copy()
# the head mesh has shoulders; use its own top part with the same height ratio
h_top = h[:, 2].max()
tgt_h = tgt[:, 2].max() - neck_z
# first guess: scale by the skull width, then put the tops together
def width_at(a, z0, z1):
    sl = a[(a[:, 2] > z0) & (a[:, 2] < z1)]
    return np.ptp(sl[:, 0])
tw = width_at(tgt, tgt[:, 2].max() - 0.06, tgt[:, 2].max() - 0.04)
hw = width_at(h, h_top - 0.06 * (np.ptp(h[:, 0]) / 0.3), h_top - 0.04 * (np.ptp(h[:, 0]) / 0.3))
sc = tw / hw
h = h * sc
h[:, 0] += tgt[:, 0].mean() - (h[:, 0].max() + h[:, 0].min()) / 2
h[:, 2] += tgt[:, 2].max() - h[:, 2].max()
tgt_front = tgt[tgt[:, 2] > neck_z + 0.03]
h[:, 1] += np.median(tgt_front[:, 1]) - np.median(h[h[:, 2] > neck_z + 0.03][:, 1])

kd = kdtree.KDTree(len(tgt))
for i, p in enumerate(tgt):
    kd.insert(Vector(p), i)
kd.balance()
R_tot, t_tot, s_tot = np.eye(3), np.zeros(3), 1.0
rng = np.random.default_rng(0)
for it in range(40):
    m = h[:, 2] > neck_z + 0.02
    idx = np.nonzero(m)[0]
    idx = rng.choice(idx, min(6000, len(idx)), replace=False)
    P = h[idx]
    Q = np.array([kd.find(Vector(p))[0] for p in P])
    d = np.linalg.norm(P - Q, axis=1)
    keep = d < np.percentile(d, 85)
    P, Q = P[keep], Q[keep]
    mp, mq = P.mean(0), Q.mean(0)
    Pc, Qc = P - mp, Q - mq
    U, S, Vt = np.linalg.svd(Qc.T @ Pc / len(P))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    sig = (Pc ** 2).sum() / len(P)
    sk = np.trace(np.diag(S) @ D) / sig
    t = mq - sk * R @ mp
    h = (sk * (R @ h.T)).T + t
    report.setdefault("icp_mean_mm", []).append(round(float(d[keep].mean() * 1000), 3))
set_coords(head, h)
report["head_scale_total"] = float(np.linalg.norm(h[1] - h[0]) / max(np.linalg.norm(src_all[1] - src_all[0]), 1e-9))

# 4. cut: body keeps z < neck_z (and the arms), head keeps z >= neck_z - 0.01
def cut(o, keep_fn):
    bm = bmesh.new(); bm.from_mesh(o.data)
    dead = [v for v in bm.verts if not keep_fn(v.co)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(o.data); bm.free()
cut(body, lambda c: c.z < neck_z or abs(c.x) > 0.12)
cut(head, lambda c: c.z >= neck_z - 0.01)

# 5. decimate the body part, join, export
d = body.modifiers.new("d", "DECIMATE")
d.ratio = min(1.0, BODY_FACES / len(body.data.polygons))
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_apply(modifier="d")
report["body_faces"] = len(body.data.polygons)
report["head_faces"] = len(head.data.polygons)
bpy.ops.object.select_all(action="DESELECT")
head.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
fit = bpy.context.view_layer.objects.active
fit.name = "nia_fitbody"
report["fit_verts"] = len(fit.data.vertices)
report["fit_faces"] = len(fit.data.polygons)
base = f"{OUT}/nia-fitbody-1p70m-v01"
bpy.ops.export_scene.gltf(filepath=base + ".glb", use_selection=True)
bpy.ops.export_scene.fbx(filepath=base + ".fbx", use_selection=True, path_mode="COPY", embed_textures=True)

# 6. portrait (Crossroads portrait.py: camera 0.75 m in front, 40 deg hfov, 1024 px)
vs = coords(fit)
hd = vs[vs[:, 2] > 1.50]
nose = hd[np.argmin(hd[:, 1])]
sc_ = bpy.context.scene
sc_.render.engine = "BLENDER_WORKBENCH"
sh = sc_.display.shading; sh.light = "STUDIO"; sh.color_type = "TEXTURE"; sh.show_specular_highlight = False
sc_.view_settings.view_transform = "Standard"
sc_.render.resolution_x = sc_.render.resolution_y = 1024
sc_.world = bpy.data.worlds.new("w")
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc_.collection.objects.link(cam); sc_.camera = cam
ez = float(nose[2] + 0.04)
cam.location = (0, -0.75, ez); cam.rotation_euler = (math.pi / 2, 0, 0)
cam.data.sensor_fit = "HORIZONTAL"; cam.data.angle = math.radians(40)
sc_.render.filepath = f"{OUT}/nia-fitbody-portrait-v01.png"
bpy.ops.render.render(write_still=True)
cam_json = {"blender_camera_m": [0, -0.75, ez], "looks": "+Y", "hfov_deg": 40, "res": [1024, 1024],
            "ue_camera_cm_if_y_flipped": [0, 75.0, round(ez * 100, 3)], "ue_yaw_deg": -90,
            "nose_blender_m": nose.tolist()}
json.dump(cam_json, open(f"{OUT}/portrait_camera.json", "w"), indent=1)
report["portrait_camera"] = cam_json
json.dump(report, open(f"{OUT}/prep_report.json", "w"), indent=1)
print("PREP_DONE", json.dumps({k: report[k] for k in report if k != "icp_mean_mm"}), "icp_mm first/last", report["icp_mean_mm"][0], report["icp_mean_mm"][-1])
