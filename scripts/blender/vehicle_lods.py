"""LOD1/LOD2 meshes and a shared 512 px texture atlas for the traffic vehicles.

blender -b -P scripts/blender/vehicle_lods.py -- [--kinds sedan,taxi] [--out DIR] [--stats FILE] [--patch]

For each kind in assets/vehicles/<kind>.glb (the rigged LOD0 of
vehicle_wheels.py):
1. paints out the fictional badges and lettering in vehicle_cleanup.json on
   the 1024 px textures and, with --patch, writes them back into <kind>.glb (geometry,
   nodes and the wheels_roll clip are untouched);
2. builds <kind>_lod1 (~35% of the triangles: body > steer_FL/FR >
   wheel_FL/FR, body > wheel_RL/RR, same pivots as LOD0) and <kind>_lod2
   (~10%: body and wheels merged into one mesh) by collapse decimation;
3. packs the 7 texture sets into one 2048x1024 atlas (512 px per kind, the
   12 m bus gets 1024x512) shared by every LOD1/LOD2 mesh, so all far cars
   can draw in one call.
All the LODs go to <out>/vehicles_lod.glb (Draco, JPEG, no animation).
"""
import json
import os
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


KINDS = ["sedan", "pickup", "bus", "hatchback", "van", "taxi", "box_truck"]
kinds = arg("--kinds", ",".join(KINDS)).split(",")
SRC = os.path.join(ROOT, "assets", "vehicles")
OUT = os.path.abspath(arg("--out", SRC))
PATCH = "--patch" in argv
LOD1, LOD2, LOD2_WHEEL = 0.35, 0.10, 0.08
ATLAS_W, ATLAS_H, PAD = 2048, 1024, 8
# Atlas cells (x, y, w, h) in texels, y up from the bottom row like UV v.
RECTS = {
    "sedan": (0, 0, 512, 512),
    "pickup": (512, 0, 512, 512),
    "hatchback": (1024, 0, 512, 512),
    "van": (1536, 0, 512, 512),
    "taxi": (0, 512, 512, 512),
    "box_truck": (512, 512, 512, 512),
    "bus": (1024, 512, 1024, 512),
}
WHEELS = ["wheel_FL", "wheel_FR", "wheel_RL", "wheel_RR"]
with open(os.path.join(ROOT, "scripts", "blender", "vehicle_cleanup.json")) as f:
    CLEAN = json.load(f)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
TMP = os.path.join(OUT, ".lod_tmp")
os.makedirs(TMP, exist_ok=True)


def tris(me):
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def material_images(mat):
    """{base, mr, normal} images of a glTF-imported Principled material."""
    links = mat.node_tree.links

    def image_of(sock):
        node = next((l.from_node for l in links if l.to_socket == sock), None)
        while node and node.type != "TEX_IMAGE":
            node = next((l.from_node for l in links if l.to_node == node), None)
        return node

    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    return {
        "base": image_of(bsdf.inputs["Base Color"]),
        "mr": image_of(bsdf.inputs["Roughness"]) or image_of(bsdf.inputs["Metallic"]),
        "normal": image_of(bsdf.inputs["Normal"]),
    }


def to_gltf(v):
    return (v.x, v.z, -v.y)  # glTF (x, y, z) = Blender (x, z, -y)


def faces_in(obj, box, facing=None):
    """Faces whose bounds overlap the box (glTF meters), optionally facing an axis."""
    mw = obj.matrix_world
    nm = mw.to_3x3()
    vs = [to_gltf(mw @ v.co) for v in obj.data.vertices]
    out = []
    for p in obj.data.polygons:
        g = [vs[i] for i in p.vertices]
        if not all(min(q[i] for q in g) <= box[k][1] and max(q[i] for q in g) >= box[k][0] for i, k in enumerate("xyz")):
            continue
        if facing:
            n = to_gltf((nm @ p.normal).normalized())
            axis = "xyz".index(facing[1])
            if (n[axis] if facing[0] == "+" else -n[axis]) < 0.3:
                continue
        out.append(p)
    return out


def uv_mask(obj, faces, w, h, box):
    """Texels of the faces whose surface point lies inside the box."""
    me = obj.data
    mw = obj.matrix_world
    uv = me.uv_layers.active.data
    lo = np.array([box[k][0] for k in "xyz"]) - 0.005
    hi = np.array([box[k][1] for k in "xyz"]) + 0.005
    mask = np.zeros((h, w), bool)
    for p in faces:
        pts = [uv[li].uv for li in p.loop_indices]
        pos = [np.array(to_gltf(mw @ me.vertices[v].co)) for v in p.vertices]
        for t in range(1, len(pts) - 1):
            tri = np.array([pts[0], pts[t], pts[t + 1]]) * (w, h)
            x0, y0 = np.floor(tri.min(0)).astype(int)
            x1, y1 = np.ceil(tri.max(0)).astype(int)
            xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1 + 1, w)), np.arange(max(y0, 0), min(y1 + 1, h)))
            if xs.size == 0:
                continue
            px, py = xs + 0.5, ys + 0.5
            (ax, ay), (bx, by), (cx, cy) = tri
            d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
            if abs(d) < 1e-12:
                continue
            l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
            l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
            l3 = 1 - l1 - l2
            inside = (l1 >= -0.02) & (l2 >= -0.02) & (l3 >= -0.02)
            q = l1[..., None] * pos[0] + l2[..., None] * pos[t] + l3[..., None] * pos[t + 1]
            inside &= np.all((q >= lo) & (q <= hi), axis=-1)
            mask[ys[inside], xs[inside]] = True
    return mask


