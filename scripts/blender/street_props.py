"""Clean a raw Meshy GLB and export a Draco GLB in real-world meters.

blender -b -P scripts/blender/street_props.py -- IN.glb OUT.glb LENGTH_M [--flip] [--tex 2048] [--stats OUT.json] [--render OUT.png]
    [--width-scale S] [--paint SPEC.json --paint-key NAME]

Steps: join meshes, apply transforms, drop stray loose parts, merge doubles,
recalculate normals outward, smooth by angle, turn the longest horizontal
axis to glTF z (front at +z with the glTF convention), scale so that axis is
LENGTH_M, put the base on y = 0 centered on x = z = 0, cap textures, and
export with Draco.

--width-scale S scales x (across the vehicle) only, which keeps the wheels
round about their axles. --paint fills texture regions (made-up emblems or
lettering from Meshy) with their median color and a flat normal: SPEC.json
has { NAME: [ { "box": { "x": [a, b], "y": [a, b], "z": [a, b] }, "note": ... } ] },
boxes in output glTF meters, and every face whose center is in a box is filled.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst, length = argv[0], argv[1], float(argv[2])
flip = "--flip" in argv
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
tex_max = int(opt("--tex", "1024"))
stats_path = opt("--stats")
width_scale = float(opt("--width-scale", "1"))
paint = json.load(open(opt("--paint")))[opt("--paint-key")] if opt("--paint") else []
render_path = opt("--render")

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

# Stray parts: loose islands that float outside the body, tiny specks, and
# flat ground plates wider than the body.
bm = bmesh.new()
bm.from_mesh(me)
# Weld the UV-seam splits first, so a seam does not cut the surface into islands.
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
    return Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))), Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))

def area(faces):
    return sum(f.calc_area() for f in faces)

total_area = sum(area(i) for i in islands)
islands.sort(key=area, reverse=True)
main_lo, main_hi = bbox(islands[0])
for isl in islands[1:]:
    if area(isl) > 0.05 * total_area:
        lo, hi = bbox(isl)
        main_lo = Vector(map(min, main_lo, lo))
        main_hi = Vector(map(max, main_hi, hi))
size = main_hi - main_lo
# Only parts well clear of the body count as floating (leaves above a planter stay).
pad = 0.25 * max(size)
removed = []
for isl in islands[1:]:
    lo, hi = bbox(isl)
    ext = hi - lo
    outside = any(lo[k] > main_hi[k] + pad or hi[k] < main_lo[k] - pad for k in range(3))
    speck = area(isl) < 1e-5 * total_area and len(isl) < 8
    plate = ext.z < 0.01 * size.z and (ext.x > 1.1 * size.x or ext.y > 1.1 * size.y)
    if outside or speck or plate:
        removed.append({"faces": len(isl), "reason": "outside" if outside else "speck" if speck else "plate"})
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

# Orient: longest horizontal axis along Blender -y (glTF +z after export).
lo = Vector([min(v.co[k] for v in me.vertices) for k in range(3)])
hi = Vector([max(v.co[k] for v in me.vertices) for k in range(3)])
ext = hi - lo
rot = Matrix.Rotation(math.pi / 2, 4, "Z") if ext.x > ext.y else Matrix.Identity(4)
if flip:
    rot = Matrix.Rotation(math.pi, 4, "Z") @ rot
me.transform(rot)
lo = Vector([min(v.co[k] for v in me.vertices) for k in range(3)])
hi = Vector([max(v.co[k] for v in me.vertices) for k in range(3)])
s = length / (hi.y - lo.y)
center = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
me.transform(Matrix.Diagonal((width_scale, 1, 1, 1)) @ Matrix.Scale(s, 4) @ Matrix.Translation(-center))
me.update()

def paint_regions(regions):
    """Fill the texels under the faces in each box with the region's median color."""
    import numpy as np

    mat = me.materials[0]
    links = {l.to_socket.name: l.from_node for l in mat.node_tree.links if l.to_node.type == "BSDF_PRINCIPLED"}
    def image_of(node):
        while node and node.type != "TEX_IMAGE":
            node = next((l.from_node for l in mat.node_tree.links if l.to_node == node), None)
        return node.image if node else None
    base = image_of(links.get("Base Color"))
    normal = image_of(links.get("Normal"))
    mr = image_of(links.get("Roughness") or links.get("Metallic"))
    uv = me.uv_layers.active.data
    done = []
    for reg in regions:
        b = reg["box"]
        faces = []
        for p in me.polygons:
            c = p.center  # glTF (x, y, z) = Blender (x, z, -y)
            g = (c.x, c.z, -c.y)
            if all(b[k][0] <= g[i] <= b[k][1] for i, k in enumerate("xyz")):
                faces.append(p)
        w, h = base.size
        mask = np.zeros((h, w), bool)
        for p in faces:
            pts = [uv[li].uv for li in p.loop_indices]
            for t in range(1, len(pts) - 1):
                tri = np.array([pts[0], pts[t], pts[t + 1]]) * (w, h)
                x0, y0 = np.floor(tri.min(0)).astype(int)
                x1, y1 = np.ceil(tri.max(0)).astype(int)
                xs, ys = np.meshgrid(np.arange(max(x0, 0), min(x1 + 1, w)), np.arange(max(y0, 0), min(y1 + 1, h)))
                px, py = xs + 0.5, ys + 0.5
                (ax, ay), (bx, by), (cx, cy) = tri
                d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
                if abs(d) < 1e-12:
                    continue
                l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
                l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
                inside = (l1 >= -0.02) & (l2 >= -0.02) & (1 - l1 - l2 >= -0.02)
                mask[ys[inside], xs[inside]] = True
        core = mask.copy()
        for _ in range(2):  # grow 2 texels so the fill covers the seams
            g = mask.copy()
            g[1:] |= mask[:-1]; g[:-1] |= mask[1:]; g[:, 1:] |= mask[:, :-1]; g[:, :-1] |= mask[:, 1:]
            mask = g
        for img, flat in ((base, None), (mr, None), (normal, (0.5, 0.5, 1.0))):
            if img is None or core.sum() == 0:
                continue
            iw, ih = img.size
            px = np.empty(iw * ih * 4, np.float32)
            img.pixels.foreach_get(px)
            px = px.reshape(ih, iw, 4)
            m, cm = mask, core
            if (iw, ih) != (w, h):  # masks are in base color texels
                yi = (np.arange(ih) * h // ih)[:, None]; xi = (np.arange(iw) * w // iw)[None, :]
                m, cm = mask[yi, xi], core[yi, xi]
            fill = flat if flat else np.median(px[cm][:, :3], axis=0)
            px[m, :3] = fill
            img.pixels.foreach_set(px.ravel())
            img.update()
        done.append({"note": reg.get("note"), "faces": len(faces), "texels": int(mask.sum())})
    return done


painted = paint_regions(paint) if paint else []

for img in bpy.data.images:
    if img.size[0] > tex_max or img.size[1] > tex_max:
        img.scale(min(tex_max, img.size[0]), min(tex_max, img.size[1]))

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
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

lo = [min(v.co[k] for v in me.vertices) for k in range(3)]
hi = [max(v.co[k] for v in me.vertices) for k in range(3)]
stats = {
    "triangles_in": tris_in,
    "triangles": sum(len(p.vertices) - 2 for p in me.polygons),
    "vertices": len(me.vertices),
    "removed_parts": {r: {"parts": sum(1 for x in removed if x["reason"] == r), "faces": sum(x["faces"] for x in removed if x["reason"] == r)} for r in ("outside", "speck", "plate")},
    "scale": s,
    "width_scale": width_scale,
    "painted": painted,
    # glTF axes: x = Blender x, y = Blender z, z = -Blender y.
    "bounds_m": {"x": [round(lo[0], 3), round(hi[0], 3)], "y": [round(lo[2], 3), round(hi[2], 3)], "z": [round(-hi[1], 3), round(-lo[1], 3)]},
    "textures": sorted({f"{i.name} {i.size[0]}x{i.size[1]}" for i in bpy.data.images if i.size[0]}),
}
if stats_path:
    json.dump(stats, open(stats_path, "w"), indent=2)
print("STATS", json.dumps(stats))

if render_path:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 600
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("w")
    scene.world = world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    d = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
    # Front three-quarter view: the front is at Blender -y.
    cam.location = Vector((d * 1.4, -d * 1.7, d * 0.8))
    target = Vector((0, 0, (hi[2] - lo[2]) * 0.4))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
