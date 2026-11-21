"""Clean a raw Meshy prop GLB (street furniture, BeltLine props, the dog and the
stroller) and export a Draco GLB with two LODs in real-world meters.

blender -b -P scripts/blender/people_props.py -- IN.glb OUT.glb ID --fit height|length --m METERS
    [--long x|z] [--yaw DEG] [--lod1 TRIS] [--lod1-distance M] [--tex 1024] [--stats OUT.json] [--render OUT.png]

Steps: join the meshes, apply the transforms, weld the UV-seam splits, drop
stray parts (islands well outside the body, specks, flat ground plates),
recalculate the normals outward, smooth by angle, turn the longest
horizontal axis to glTF --long (x: across, like a bench; z: front to back,
like a bike), then --yaw degrees about up, scale so the height (--fit height)
or that length (--fit length) is --m, put the base on y = 0 centered on
x = z = 0, cap the textures (base color --tex, normal and
metallic-roughness half of it), and export with Draco. Nodes: ID_lod0 and
ID_lod1 (a collapse-decimated copy at --lod1 triangles, same material) with
extras.lodDistance 0 and --lod1-distance, the convention of
assets/skate-features/.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst, pid = argv[0], argv[1], argv[2]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
fit, meters = opt("--fit", "height"), float(opt("--m"))
long_axis = opt("--long", "x")
yaw = math.radians(float(opt("--yaw", "0")))
lod1_tris = int(opt("--lod1", "0"))
lod1_distance = float(opt("--lod1-distance", "20"))
tex_max = int(opt("--tex", "1024"))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in bpy.context.scene.objects:
    o.select_set(o in meshes)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
me = obj.data
tris_in = sum(len(p.vertices) - 2 for p in me.polygons)

bm = bmesh.new()
bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5 * max(obj.dimensions))
bm.faces.ensure_lookup_table()
seen, islands = set(), []
for f in bm.faces:
    if f.index in seen:
        continue
    stack, isl = [f], []
    seen.add(f.index)
    while stack:
        g = stack.pop()
        isl.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h.index not in seen:
                    seen.add(h.index)
                    stack.append(h)
    islands.append(isl)


def bbox(faces):
    vs = [v.co for f in faces for v in f.verts]
    return Vector([min(v[k] for v in vs) for k in range(3)]), Vector([max(v[k] for v in vs) for k in range(3)])


area = lambda faces: sum(f.calc_area() for f in faces)
total = sum(area(i) for i in islands)
islands.sort(key=area, reverse=True)
mlo, mhi = bbox(islands[0])
for isl in islands[1:]:
    if area(isl) > 0.05 * total:
        lo, hi = bbox(isl)
        mlo, mhi = Vector(map(min, mlo, lo)), Vector(map(max, mhi, hi))
size = mhi - mlo
pad = 0.25 * max(size)
removed = {"outside": 0, "speck": 0, "plate": 0}
for isl in islands[1:]:
    lo, hi = bbox(isl)
    ext = hi - lo
    outside = any(lo[k] > mhi[k] + pad or hi[k] < mlo[k] - pad for k in range(3))
    speck = area(isl) < 1e-5 * total and len(isl) < 8
    plate = ext.z < 0.01 * size.z and (ext.x > 1.1 * size.x or ext.y > 1.1 * size.y)
    if outside or speck or plate:
        removed["outside" if outside else "speck" if speck else "plate"] += len(isl)
        bmesh.ops.delete(bm, geom=list(isl), context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(me)
bm.free()
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
if me.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()


def bounds():
    return (Vector([min(v.co[k] for v in me.vertices) for k in range(3)]),
            Vector([max(v.co[k] for v in me.vertices) for k in range(3)]))


# Blender x = glTF x, Blender -y = glTF z.
lo, hi = bounds()
ext = hi - lo
longest_is_x = ext.x >= ext.y
want_x = long_axis == "x"
rot = Matrix.Identity(4) if longest_is_x == want_x else Matrix.Rotation(math.pi / 2, 4, "Z")
me.transform(Matrix.Rotation(yaw, 4, "Z") @ rot)
lo, hi = bounds()
if fit == "height":
    s = meters / (hi.z - lo.z)
else:
    s = meters / ((hi.x - lo.x) if want_x else (hi.y - lo.y))
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
me.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-center))
me.update()
obj.name = f"{pid}_lod0"
obj["lodDistance"] = 0.0
tris0 = sum(len(p.vertices) - 2 for p in me.polygons)

objs = [obj]
tris1 = None
if lod1_tris and lod1_tris < tris0 * 0.8:
    lod1 = obj.copy()
    lod1.data = obj.data.copy()
    lod1.name = f"{pid}_lod1"
    for c in obj.users_collection:
        c.objects.link(lod1)
    dec = lod1.modifiers.new("dec", "DECIMATE")
    dec.ratio = lod1_tris / tris0
    bpy.context.view_layer.objects.active = lod1
    bpy.ops.object.modifier_apply(modifier="dec")
    lod1["lodDistance"] = lod1_distance
    tris1 = sum(len(p.vertices) - 2 for p in lod1.data.polygons)
    objs.append(lod1)

mat = me.materials[0]
mat.name = f"{pid}_mat"
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
if "Specular Tint" in bsdf.inputs:
    bsdf.inputs["Specular Tint"].default_value = (1, 1, 1, 1)
for l in mat.node_tree.links:
    if l.to_node != bsdf:
        continue
    node = l.from_node
    while node and node.type != "TEX_IMAGE":
        node = next((k.from_node for k in mat.node_tree.links if k.to_node == node), None)
    if not node:
        continue
    sock = l.to_socket.name
    cap = tex_max if sock == "Base Color" else tex_max // 2
    tag = {"Base Color": "color", "Normal": "normal"}.get(sock, "metal_rough")
    node.image.name = f"{pid}_{tag}"
    if node.image.size[0] > cap:
        node.image.scale(cap, cap)
# The normal map hangs off a Normal Map node.
for n in mat.node_tree.nodes:
    if n.type == "NORMAL_MAP":
        t = next((k.from_node for k in mat.node_tree.links if k.to_node == n and k.from_node.type == "TEX_IMAGE"), None)
        if t:
            t.image.name = f"{pid}_normal"
            if t.image.size[0] > tex_max // 2:
                t.image.scale(tex_max // 2, tex_max // 2)

for o in bpy.data.objects:
    o.select_set(o in objs)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_extras=True,
    export_apply=True,
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_animations=False,
    export_cameras=False,
    export_lights=False,
)
lo, hi = bounds()
stats = {
    "triangles_in": tris_in,
    "triangles": {"lod0": tris0, **({"lod1": tris1} if tris1 else {})},
    "lod1_distance": lod1_distance if tris1 else None,
    "removed_faces": removed,
    "scale": round(s, 5),
    "bounds_m": {"min": [round(lo.x, 3), round(lo.z, 3), round(-hi.y, 3)], "max": [round(hi.x, 3), round(hi.z, 3), round(-lo.y, 3)]},
    "textures": sorted({f"{i.name} {i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.users and i.size[0]}),
}
if opt("--stats"):
    json.dump(stats, open(opt("--stats"), "w"), indent=2)
print("STATS", json.dumps(stats))

if opt("--render"):
    sc = bpy.context.scene
    for o in objs[1:]:
        o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x, sc.render.resolution_y = 800, 800
    sc.world = bpy.data.worlds.new("w")
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    d = max(hi - lo)
    target = Vector((0, 0, (hi.z - lo.z) * 0.45))
    cam.location = target + Vector((d * 1.3, -d * 1.7, d * 0.7))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = opt("--render")
    bpy.ops.render.render(write_still=True)