def pixels(img):
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)


def resample(mask, w, h):
    mh, mw = mask.shape
    if (mw, mh) == (w, h):
        return mask
    return mask[(np.arange(h) * mh // h)[:, None], (np.arange(w) * mw // w)[None, :]]


def paint(body, images, regions):
    """Fill the texels under each region with the median color of its sample box."""
    w, h = images["base"].image.size
    buf = {r: pixels(n.image) for r, n in images.items() if n}
    log = []
    for reg in regions:
        faces = faces_in(body, reg["box"], reg.get("facing"))
        core = uv_mask(body, faces, w, h, reg["box"])
        mask = core.copy()
        for _ in range(2):  # grow 2 texels so the fill covers the seams
            g = mask.copy()
            g[1:] |= mask[:-1]; g[:-1] |= mask[1:]; g[:, 1:] |= mask[:, :-1]; g[:, :-1] |= mask[:, 1:]
            mask = g
        src = core
        if "sample" in reg:
            sample = uv_mask(body, faces_in(body, reg["sample"], reg.get("sample_facing")), w, h, reg["sample"])
            src = sample & ~mask if (sample & ~mask).any() else sample
        log.append({"note": reg["note"], "faces": len(faces), "texels": int(mask.sum()), "sample_texels": int(src.sum())})
        if not core.any() or not src.any():
            continue
        for role, px in buf.items():
            ih, iw = px.shape[:2]
            m, s = resample(mask, iw, ih), resample(src, iw, ih)
            px[m, :3] = (0.5, 0.5, 1.0) if role == "normal" else np.median(px[s][:, :3], axis=0)
    for role, px in buf.items():
        images[role].image.pixels.foreach_set(px.ravel())
        images[role].image.update()
    return log


def save_jpeg(img, path, quality=88):
    img.file_format = "JPEG"
    img.save(filepath=path, quality=quality, save_copy=True)
    with open(path, "rb") as f:
        return f.read()


def patch_glb(path, role_bytes):
    """Swap the base/mr/normal image bytes of a GLB, keeping everything else."""
    with open(path, "rb") as f:
        data = f.read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gl = json.loads(data[20 : 20 + jlen])
    boff = 20 + jlen
    blen = struct.unpack_from("<I", data, boff)[0]
    bin_ = data[boff + 8 : boff + 8 + blen]
    m = gl["materials"][0]
    tex = {
        "base": m["pbrMetallicRoughness"]["baseColorTexture"]["index"],
        "mr": m["pbrMetallicRoughness"]["metallicRoughnessTexture"]["index"],
        "normal": m["normalTexture"]["index"],
    }
    swap = {gl["images"][gl["textures"][t]["source"]]["bufferView"]: role_bytes[r] for r, t in tex.items()}
    out = bytearray()
    for i, bv in enumerate(gl["bufferViews"]):
        chunk = swap.get(i, bin_[bv.get("byteOffset", 0) : bv.get("byteOffset", 0) + bv["byteLength"]])
        while len(out) % 4:
            out.append(0)
        bv["byteOffset"] = len(out)
        bv["byteLength"] = len(chunk)
        out += chunk
    while len(out) % 4:
        out.append(0)
    gl["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(js), b"JSON") + js)
        f.write(struct.pack("<I4s", len(out), b"BIN\0") + bytes(out))


def dup(obj, name, world=True):
    """A linked-to-scene copy of a mesh; world=True bakes its world transform."""
    me = obj.data.copy()
    me.name = name
    if world:
        me.transform(obj.matrix_world)
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    if not world:
        o.matrix_world = obj.matrix_world.copy()
    return o


def decimate(o, ratio):
    mod = o.modifiers.new("decimate", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
    bm.to_mesh(o.data)
    bm.free()
    if o.data.has_custom_normals:
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
    o.data.shade_smooth()
    o.data.set_sharp_from_angle(angle=0.6109)  # 35 deg


def to_cell(o, kind, mat):
    x, y, w, h = RECTS[kind]
    uv = o.data.uv_layers.active.data
    a = np.empty(len(uv) * 2, np.float32)
    uv.foreach_get("uv", a)
    a = np.clip(a.reshape(-1, 2), 0, 1)
    a[:, 0] = (x + PAD + a[:, 0] * (w - 2 * PAD)) / ATLAS_W
    a[:, 1] = (y + PAD + a[:, 1] * (h - 2 * PAD)) / ATLAS_H
    uv.foreach_set("uv", a.ravel())
    o.data.materials.clear()
    o.data.materials.append(mat)


atlas = {r: np.zeros((ATLAS_H, ATLAS_W, 4), np.float32) for r in ("base", "mr", "normal")}
atlas["base"][:] = (0.5, 0.5, 0.5, 1)
atlas["mr"][:] = (1, 0.6, 0, 1)
atlas["normal"][:] = (0.5, 0.5, 1, 1)
atlas_mat = None
stats = {}
keep = []

for kind in kinds:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, f"{kind}.glb"), merge_vertices=True)
    objs = {o.name: o for o in bpy.data.objects if o not in before}
    body = objs["body"]
    wheels = {n: objs[n] for n in WHEELS}
    steer = {n: objs[n] for n in ("steer_FL", "steer_FR")}
    bpy.context.view_layer.update()
    images = material_images(body.data.materials[0])
    log = paint(body, images, CLEAN.get(kind, []))
    if PATCH and CLEAN.get(kind):
        patch_glb(
            os.path.join(SRC, f"{kind}.glb"),
            {r: save_jpeg(n.image, os.path.join(TMP, f"{kind}_{r}.jpg")) for r, n in images.items()},
        )

    # Atlas cell from the (painted) 1024 px textures.
    x, y, w, h = RECTS[kind]
    for role, node in images.items():
        c = node.image.copy()
        c.scale(w - 2 * PAD, h - 2 * PAD)
        px = np.pad(pixels(c), ((PAD, PAD), (PAD, PAD), (0, 0)), mode="edge")
        atlas[role][y : y + h, x : x + w] = px
        bpy.data.images.remove(c)
    if atlas_mat is None:
        atlas_mat = body.data.materials[0].copy()
        atlas_mat.name = "vehicle_atlas"
        atlas_nodes = material_images(atlas_mat)

    lod0 = tris(body.data) + sum(tris(w.data) for w in wheels.values())

    # LOD1: same rig as LOD0.
    b1 = dup(body, f"{kind}_lod1_body")
    decimate(b1, LOD1)
    to_cell(b1, kind, atlas_mat)
    lod1 = tris(b1.data)
    parts = [b1]
    for n, s in steer.items():
        e = bpy.data.objects.new(f"{kind}_lod1_{n}", None)
        scene.collection.objects.link(e)
        e.parent = b1
        e.matrix_world = s.matrix_world.copy()
        parts.append(e)
    bpy.context.view_layer.update()
    for n, wo in wheels.items():
        w1 = dup(wo, f"{kind}_lod1_{n}", world=False)
        decimate(w1, LOD1)
        to_cell(w1, kind, atlas_mat)
        w1.parent = bpy.data.objects[f"{kind}_lod1_steer_{n[-2:]}"] if n[-2] == "F" else b1
        w1.matrix_world = wo.matrix_world.copy()
        lod1 += tris(w1.data)
        parts.append(w1)

    # LOD2: one mesh, wheels merged into the body.
    b2 = dup(body, f"{kind}_lod2")
    decimate(b2, LOD2)
    ws = []
    for n, wo in wheels.items():
        w2 = dup(wo, f"{kind}_lod2_{n}")
        decimate(w2, LOD2_WHEEL)
        ws.append(w2)
    with bpy.context.temp_override(active_object=b2, selected_editable_objects=[b2, *ws]):
        bpy.ops.object.join()
    to_cell(b2, kind, atlas_mat)
    lod2 = tris(b2.data)
    parts.append(b2)
    keep += parts

    bpy.context.view_layer.update()
    stats[kind] = {
        "triangles": {"lod0": lod0, "lod1": lod1, "lod2": lod2},
        "ratio": {"lod1": round(lod1 / lod0, 3), "lod2": round(lod2 / lod0, 3)},
        "atlas_rect": RECTS[kind],
        "cleanup": log,
    }
    print(f"LOD {kind}: {lod0} -> {lod1} ({lod1 / lod0:.0%}) -> {lod2} ({lod2 / lod0:.0%})")
    for o in objs.values():
        bpy.data.objects.remove(o, do_unlink=True)

for role, node in atlas_nodes.items():
    img = bpy.data.images.new(f"vehicle_atlas_{role}", ATLAS_W, ATLAS_H, alpha=False)
    if role != "base":
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(atlas[role].ravel())
    img.pack()
    node.image = img

for o in bpy.data.objects:
    o.select_set(o in keep)
dst = os.path.join(OUT, "vehicles_lod.glb")
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_animations=False,
    export_materials="EXPORT",
)
for f in os.listdir(TMP):
    os.remove(os.path.join(TMP, f))
os.rmdir(TMP)
print("WROTE", dst, os.path.getsize(dst))
if arg("--stats"):
    with open(arg("--stats"), "w") as f:
        json.dump(stats, f, indent=2)
