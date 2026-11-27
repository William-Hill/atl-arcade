"""Put Nia's clothes on the conformed MetaHuman (research spike).

Blender 5.2, headless:
  Blender -b --factory-startup -P scripts/blender/research/nia_mh_clothes.py -- \
      --work ~/Development/nia-fit/work-a02 --raw assets/skaters/nia-mh/raw \
      --px ~/Development/nia-fit/garment_px.json --nia-raw assets/skaters/nia/raw/nia-real-tripo.glb \
      --out ~/Development/nia-fit/clothed

Order (the Crossroads garment finding, 2026-11-27):
1. Place each Tripo garment by the pixel boxes of the same-pose images (no guessed scale).
2. Measure the share of garment points inside the body, before any fit work.
3. Copy the body skin weights to each garment (nearest face, interpolated).
4. Hide the body under the cloth with a Mask modifier (a vertex group of the covered skin).
5. Shrinkwrap only the openings (cuffs, hems, collar, waist) onto the body, with a small offset.
Special parts:
- Crop top: a copy of the torso skin in the crop-top band, pushed out 2.5 mm (no Tripo credits).
- Wristband: a tube on the left forearm, near the hand (Blender, no credits).
- Skates: rigid on foot_l / foot_r, plus 8 skate_wheel_* bones at the wheel centers.
- Hair bun: cut from the shipped Tripo Nia (raw), aligned to the MetaHuman head, rigid on head.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix, kdtree
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
A = dict(zip(argv[::2], argv[1::2]))
WORK = os.path.expanduser(A["--work"])
RAW = os.path.expanduser(A["--raw"])
OUT = os.path.expanduser(A["--out"])
os.makedirs(OUT, exist_ok=True)
PX = json.load(open(os.path.expanduser(A["--px"])))
report = {}

# ---- body ---------------------------------------------------------------
bpy.ops.wm.open_mainfile(filepath=f"{WORK}/fit/posed-import.blend")
body = bpy.data.objects["posed_combined_lod0_mesh"]
rig = bpy.data.objects["posed_body_rig"]
for pb in rig.pose.bones:
    pb.matrix_basis.identity()
for o in list(bpy.data.objects):
    if o not in (body, rig):
        bpy.data.objects.remove(o)
for x in body.modifiers:
    if x.type != "ARMATURE":
        x.show_viewport = False; x.show_render = False
# drivers of the Character DNA add-on are not available headless
if body.data.shape_keys and body.data.shape_keys.animation_data:
    body.data.shape_keys.animation_data.drivers.clear() if False else None
rig.animation_data_clear()
bpy.context.view_layer.update()


def coords(o):
    a = np.empty(len(o.data.vertices) * 3)
    o.data.vertices.foreach_get("co", a)
    a = a.reshape(-1, 3)
    M = np.array(o.matrix_world)
    return a @ M[:3, :3].T + M[:3, 3]


BV = coords(body)
body_bvh = BVHTree.FromPolygons([Vector(v) for v in BV], [tuple(p.vertices) for p in body.data.polygons])
H = BV[:, 2].max() - BV[:, 2].min()
report["body_height_m"] = float(H)

# pixels to meters: the body box of image (a) maps to the body height
ba = PX["a-bare-apose.png"]
k = H / (ba["y"][1] - ba["y"][0])
cx = (ba["x"][0] + ba["x"][1]) / 2
ysole = ba["y"][1]
report["m_per_px"] = k


def px_box(x, y):
    return ((x[0] - cx) * k, (x[1] - cx) * k, (ysole - y[1]) * k, (ysole - y[0]) * k)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    big = max(len(o.data.vertices) for o in meshes)
    meshes = [o for o in meshes if len(o.data.vertices) >= 0.01 * big]  # drops stray helper meshes
    bpy.ops.object.select_all(action="DESELECT")
    for m in meshes:
        m.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if len(meshes) > 1:
        bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in new:
        if o.name in bpy.data.objects and o is not m:
            bpy.data.objects.remove(o)
    return m


def place(obj, box, z_from=None, uniform=True):
    v = coords(obj)
    lo, hi = v.min(0), v.max(0)
    X0, X1, Z0, Z1 = box
    if z_from:
        Z0, Z1 = z_from
    sx = (X1 - X0) / (hi[0] - lo[0])
    sz = (Z1 - Z0) / (hi[2] - lo[2])
    if uniform:
        sx = sz = (sx + sz) / 2
    sy = sx
    v = (v - lo) * np.array([sx, sy, sz]) + np.array([X0, 0, Z0])
    # depth: center on the body section that the garment covers
    m = (BV[:, 2] > Z0) & (BV[:, 2] < Z1) & (BV[:, 0] > X0) & (BV[:, 0] < X1)
    yc_body = (np.percentile(BV[m, 1], 2) + np.percentile(BV[m, 1], 98)) / 2
    v[:, 1] += yc_body - (v[:, 1].min() + v[:, 1].max()) / 2
    obj.data.vertices.foreach_set("co", v.reshape(-1))
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()
    bm = bmesh.new(); bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    bm.to_mesh(obj.data); bm.free()
    return {"scale_xyz": [sx, sy, sz], "box_m": [X0, X1, Z0, Z1]}


def inside_share(obj):
    v = coords(obj)
    n_in = 0
    for p in v[::3]:
        loc, nrm, idx, d = body_bvh.find_nearest(Vector(p))
        if loc is not None and (Vector(p) - loc).dot(nrm) < 0:
            n_in += 1
    d = [body_bvh.find_nearest(Vector(p))[3] for p in v[::3]]
    return {"inside_pct": round(100.0 * n_in / len(v[::3]), 2), "mean_dist_mm": round(1000 * float(np.mean(d)), 2)}


def remove_dark_front(o):
    """Delete the faces in the open front of the jacket whose texture is near black.

    The jacket image shows the dark inside through the open front; Tripo made it a closed panel.
    """
    img = None
    for m in o.data.materials:
        for n in m.node_tree.nodes:
            if n.type == "TEX_IMAGE" and n.image and "basecolor" in n.image.name.lower():
                img = n.image
    if img is None:
        return 0
    w, h = img.size
    px = np.array(img.pixels[:]).reshape(h, w, 4)
    uv = o.data.uv_layers.active.data
    bm = bmesh.new(); bm.from_mesh(o.data)
    uvl = bm.loops.layers.uv.active
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.x) > 0.13:
            continue
        u = np.mean([l[uvl].uv.x for l in f.loops]); v = np.mean([l[uvl].uv.y for l in f.loops])
        col = px[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w))), :3]
        if col.max() < 0.12:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data); bm.free()
    return len(dead)


def push_out(o, gap):
    """Move every garment vertex that is inside the skin, or closer than gap, to gap outside it."""
    n = 0
    for v in o.data.vertices:
        p = o.matrix_world @ v.co
        loc, nrm, idx, d = body_bvh.find_nearest(p)
        if loc is None:
            continue
        s = (p - loc).dot(nrm)
        if s < gap and d < 0.08:
            v.co = o.matrix_world.inverted() @ (loc + nrm * gap)
            n += 1
    o.data.update()
    sm = o.modifiers.new("sm", "SMOOTH"); sm.factor = 0.5; sm.iterations = 2
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier="sm")
    return n


garments = {}
for name, file, img, zsheet in (
        ("jacket", "nia-jacket-sm.glb", "c-jacket.png", None),
        ("joggers", "nia-joggers-sm.glb", "c-joggers.png", "sheet"),
        ("kneepads", None, "c-kneepads.png", None),
        ("skates", "nia-skates-sm.glb", "c-skates.png", None)):
    if file is None:
        continue
    o = import_glb(f"{RAW}/{file}")
    o.name = "garment_" + name
    p = PX[img]
    box = px_box(p["x"], p["y"])
    zf = None
    if zsheet:
        # joggers: the garment image is 80 px longer than the worn joggers of the sheet
        zf = ((ysole - 994) * k, (ysole - 472) * k)
    info = place(o, box, zf, uniform=zsheet is None)
    info.update({"placed_" + a: b for a, b in inside_share(o).items()})
    if name == "jacket":
        info["dark_front_faces_removed"] = remove_dark_front(o)
    if name in ("jacket", "joggers"):
        info["pushed_out_verts"] = push_out(o, 0.006)
    info.update(inside_share(o))
    report[name] = info
    garments[name] = o
    print("PLACED", name, json.dumps(info))

# ---- crop top: the torso skin in the sheet band, pushed out ---------------
ct_top = (ysole - 315) * k
ct_bot = (ysole - 428) * k
bm = bmesh.new(); bm.from_mesh(body.data)
bm.verts.ensure_lookup_table()
keep = set()
for f in bm.faces:
    c = f.calc_center_median()
    if ct_bot < c.z < ct_top and abs(c.x) < 0.17:
        keep.add(f.index)
dead = [f for f in bm.faces if f.index not in keep]
bmesh.ops.delete(bm, geom=dead, context="FACES")
for v in bm.verts:
    v.co += v.normal * 0.0025
me = bpy.data.meshes.new("crop_top")
bm.to_mesh(me); bm.free()
crop = bpy.data.objects.new("garment_croptop", me)
bpy.context.scene.collection.objects.link(crop)
crop.matrix_world = body.matrix_world.copy()
mat = bpy.data.materials.new("croptop_cream")
mat.diffuse_color = (0.93, 0.89, 0.80, 1)
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (0.58, 0.50, 0.38, 1)
bsdf.inputs["Roughness"].default_value = 0.8
crop.data.materials.clear(); crop.data.materials.append(mat)
garments["croptop"] = crop
report["croptop"] = {"faces": len(me.polygons), "band_m": [ct_bot, ct_top]}

# ---- knee pads: generated garment image, modeled as shells on the knees --
kp = PX["c-kneepads.png"]
kbox = px_box(kp["x"], kp["y"])
kz = (kbox[2] + kbox[3]) / 2
pads = []
for side, sgn in (("l", 1), ("r", -1)):
    calf = rig.data.bones[f"calf_{side}"]
    knee = rig.matrix_world @ calf.head_local
    JV = coords(garments["joggers"])
    m = (np.abs(JV[:, 2] - knee.z) < 0.03) & (np.sign(JV[:, 0]) == sgn) & (np.abs(JV[:, 0] - knee.x) < 0.09)
    front_y = JV[m, 1].min()
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=1.0,
                                         location=(knee.x, front_y + 0.036, knee.z))
    s = bpy.context.active_object
    s.scale = (0.055, 0.045, 0.065)
    bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new(); bm.from_mesh(s.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y > 0.012], context="VERTS")
    bm.to_mesh(s.data); bm.free()
    sol = s.modifiers.new("t", "SOLIDIFY"); sol.thickness = 0.006
    s.name = f"kneepad_{side}"
    pads.append(s)
bpy.ops.object.select_all(action="DESELECT")
for s in pads:
    s.select_set(True)
bpy.context.view_layer.objects.active = pads[0]
bpy.ops.object.convert(target="MESH")
bpy.ops.object.join()
kneepads = bpy.context.view_layer.objects.active
kneepads.name = "garment_kneepads"
kmat = bpy.data.materials.new("kneepad_cream"); kmat.use_nodes = True
b2 = next(n for n in kmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b2.inputs["Base Color"].default_value = (0.55, 0.47, 0.34, 1); b2.inputs["Roughness"].default_value = 0.5
kneepads.data.materials.clear(); kneepads.data.materials.append(kmat)
garments["kneepads"] = kneepads
report["kneepads"] = {"source": "sphere shells at the knees (the image c-kneepads.png sets the height band)",
                      "image_band_m": [kbox[2], kbox[3]]}

# ---- wristband: on the wrist at the image right side (her left) ----------
hand = rig.data.bones["hand_l"]
fore = rig.data.bones["lowerarm_l"]
hp = rig.matrix_world @ hand.head_local
fp = rig.matrix_world @ fore.head_local
axis = (hp - fp).normalized()
ctr = hp - axis * 0.012
m = np.linalg.norm(BV - np.array(ctr), axis=1) < 0.035
d = BV[m] - np.array(ctr)
rad = float(np.percentile(np.linalg.norm(d - np.outer(d @ np.array(axis), axis), axis=1), 90)) + 0.004
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=rad, depth=0.045, location=ctr)
wb = bpy.context.active_object
wb.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
bpy.ops.object.transform_apply(rotation=True)
bm = bmesh.new(); bm.from_mesh(wb.data)
caps = [f for f in bm.faces if len(f.verts) > 4]
bmesh.ops.delete(bm, geom=caps, context="FACES_ONLY")
bm.to_mesh(wb.data); bm.free()
sol = wb.modifiers.new("t", "SOLIDIFY"); sol.thickness = 0.004
bpy.ops.object.modifier_apply(modifier="t")
wb.name = "garment_wristband"
wmat = bpy.data.materials.new("wristband_green"); wmat.use_nodes = True
b3 = next(n for n in wmat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b3.inputs["Base Color"].default_value = (0.10, 0.25, 0.15, 1); b3.inputs["Roughness"].default_value = 0.9
wb.data.materials.clear(); wb.data.materials.append(wmat)
garments["wristband"] = wb
report["wristband"] = {"radius_m": rad}

# ---- hair bun: cut from the shipped Tripo Nia -----------------------------
nia_raw = os.path.expanduser(A["--nia-raw"])
raw = import_glb(nia_raw)
RV = coords(raw)
# scale to the MetaHuman head: head top and ear width
mh_head = BV[BV[:, 2] > BV[:, 2].max() - 0.25]
top_mh = mh_head[:, 2].max()
rv_top = RV[:, 2].max()
# the raw mesh head: points within 0.30 of its top
raw_head = RV[RV[:, 2] > rv_top - 0.30 * (RV[:, 2].max() - RV[:, 2].min()) / 1.0 * 0.6]
s_hd = (np.ptp(mh_head[:, 0][np.abs(mh_head[:, 2] - (top_mh - 0.12)) < 0.01]) /
        max(np.ptp(raw_head[:, 0][np.abs(raw_head[:, 2] - np.percentile(raw_head[:, 2], 50)) < 0.01 * (np.ptp(raw_head[:, 2]) / 0.3)]), 1e-6))
report["bun_note"] = "cut from nia-real-tripo.glb: points outside the MetaHuman skull and above the ears"
# similarity by ICP on the face and skull below the bun
kd = kdtree.KDTree(len(mh_head))
for i, p in enumerate(mh_head):
    kd.insert(Vector(p), i)
kd.balance()
# start: scale the raw height to the body height, then put the raw nose on the MetaHuman nose
s0 = H / np.ptp(RV[:, 2])
X = RV * s0
X[:, 0] -= (X[:, 0].max() + X[:, 0].min()) / 2
X[:, 2] += (BV[:, 2].min() - X[:, 2].min())
def nose_of(P, top):
    hd = P[(P[:, 2] > top - 0.20) & (P[:, 2] < top - 0.08) & (np.abs(P[:, 0]) < 0.03)]
    return hd[np.argmin(hd[:, 1])]
raw_top_skull = np.percentile(X[np.abs(X[:, 0]) < 0.05][:, 2], 99.9)
mh_nose = nose_of(BV, top_mh)
# the raw head top includes the bun (about 0.10 m); search the raw nose lower
raw_nose = nose_of(X, raw_top_skull - 0.08)
X += mh_nose - raw_nose
report["bun_init_nose_m"] = [mh_nose.tolist(), raw_nose.tolist()]
headpts_idx = np.nonzero((X[:, 2] > top_mh - 0.24) & (X[:, 2] < top_mh - 0.02))[0]
rng = np.random.default_rng(1)
for it in range(40):
    idx = rng.choice(headpts_idx, min(5000, len(headpts_idx)), replace=False)
    P = X[idx]
    Q = np.array([kd.find(Vector(p))[0] for p in P])
    dd = np.linalg.norm(P - Q, axis=1)
    keep = dd < np.percentile(dd, 60)  # the bun and hair are outliers
    P, Q = P[keep], Q[keep]
    mp_, mq = P.mean(0), Q.mean(0)
    U, S, Vt = np.linalg.svd((Q - mq).T @ (P - mp_) / len(P))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    sk = np.trace(np.diag(S) @ D) / ((P - mp_) ** 2).sum() * len(P)
    X = (sk * (R @ X.T)).T + (mq - sk * R @ mp_)
report["bun_icp_last_mm"] = float(np.mean(dd[keep]) * 1000)
raw.data.vertices.foreach_set("co", X.reshape(-1)); raw.data.update()
ear_z = top_mh - 0.10
bm = bmesh.new(); bm.from_mesh(raw.data)
dead = []
for v in bm.verts:
    if v.co.z < ear_z:
        dead.append(v); continue
    loc, nrm, idx, dist = body_bvh.find_nearest(v.co)
    if loc is None or (v.co - loc).dot(nrm) < 0.004:
        dead.append(v)
bmesh.ops.delete(bm, geom=dead, context="VERTS")
# keep the largest connected part (the bun and the braids); drop small fragments
bm.verts.ensure_lookup_table()
seen, comps = set(), []
for v in bm.verts:
    if v.index in seen:
        continue
    stack, comp = [v], []
    while stack:
        x = stack.pop()
        if x.index in seen:
            continue
        seen.add(x.index); comp.append(x)
        stack.extend(e.other_vert(x) for e in x.link_edges if e.other_vert(x).index not in seen)
    comps.append(comp)
# drop the parts on the face (their center is below the skull top band)
small = [v for c in comps if np.mean([x.co.z for x in c]) < top_mh - 0.06 for v in c]
bmesh.ops.delete(bm, geom=small, context="VERTS")
report["bun_parts"] = len(comps)
report["bun_verts_dropped"] = len(small)
bm.to_mesh(raw.data); bm.free()
raw.name = "garment_hairbun"
garments["hairbun"] = raw
report["hairbun"] = {"verts": len(raw.data.vertices), "faces": len(raw.data.polygons)}

skin = bpy.data.materials.new("mh_skin_flat")
skin.use_nodes = True
b4 = next(n for n in skin.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
b4.inputs["Base Color"].default_value = (0.20, 0.10, 0.06, 1); b4.inputs["Roughness"].default_value = 0.55
skin.diffuse_color = (0.20, 0.10, 0.06, 1)
for i in range(len(body.data.materials)):
    body.data.materials[i] = skin
if not body.data.materials:
    body.data.materials.append(skin)

# ---- weights ---------------------------------------------------------------
def copy_weights(o):
    o.vertex_groups.clear()
    for g in body.vertex_groups:
        o.vertex_groups.new(name=g.name)
    dt = o.modifiers.new("dt", "DATA_TRANSFER")
    dt.object = body
    dt.use_vert_data = True
    dt.data_types_verts = {"VGROUP_WEIGHTS"}
    dt.vert_mapping = "POLYINTERP_NEAREST"
    dt.layers_vgroup_select_src = "ALL"
    dt.layers_vgroup_select_dst = "NAME"
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier="dt")


def rigid(o, bone_of_vertex):
    o.vertex_groups.clear()
    groups = {}
    for v in o.data.vertices:
        b = bone_of_vertex(o.matrix_world @ v.co)
        if b not in groups:
            groups[b] = o.vertex_groups.new(name=b)
        groups[b].add([v.index], 1.0, "REPLACE")


for name in ("jacket", "joggers", "croptop", "kneepads", "wristband"):
    copy_weights(garments[name])
rigid(garments["hairbun"], lambda p: "head")
rigid(garments["skates"], lambda p: "foot_l" if p.x > 0 else "foot_r")

# skate wheels: the lowest points of each skate, 4 clusters per foot
sk = garments["skates"]
SV = coords(sk)
wheels = []
for side, sgn in (("L", 1), ("R", -1)):
    m = (np.sign(SV[:, 0]) == sgn) & (SV[:, 2] < SV[:, 2].min() + 0.07)
    pts = SV[m]
    # k-means, 4 centers, seeded at the box corners in x/y
    lo, hi = pts.min(0), pts.max(0)
    C = np.array([[lo[0], lo[1]], [lo[0], hi[1]], [hi[0], lo[1]], [hi[0], hi[1]]])
    for _ in range(25):
        lab = np.argmin(((pts[:, None, :2] - C[None]) ** 2).sum(2), axis=1)
        C = np.array([pts[lab == j, :2].mean(0) if (lab == j).any() else C[j] for j in range(4)])
    order = np.argsort(C[:, 1])  # the skater faces -y: the two smallest y are the front axle
    for rank, j in enumerate(order):
        q = pts[lab == j]
        cz = (q[:, 2].min() + q[:, 2].max()) / 2
        fwd = "front" if rank < 2 else "rear"
        wheels.append({"side": side, "fwd": fwd, "center": [C[j, 0], C[j, 1], cz],
                       "radius": float((q[:, 2].max() - q[:, 2].min()) / 2), "verts": np.nonzero(m)[0][lab == j]})
for side in ("L", "R"):
    for fwd in ("front", "rear"):
        pair = sorted([w for w in wheels if w["side"] == side and w["fwd"] == fwd], key=lambda w: w["center"][0])
        for tag, w in zip("ab", pair):
            w["name"] = f"skate_wheel_{side}_{fwd}_{tag}"
report["wheels"] = [{"name": w["name"], "center": [round(c, 4) for c in w["center"]], "radius": round(w["radius"], 4),
                     "verts": int(len(w["verts"]))} for w in wheels]
# wheel vertices to the wheel bones
for w in wheels:
    g = sk.vertex_groups.new(name=w["name"])
    foot_g = sk.vertex_groups[f"foot_{w['side'].lower()}"]
    foot_g.remove([int(i) for i in w["verts"]])
    g.add([int(i) for i in w["verts"]], 1.0, "REPLACE")
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode="EDIT")
inv = rig.matrix_world.inverted()
for w in wheels:
    b = rig.data.edit_bones.new(w["name"])
    c = Vector(w["center"])
    b.head = inv @ c
    b.tail = inv @ (c + Vector((0.03, 0, 0)))  # the axle points along x (the skater's left-right)
    b.parent = rig.data.edit_bones[f"foot_{w['side'].lower()}"]
    b.use_deform = True
bpy.ops.object.mode_set(mode="OBJECT")

# ---- mask the body under cloth --------------------------------------------
cover = body.vertex_groups.new(name="hidden_under_cloth")
bvhs = {}
for name in ("jacket", "joggers", "croptop", "skates", "wristband", "kneepads"):
    o = garments[name]
    bvhs[name] = BVHTree.FromPolygons([o.matrix_world @ v.co for v in o.data.vertices], [tuple(p.vertices) for p in o.data.polygons])
hidden = []
for i, p in enumerate(BV):
    P = Vector(p)
    for name, t in bvhs.items():
        loc, nrm, idx, dist = t.find_nearest(P)
        if loc is None:
            continue
        lim = 0.03 if name in ("jacket", "joggers", "skates") else 0.008
        if dist < lim:
            # covered when a ray out along the body normal hits the garment
            n = body.data.vertices[i].normal
            hit = t.ray_cast(P + n * 0.0005, n, 0.06)
            if hit[0] is not None:
                hidden.append(i); break
cover.add(hidden, 1.0, "REPLACE")
mask = body.modifiers.new("hide_under_cloth", "MASK")
mask.vertex_group = "hidden_under_cloth"
mask.invert_vertex_group = True
report["body_hidden_verts"] = len(hidden)

# ---- shrinkwrap at the openings only -----------------------------------------
for name in ("jacket", "joggers"):
    o = garments[name]
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    bedges = [e for e in bm.edges if e.is_boundary]
    seen, loops = set(), []
    for e in bedges:
        if e.index in seen:
            continue
        stack, comp = [e], []
        while stack:
            x = stack.pop()
            if x.index in seen:
                continue
            seen.add(x.index); comp.append(x)
            for v in x.verts:
                for y in v.link_edges:
                    if y.is_boundary and y.index not in seen:
                        stack.append(y)
        length = sum(x.calc_length() for x in comp)
        loops.append((length, comp))
    big = [c for L, c in loops if L > 0.12]
    edge_v = {v.index for c in big for e in c for v in e.verts}
    ev = np.array([tuple(bm.verts[i].co) for i in edge_v]) if edge_v else np.zeros((0, 3))
    near = []
    if len(ev):
        kd2 = kdtree.KDTree(len(ev))
        for i, q in enumerate(ev):
            kd2.insert(Vector(q), i)
        kd2.balance()
        for v in bm.verts:
            if kd2.find(v.co)[2] < 0.015:
                near.append(v.index)
    report[name]["boundary_loops"] = len(loops)
    report[name]["opening_loops_m"] = sorted(round(L, 3) for L, c in loops if L > 0.12)
    bm.free()
    g = o.vertex_groups.new(name="openings")
    g.add(near, 1.0, "REPLACE")
    sw = o.modifiers.new("openings", "SHRINKWRAP")
    sw.target = body; sw.wrap_method = "NEAREST_SURFACEPOINT"; sw.wrap_mode = "OUTSIDE_SURFACE"
    sw.offset = 0.004; sw.vertex_group = "openings"
    report[name]["opening_verts"] = len(near)

# ---- parent to the rig ---------------------------------------------------------
for o in garments.values():
    o.parent = rig
    o.matrix_parent_inverse = rig.matrix_world.inverted()
    arm = o.modifiers.new("Armature", "ARMATURE"); arm.object = rig
    # the armature modifier first
    while o.modifiers.find("Armature") > 0:
        bpy.ops.object.modifier_move_up({"object": o}, modifier="Armature") if False else None
        break

for name, o in garments.items():
    if "inside_pct" not in report.get(name, {}):
        report.setdefault(name, {}).update(inside_share(o))
bpy.ops.wm.save_as_mainfile(filepath=f"{OUT}/nia-mh-clothed.blend")
json.dump(report, open(f"{OUT}/clothes_report.json", "w"), indent=1, default=float)
print("CLOTHES_DONE", json.dumps({k: v for k, v in report.items() if k != "wheels"}, default=float))
