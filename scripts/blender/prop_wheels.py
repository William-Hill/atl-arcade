"""Spin the wheels (and the city bike's crank) of a cleaned prop GLB
(people_props.py output): each part is cut out of ID_lod0 as its own node,
pivoted on its axle (glTF x, across) and keyed as one looping clip; ID_lod1
stays static (it shows from 20 m).

blender -b -P scripts/blender/prop_wheels.py -- IN.glb OUT.glb ID SPEC.json

SPEC: {"clip": "ride", "frames": 30, "parts": [{"name": "rear", "c": [z, y],
"r": 0.35, "rin": 0.07, "x": [0, 0.05], "turns": 2, "top": false}, ...]}
in glTF meters. A part is every lod0 face with all its corners within r of
the axle (z, y) (and at least rin from it, so the hub and the fork or stays
through it stay put) and |x| inside x. The axle is refit to the middle of the
cut. turns is how many forward turns per loop (the top rolls toward +z). With
"top", the axle is the middle of the two far pedals (|x| >= x[1] - 0.04) and
the +x pedal is turned to the top at frame 1: the phase of people_ik.ride_clip.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :]
src, dst, pid, spec = argv[0], argv[1], argv[2], json.load(open(argv[3]))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=src)
lod0 = bpy.data.objects[f"{pid}_lod0"]
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
M = lod0.matrix_world.copy()
gl = lambda p: Vector((p.x, p.z, -p.y))  # Blender world to glTF (x, y up, z forward)
bl = lambda p: Vector((p[0], -p[2], p[1]))

stats = {"clip": spec["clip"], "frames": spec["frames"], "parts": {}}
for part in spec["parts"]:
    cz, cy = part["c"]
    x0, x1 = part["x"]
    rin = part.get("rin", 0.0)
    bm = bmesh.new()
    bm.from_mesh(lod0.data)
    pts = {v.index: gl(M @ v.co) for v in bm.verts}

    def inside(p):
        r = math.hypot(p.z - cz, p.y - cy)
        return rin <= r <= part["r"] and x0 <= abs(p.x) <= x1

    faces = [f for f in bm.faces if all(inside(pts[v.index]) for v in f.verts)]
    if not faces:
        raise SystemExit(f"{pid} {part['name']}: no faces inside")
    vs = {v.index for f in faces for v in f.verts}
    if part.get("top"):
        far = {s: [pts[i] for i in vs if abs(pts[i].x) >= x1 - 0.04 and (pts[i].x > 0) == (s > 0)] for s in (1, -1)}
        mid = {s: sum(far[s], Vector()) / len(far[s]) for s in far}
        cy, cz = (mid[1].y + mid[-1].y) / 2, (mid[1].z + mid[-1].z) / 2
        rel = mid[1] - Vector((mid[1].x, cy, cz))
        # Blender rotation about +x turns (y_b, z_b) counter-clockwise; the
        # top is +z_b, forward is -y_b (= glTF +z).
        start = math.pi / 2 - math.atan2(rel.y, -rel.z)
        arm_len = rel.length
    else:
        ys, zs = [pts[i].y for i in vs], [pts[i].z for i in vs]
        cy, cz = (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2
        start, arm_len = 0.0, None
    for f in bm.faces:
        f.select = f in faces
    bm.to_mesh(lod0.data)
    bm.free()
    bpy.ops.object.select_all(action="DESELECT")
    lod0.select_set(True)
    bpy.context.view_layer.objects.active = lod0
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    o = next(x for x in bpy.context.selected_objects if x is not lod0)
    o.name = o.data.name = f"{pid}_{part['name']}"
    for k in list(o.keys()):
        del o[k]
    axle = bl((0.0, cy, cz))
    o.data.transform(Matrix.Translation(-(M.inverted() @ axle)))
    o.parent = lod0
    o.matrix_parent_inverse = Matrix.Identity(4)
    o.matrix_basis = Matrix.Translation(M.inverted() @ axle)
    o.rotation_mode = "XYZ"
    act = bpy.data.actions.new(f"{spec['clip']}_{part['name']}")
    o.animation_data_create().action = act
    if hasattr(o.animation_data, "action_slot") and act.slots:
        o.animation_data.action_slot = act.slots[0]
    for fr, a in ((1, start), (1 + spec["frames"], start + 2 * math.pi * part["turns"])):
        o.rotation_euler = (a, 0, 0)
        o.keyframe_insert("rotation_euler", index=0, frame=fr)
    for fc in getattr(act, "fcurves", []) or [c for l in act.layers for s in l.strips for b in s.channelbags for c in b.fcurves]:
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
    track = o.animation_data.nla_tracks.new()
    track.name = spec["clip"]
    track.strips.new(spec["clip"], 1, act)
    o.animation_data.action = None
    meshes.append(o)
    stats["parts"][part["name"]] = {
        "axle_m": [0, round(cy, 3), round(cz, 3)],
        "triangles": sum(len(p.vertices) - 2 for p in o.data.polygons),
        "turns": part["turns"],
        **({"crank_m": round(arm_len, 3)} if arm_len else {}),
    }

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=True,
    export_yup=True,
    export_extras=True,
    export_image_format="JPEG",
    export_image_quality=88,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14,
    export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12,
    export_draco_generic_quantization=12,
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_cameras=False,
    export_lights=False,
)
stats["triangles"] = {o.name.rsplit("_", 1)[1] if o.name.endswith(("lod0", "lod1")) else o.name.removeprefix(f"{pid}_"): sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes}
print("STATS", json.dumps(stats))
