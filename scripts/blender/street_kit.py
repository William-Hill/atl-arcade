# Street kit for the BeltLine Eastside block (M1-08, #40).
#
# Run inside Blender (Blender MCP execute_blender_code, or
#   blender -b -P scripts/blender/street_kit.py -- <out.glb>).
# It builds props from primitives and swept tubes, gives each prop one mesh
# with a vertex color layer (no textures), and exports them to one glTF
# binary. Units: meters. Blender is Z-up; the glTF exporter writes Y-up.
#
# Each prop has two levels of detail:
#   <name>       LOD0, smooth shaded, for props near the camera.
#   <name>_lod1  LOD1, a few faces, for props far from the camera.
# Props: tree_round, tree_tall, bench, lamp, bike_rack, bin, planter,
# roof_unit, water_tower.
# Every prop stands on z = 0 with its center on x = y = 0. The long side of
# a bench and a bike rack is along x. The seat back of a bench is at +y in
# Blender, which is -z in three.js after the Y-up export.

import math
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None

PALETTE = {
    "trunk": (0.42, 0.28, 0.18),
    "bark": (0.34, 0.23, 0.15),
    "leaf": (0.36, 0.64, 0.30),
    "leaf_light": (0.50, 0.74, 0.34),
    "leaf_dark": (0.24, 0.50, 0.26),
    "pine": (0.20, 0.44, 0.28),
    "wood": (0.80, 0.54, 0.30),
    "metal": (0.16, 0.18, 0.22),
    "steel": (0.55, 0.58, 0.62),
    "lamp": (1.00, 0.93, 0.70),
    "rack": (0.95, 0.70, 0.20),
    "bin": (0.16, 0.45, 0.62),
    "planter": (0.72, 0.66, 0.58),
    "soil": (0.30, 0.22, 0.16),
    "flower": (0.95, 0.45, 0.55),
    "unit": (0.74, 0.76, 0.78),
    "tower": (0.58, 0.42, 0.30),
    "shade": (0.30, 0.40, 0.26),
}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def paint(tmp, color, smooth):
    layer = tmp.loops.layers.color.get("color") or tmp.loops.layers.color.new("color")
    for f in tmp.faces:
        f.smooth = smooth
        for l in f.loops:
            l[layer] = (*color, 1.0)


def merge(bm, tmp):
    me = bpy.data.meshes.new("tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


def part(bm, kind, color, size=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0), segments=8, subdiv=1, smooth=False, r2=None, jitter=0.0, seed=0):
    """Adds a primitive to the bmesh and paints its faces one color."""
    tmp = bmesh.new()
    if kind == "cube":
        bmesh.ops.create_cube(tmp, size=1.0)
    elif kind == "cyl":
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=segments, radius1=0.5, radius2=0.5 if r2 is None else r2, depth=1.0)
    elif kind == "cone":
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=segments, radius1=0.5, radius2=0.0, depth=1.0)
    elif kind == "ico":
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=0.5)
    elif kind == "uv":
        bmesh.ops.create_uvsphere(tmp, u_segments=segments, v_segments=max(4, segments // 2), radius=0.5)
    if jitter > 0:
        rng = random.Random(seed)
        for v in tmp.verts:
            v.co *= 1.0 + (rng.random() - 0.5) * 2 * jitter
    bmesh.ops.scale(tmp, vec=size, verts=tmp.verts)
    m = Matrix.Rotation(rot[0], 3, "X") @ Matrix.Rotation(rot[1], 3, "Y") @ Matrix.Rotation(rot[2], 3, "Z")
    bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0), matrix=m)
    bmesh.ops.translate(tmp, vec=loc, verts=tmp.verts)
    paint(tmp, color, smooth)
    merge(bm, tmp)


def tube(bm, path, radius, color, segments=8, r_end=None, smooth=True):
    """Sweeps a circle along a polyline of points (a pipe, a branch, an arm)."""
    tmp = bmesh.new()
    pts = [Vector(p) for p in path]
    rings = []
    for i, p in enumerate(pts):
        t = i / (len(pts) - 1)
        r = radius if r_end is None else radius + (r_end - radius) * t
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 0, 1)) if abs(d.z) < 0.95 else Vector((1, 0, 0))
        a = d.cross(up).normalized()
        b = d.cross(a).normalized()
        ring = []
        for k in range(segments):
            ang = 2 * math.pi * k / segments
            ring.append(tmp.verts.new(p + (a * math.cos(ang) + b * math.sin(ang)) * r))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(segments):
            k2 = (k + 1) % segments
            tmp.faces.new((rings[i][k], rings[i][k2], rings[i + 1][k2], rings[i + 1][k]))
    tmp.faces.new(list(reversed(rings[0])))
    tmp.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces)
    paint(tmp, color, smooth)
    merge(bm, tmp)


