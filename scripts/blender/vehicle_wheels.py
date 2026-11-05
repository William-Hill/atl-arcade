"""Split the wheels out of a cleaned vehicle GLB (from street_props.py) and rig them.

blender -b -P scripts/blender/vehicle_wheels.py -- IN.glb OUT.glb [--stats OUT.json] [--render OUT.png] [--round]

Meshy fuses wheels into the body. This finds each axle from the ground
contact patches, fits the tire circle (tangent to the ground) to the outer
vertices, and moves the faces inside that cylinder into their own object
with its origin on the axle. Node tree in the GLB:

  body
    steer_FL > wheel_FL     steer_FR > wheel_FR   (front axle: rotate steer_* about y)
    wheel_RL, wheel_RR      (more rear axles: wheel_R2L, wheel_R2R, ...)

--round moves the tread vertices (beyond 0.9 of the tire radius) onto the
tire circle, so a lumpy Meshy tire stays on the ground through a full turn.

Spin wheel_* about its local x (positive = rolling forward, toward +z).
The GLB also carries a looping clip "wheels_roll" (one turn per second).
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
stats_path, render_path = opt("--stats"), opt("--render")
round_tires = "--round" in argv

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
body = next(o for o in bpy.context.scene.objects if o.type == "MESH")
bpy.context.view_layer.objects.active = body
body.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
body.name = "body"
me = body.data
vs = [v.co.copy() for v in me.vertices]
lo = Vector([min(v[k] for v in vs) for k in range(3)])
hi = Vector([max(v[k] for v in vs) for k in range(3)])
L, H = hi.y - lo.y, hi.z - lo.z

# Axles: clusters along the length of the vertices touching the ground.
ys = sorted(v.y for v in vs if v.z < lo.z + 0.03 * H and abs(v.x) > 0.4 * hi.x)
axles = [[ys[0], ys[0]]]
for y in ys[1:]:
    if y - axles[-1][1] > 0.3:
        axles.append([y, y])
    else:
        axles[-1][1] = y
axles = [(a + b) / 2 for a, b in axles]  # Blender -y is the front, so axles[0] is the front axle.
print("AXLES", [round(a, 3) for a in axles])


def bands():
    for yc in axles:
        for side in (-1, 1):
            yield yc, side, [v for v in vs if v.x * side > 0.4 * hi.x and v.z < 0.6 * H and abs(v.y - yc) < 0.3 * H]


def on_circle(band, yc, r):
    return [v for v in band if abs(math.hypot(v.y - yc, v.z - lo.z - r) - r) < 0.012 * r]


# One tire radius for the whole vehicle: the circle tangent to the ground that the
# most outer vertices of all wheels lie on (a single wheel can lock onto its rim).
all_bands = list(bands())
radii = [0.22 + 0.002 * i for i in range(220)]  # tire radius 0.22-0.66 m
r = max(radii, key=lambda r: sum(len(on_circle(band, yc, r)) for yc, _, band in all_bands))
# A low skirt or bumper also touches the ground; keep only axles with a real tire on them.
# An axle whose tire hides partly behind a skirt fits the shared radius badly; it gets
# its own best radius when that circle still has a real tire on it.
def axle_hits(yc, rr):
    return sum(len(on_circle(band, y, rr)) for y, _, band in all_bands if y == yc)


hits = {yc: axle_hits(yc, r) for yc in axles}
top = max(hits.values())
radius = {}
for yc in axles:
    own = max(radii, key=lambda rr: axle_hits(yc, rr))
    if hits[yc] > 0.3 * top:
        radius[yc] = r
    elif axle_hits(yc, own) > 0.2 * top:
        radius[yc] = own
axles = [yc for yc in axles if yc in radius]
all_bands = [b for b in all_bands if b[0] in axles]
print("AXLES kept", [(round(a, 3), round(radius[a], 3)) for a in axles])


def span(band, yc):
    """x span of the tread, trimmed so a fender lip at the same radius does not widen it."""
    xs = sorted(abs(v.x) for v in on_circle(band, yc, radius[yc]))
    return xs[len(xs) // 20], xs[-1 - len(xs) // 50]


bm = bmesh.new()
bm.from_mesh(me)
bm.faces.ensure_lookup_table()
wheels = []
taken = set()
for (yc, side, band), i in zip(all_bands, [i for i in range(len(axles)) for _ in (0, 1)]):
    r = radius[yc]
    sname = "L" if side < 0 else "R"
    xin, xout = span(band, yc)
    zc = lo.z + r
    faces = []
    for f in bm.faces:
        if f.index in taken:
            continue
        c = f.calc_center_median()
        if c.x * side > 0 and xin - 0.02 * r <= abs(c.x) <= xout + 0.05 * r and math.hypot(c.y - yc, c.z - zc) < 1.03 * r:
            # Faces that reach into the fender stay on the body, so the spinning wheel stays round.
            if max(math.hypot(v.co.y - yc, v.co.z - zc) for v in f.verts) < 1.08 * r:
                faces.append(f)
                taken.add(f.index)
    axle = "F" if i == 0 else ("R" if len(axles) == 2 else f"R{i}")
    wheels.append({"name": f"wheel_{axle}{sname}", "faces": faces, "center": Vector((side * (xin + xout) / 2, yc, zc)), "radius": r, "width": xout - xin, "front": i == 0})

# Move each wheel's faces into its own mesh, sharing the body materials.
for w in wheels:
    for f in bm.faces:
        f.select = False
    for f in w["faces"]:
        f.select = True
    sub = bmesh.new()
    vmap = {}
    for f in w["faces"]:
        nv = [vmap.setdefault(v, sub.verts.new(v.co - w["center"])) for v in f.verts]
        nf = sub.faces.new(nv)
        nf.material_index = f.material_index
        nf.smooth = f.smooth
    sub.verts.index_update()
    if round_tires:
        for v in sub.verts:
            d = math.hypot(v.co.y, v.co.z)
            if d > 0.9 * w["radius"]:
                v.co.y, v.co.z = v.co.y * w["radius"] / d, v.co.z * w["radius"] / d
    uv_src = bm.loops.layers.uv.active
    if uv_src:
        uv_dst = sub.loops.layers.uv.new(uv_src.name)
        for f, nf in zip(w["faces"], sub.faces):
            for l, nl in zip(f.loops, nf.loops):
                nl[uv_dst].uv = l[uv_src].uv
    wm = bpy.data.meshes.new(w["name"])
    sub.to_mesh(wm)
    sub.free()
    for m in me.materials:
        wm.materials.append(m)
    ob = bpy.data.objects.new(w["name"], wm)
    bpy.context.scene.collection.objects.link(ob)
    w["obj"], w["tris"] = ob, sum(len(p.vertices) - 2 for p in wm.polygons)
bmesh.ops.delete(bm, geom=[f for w in wheels for f in w["faces"]], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(me)
bm.free()

for w in wheels:
    ob = w["obj"]
    if w["front"]:
        steer = bpy.data.objects.new("steer_" + w["name"][6:], None)
        bpy.context.scene.collection.objects.link(steer)
        steer.parent, steer.location = body, w["center"]
        ob.parent, ob.location = steer, (0, 0, 0)
    else:
        ob.parent, ob.location = body, w["center"]
    ob.rotation_mode = "XYZ"
    # Rolling forward (toward Blender -y) turns the top of the wheel toward -y: negative about Blender x.
    ob.rotation_euler = (0, 0, 0)
    ob.keyframe_insert("rotation_euler", index=0, frame=0)
    ob.rotation_euler = (-2 * math.pi, 0, 0)
    ob.keyframe_insert("rotation_euler", index=0, frame=24)
    action = ob.animation_data.action
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for fc in bag.fcurves:
                    for k in fc.keyframe_points:
                        k.interpolation = "LINEAR"
    # One NLA track name across all wheels exports as a single glTF animation.
    action.name = w["name"] + "_roll"
    track = ob.animation_data.nla_tracks.new()
    track.name = "wheels_roll"
    track.strips.new("wheels_roll", 0, action)
    ob.animation_data.action = None
scene = bpy.context.scene
scene.render.fps, scene.frame_start, scene.frame_end = 24, 0, 24

for o in bpy.context.scene.objects:
    o.select_set(True)
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
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=False,
    export_cameras=False,
    export_lights=False,
)

stats = {
    "body_triangles": sum(len(p.vertices) - 2 for p in me.polygons),
    "wheels": {w["name"]: {"triangles": w["tris"], "radius_m": round(w["radius"], 3), "width_m": round(w["width"], 3),
                           "center_m": [round(w["center"].x, 3), round(w["center"].z, 3), round(-w["center"].y, 3)]} for w in wheels},
}
stats["triangles"] = stats["body_triangles"] + sum(w["tris"] for w in wheels)
if stats_path:
    json.dump(stats, open(stats_path, "w"), indent=2)
print("STATS", json.dumps(stats))

if render_path:
    scene.frame_set(4)  # wheels turned 60 degrees, to see the cut
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x, scene.render.resolution_y = 1200, 600
    scene.world = bpy.data.worlds.new("w")
    for w in wheels:
        if w["front"]:
            w["obj"].parent.rotation_euler = (0, 0, math.radians(25))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    d = max(hi - lo)
    cam.location = Vector((d * 0.9, -d * 0.75, d * 0.3))
    target = Vector((hi.x, axles[0], H * 0.25))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = render_path
    bpy.ops.render.render(write_still=True)