def shade_disc(bm, radius):
    # A flat dark disc 3.5 cm above the ground: a stylized shadow, because the
    # geodata level has no shadow map (see docs/decisions.md).
    part(bm, "cyl", PALETTE["shade"], (radius * 2, radius * 2, 0.01), (0.35, 0.25, 0.035), segments=16)


def prop(name, build):
    bm = bmesh.new()
    build(bm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    # The exporter writes COLOR_0 only from the active color attribute.
    attr = me.color_attributes["color"]
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


# LOD0: detailed props ---------------------------------------------------


def tree_round(bm):
    shade_disc(bm, 1.9)
    tube(bm, [(0, 0, 0), (0.05, 0, 1.2), (0.1, 0.05, 2.4)], 0.2, PALETTE["trunk"], segments=10, r_end=0.13)
    for ang, h, l in ((0.4, 1.9, 1.1), (2.5, 2.1, 1.0), (4.3, 2.3, 0.9)):
        tip = (math.cos(ang) * l, math.sin(ang) * l, h + 0.8)
        tube(bm, [(0.08, 0.03, h), ((tip[0] + 0.08) / 2, (tip[1] + 0.03) / 2, h + 0.5), tip], 0.08, PALETTE["bark"], segments=6, r_end=0.04)
    rng = random.Random(7)
    # The main blob uses a finer sphere (320 faces) so the canopy reads round;
    # the others use 80 faces. More faces failed the 55 FPS gate.
    blobs = [((0, 0, 3.6), 2.6, "leaf", 3), ((0.9, 0.3, 3.2), 1.9, "leaf_dark", 2), ((-0.8, 0.5, 3.4), 1.9, "leaf", 2), ((0.2, -0.9, 3.3), 1.8, "leaf_dark", 2), ((0.3, 0.2, 4.5), 1.9, "leaf_light", 2), ((-0.5, -0.4, 4.1), 1.6, "leaf_light", 2)]
    for c, s, col, sub in blobs:
        part(bm, "ico", PALETTE[col], (s, s, s * 0.9), c, subdiv=sub, smooth=True, jitter=0.06, seed=rng.randint(0, 9999))


def tree_tall(bm):
    shade_disc(bm, 1.4)
    tube(bm, [(0, 0, 0), (0, 0, 1.6)], 0.17, PALETTE["trunk"], segments=10, r_end=0.12)
    for i, (z, r, h) in enumerate(((1.4, 1.5, 2.2), (2.6, 1.2, 2.0), (3.7, 0.9, 1.8), (4.6, 0.55, 1.4))):
        part(bm, "cone", PALETTE["pine"] if i % 2 == 0 else PALETTE["leaf_dark"], (r * 2, r * 2, h), (0, 0, z + h / 2), segments=14, smooth=True)


def bench(bm):
    for k in range(4):
        part(bm, "cube", PALETTE["wood"], (1.8, 0.09, 0.05), (0, -0.18 + k * 0.12, 0.45))
    for k in range(3):
        part(bm, "cube", PALETTE["wood"], (1.8, 0.05, 0.09), (0, 0.24, 0.6 + k * 0.13), rot=(-0.18, 0, 0))
    for x in (-0.8, 0.8):
        part(bm, "cube", PALETTE["metal"], (0.07, 0.5, 0.06), (x, 0.0, 0.42))
        part(bm, "cube", PALETTE["metal"], (0.07, 0.06, 0.42), (x, -0.2, 0.21))
        part(bm, "cube", PALETTE["metal"], (0.07, 0.06, 0.88), (x, 0.24, 0.44), rot=(-0.18, 0, 0))
        tube(bm, [(x, -0.24, 0.45), (x, -0.22, 0.62), (x, -0.05, 0.68), (x, 0.2, 0.66)], 0.025, PALETTE["metal"], segments=6)


def lamp(bm):
    part(bm, "cyl", PALETTE["metal"], (0.36, 0.36, 0.35), (0, 0, 0.17), segments=12, r2=0.32, smooth=True)
    tube(bm, [(0, 0, 0.3), (0, 0, 4.0)], 0.07, PALETTE["metal"], segments=10, r_end=0.05)
    arm = [(0, 0, 3.9)]
    for k in range(1, 7):
        t = k / 6
        arm.append((0.9 * t, 0, 3.9 + 0.35 * math.sin(math.pi * t * 0.9)))
    tube(bm, arm, 0.035, PALETTE["metal"], segments=6)
    part(bm, "cone", PALETTE["metal"], (0.5, 0.5, 0.25), (0.92, 0, 4.0), segments=12, smooth=True)
    part(bm, "uv", PALETTE["lamp"], (0.3, 0.3, 0.22), (0.92, 0, 3.86), segments=12, smooth=True)


def bike_rack(bm):
    for x in (-0.6, 0.0, 0.6):
        path = [(x - 0.22, 0, 0)]
        for k in range(9):
            ang = math.pi - math.pi * k / 8
            path.append((x + 0.22 * math.cos(ang), 0, 0.62 + 0.22 * math.sin(ang)))
        path.append((x + 0.22, 0, 0))
        tube(bm, path, 0.03, PALETTE["rack"], segments=8)


def bin_(bm):
    part(bm, "cyl", PALETTE["bin"], (0.6, 0.6, 0.95), (0, 0, 0.48), segments=16, smooth=True, r2=0.46)
    part(bm, "cyl", PALETTE["metal"], (0.66, 0.66, 0.06), (0, 0, 0.97), segments=16, smooth=True)
    part(bm, "uv", PALETTE["metal"], (0.62, 0.62, 0.22), (0, 0, 1.0), segments=16, smooth=True)
    for k in range(6):
        ang = 2 * math.pi * k / 6
        part(bm, "cube", PALETTE["steel"], (0.03, 0.03, 0.8), (math.cos(ang) * 0.29, math.sin(ang) * 0.29, 0.48))


def planter(bm):
    part(bm, "cube", PALETTE["planter"], (1.4, 1.4, 0.5), (0, 0, 0.25))
    part(bm, "cube", PALETTE["planter"], (1.5, 1.5, 0.06), (0, 0, 0.5))
    part(bm, "cube", PALETTE["soil"], (1.25, 1.25, 0.04), (0, 0, 0.5))
    rng = random.Random(3)
    for k in range(5):
        c = (rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0.75)
        part(bm, "ico", PALETTE["leaf"], (0.5, 0.5, 0.45), c, subdiv=2, smooth=True, jitter=0.1, seed=k)
        part(bm, "ico", PALETTE["flower"], (0.12, 0.12, 0.12), (c[0], c[1], c[2] + 0.22), subdiv=1, smooth=True)


def roof_unit(bm):
    part(bm, "cube", PALETTE["unit"], (1.6, 1.2, 0.9), (0, 0, 0.45))
    part(bm, "cyl", PALETTE["metal"], (0.95, 0.95, 0.06), (0, 0, 0.93), segments=16, smooth=True)
    for k in range(4):
        part(bm, "cube", PALETTE["steel"], (0.85, 0.06, 0.02), (0, 0, 0.97), rot=(0, 0, k * math.pi / 4))
    for k in range(5):
        # Grille slats on the front face.
        part(bm, "cube", PALETTE["metal"], (1.4, 0.02, 0.06), (0, -0.61, 0.15 + k * 0.15))


def water_tower(bm):
    for x, y in ((-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9)):
        tube(bm, [(x * 1.1, y * 1.1, 0), (x, y, 2.4)], 0.08, PALETTE["metal"], segments=6, smooth=False)
    for z in (0.8, 1.7):
        for a, b in (((-0.95, -0.95), (0.95, -0.95)), ((0.95, -0.95), (0.95, 0.95)), ((0.95, 0.95), (-0.95, 0.95)), ((-0.95, 0.95), (-0.95, -0.95))):
            tube(bm, [(a[0], a[1], z), (b[0], b[1], z)], 0.03, PALETTE["metal"], segments=5, smooth=False)
    part(bm, "cyl", PALETTE["tower"], (2.8, 2.8, 2.6), (0, 0, 3.7), segments=20, smooth=True)
    for z in (2.7, 3.7, 4.7):
        part(bm, "cyl", PALETTE["metal"], (2.86, 2.86, 0.06), (0, 0, z), segments=20, smooth=True)
    part(bm, "cone", PALETTE["metal"], (3.0, 3.0, 1.0), (0, 0, 5.5), segments=20, smooth=True)
    tube(bm, [(1.45, 0, 2.4), (1.45, 0, 5.0)], 0.03, PALETTE["steel"], segments=5, smooth=False)


# LOD1: the first, simple props ------------------------------------------


def tree_round_lod1(bm):
    shade_disc(bm, 1.7)
    part(bm, "cyl", PALETTE["trunk"], (0.3, 0.3, 2.2), (0, 0, 1.1), segments=6)
    part(bm, "ico", PALETTE["leaf"], (3.2, 3.2, 2.8), (0, 0, 3.6), smooth=True)
    part(bm, "ico", PALETTE["leaf_dark"], (2.0, 2.0, 1.8), (0.6, 0.4, 4.6), smooth=True)


def tree_tall_lod1(bm):
    shade_disc(bm, 1.3)
    part(bm, "cyl", PALETTE["trunk"], (0.28, 0.28, 2.0), (0, 0, 1.0), segments=6)
    part(bm, "cone", PALETTE["pine"], (2.6, 2.6, 4.5), (0, 0, 4.0), segments=8, smooth=True)


def bench_lod1(bm):
    part(bm, "cube", PALETTE["wood"], (1.8, 0.45, 0.08), (0, 0, 0.45))
    part(bm, "cube", PALETTE["wood"], (1.8, 0.08, 0.40), (0, 0.22, 0.70))
    for x in (-0.75, 0.75):
        part(bm, "cube", PALETTE["metal"], (0.08, 0.45, 0.45), (x, 0, 0.22))


def lamp_lod1(bm):
    part(bm, "cyl", PALETTE["metal"], (0.14, 0.14, 4.2), (0, 0, 2.1), segments=6)
    part(bm, "cube", PALETTE["metal"], (0.9, 0.12, 0.10), (0.4, 0, 4.15))
    part(bm, "cube", PALETTE["lamp"], (0.40, 0.25, 0.14), (0.8, 0, 4.05))


def bike_rack_lod1(bm):
    for x in (-0.6, 0.0, 0.6):
        part(bm, "cube", PALETTE["rack"], (0.06, 0.06, 0.8), (x - 0.18, 0, 0.4))
        part(bm, "cube", PALETTE["rack"], (0.06, 0.06, 0.8), (x + 0.18, 0, 0.4))
        part(bm, "cube", PALETTE["rack"], (0.42, 0.06, 0.06), (x, 0, 0.8))


def bin_lod1(bm):
    part(bm, "cyl", PALETTE["bin"], (0.6, 0.6, 1.0), (0, 0, 0.5), segments=8)
    part(bm, "cyl", PALETTE["metal"], (0.66, 0.66, 0.06), (0, 0, 1.02), segments=8)


def planter_lod1(bm):
    part(bm, "cube", PALETTE["planter"], (1.4, 1.4, 0.5), (0, 0, 0.25))
    part(bm, "ico", PALETTE["leaf"], (1.2, 1.2, 0.7), (0, 0, 0.7))


def roof_unit_lod1(bm):
    part(bm, "cube", PALETTE["unit"], (1.6, 1.2, 0.9), (0, 0, 0.45))
    part(bm, "cyl", PALETTE["metal"], (0.9, 0.9, 0.08), (0, 0, 0.94), segments=8)


def water_tower_lod1(bm):
    for x, y in ((-0.9, -0.9), (0.9, -0.9), (0.9, 0.9), (-0.9, 0.9)):
        part(bm, "cube", PALETTE["metal"], (0.15, 0.15, 2.4), (x, y, 1.2))
    part(bm, "cyl", PALETTE["tower"], (2.8, 2.8, 2.6), (0, 0, 3.7), segments=10)
    part(bm, "cone", PALETTE["metal"], (3.0, 3.0, 1.0), (0, 0, 5.5), segments=10)


BUILDERS = {
    "tree_round": tree_round,
    "tree_tall": tree_tall,
    "bench": bench,
    "lamp": lamp,
    "bike_rack": bike_rack,
    "bin": bin_,
    "planter": planter,
    "roof_unit": roof_unit,
    "water_tower": water_tower,
    "tree_round_lod1": tree_round_lod1,
    "tree_tall_lod1": tree_tall_lod1,
    "bench_lod1": bench_lod1,
    "lamp_lod1": lamp_lod1,
    "bike_rack_lod1": bike_rack_lod1,
    "bin_lod1": bin_lod1,
    "planter_lod1": planter_lod1,
    "roof_unit_lod1": roof_unit_lod1,
    "water_tower_lod1": water_tower_lod1,
}


def main():
    clear()
    made = []
    for i, (name, build) in enumerate(BUILDERS.items()):
        ob = prop(name, build)
        row = 1 if name.endswith("_lod1") else 0
        ob.location = ((i % 9) * 5.0, row * 8.0, 0)  # Spread out for a look; reset before export.
        made.append(ob)
    report = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in made}
    if OUT:
        saved = {ob.name: ob.location.copy() for ob in made}
        for ob in made:
            ob.location = (0, 0, 0)
        bpy.ops.object.select_all(action="DESELECT")
        for ob in made:
            ob.select_set(True)
        bpy.ops.export_scene.gltf(
            filepath=OUT,
            export_format="GLB",
            use_selection=True,
            export_apply=True,
            export_vertex_color="ACTIVE",
            export_all_vertex_colors=False,
            export_active_vertex_color_when_no_material=True,
            export_materials="NONE",
            export_normals=True,
            export_texcoords=False,
        )
        for ob in made:
            ob.location = saved[ob.name]
    print("triangles", report)


main()
