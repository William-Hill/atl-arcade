# Street kit for the BeltLine Eastside block (M1-08, #40).
#
# Run inside Blender (Blender MCP execute_blender_code, or
#   blender -b -P scripts/blender/street_kit.py -- <out.glb>).
# It builds low-poly props from primitives, gives each prop one mesh with a
# vertex color layer (no textures), and exports them to one glTF binary.
# Units: meters. Blender is Z-up; the glTF exporter writes Y-up.
#
# Props: tree_round, tree_tall, bench, lamp, bike_rack, bin, planter,
# roof_unit, water_tower.
# Every prop stands on z = 0 with its center on x = y = 0. The long side of
# a bench and a bike rack is along x. The seat back of a bench is at +y in
# Blender, which is -z in three.js after the Y-up export.

import math
import sys

import bmesh
import bpy
from mathutils import Matrix

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None

PALETTE = {
    "trunk": (0.42, 0.28, 0.18),
    "leaf": (0.33, 0.62, 0.30),
    "leaf_dark": (0.24, 0.50, 0.26),
    "wood": (0.78, 0.52, 0.30),
    "metal": (0.20, 0.22, 0.26),
    "lamp": (1.00, 0.90, 0.60),
    "rack": (0.95, 0.70, 0.20),
    "bin": (0.16, 0.45, 0.62),
    "planter": (0.72, 0.66, 0.58),
    "unit": (0.70, 0.72, 0.74),
    "shade": (0.30, 0.40, 0.26),
    "tower": (0.55, 0.40, 0.30),
}


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)


def part(bm, kind, color, size=(1, 1, 1), loc=(0, 0, 0), rot_z=0.0, segments=8, subdiv=1):
    """Adds a primitive to the bmesh and paints its faces one color."""
    tmp = bmesh.new()
    if kind == "cube":
        bmesh.ops.create_cube(tmp, size=1.0)
    elif kind == "cyl":
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=segments, radius1=0.5, radius2=0.5, depth=1.0)
    elif kind == "cone":
        bmesh.ops.create_cone(tmp, cap_ends=True, segments=segments, radius1=0.5, radius2=0.0, depth=1.0)
    elif kind == "ico":
        bmesh.ops.create_icosphere(tmp, subdivisions=subdiv, radius=0.5)
    bmesh.ops.scale(tmp, vec=size, verts=tmp.verts)
    bmesh.ops.rotate(tmp, verts=tmp.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, "Z"))
    bmesh.ops.translate(tmp, vec=loc, verts=tmp.verts)
    layer = tmp.loops.layers.color.new("color")
    for f in tmp.faces:
        for l in f.loops:
            l[layer] = (*color, 1.0)
    me = bpy.data.meshes.new("tmp")
    tmp.to_mesh(me)
    tmp.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)


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


def shade_disc(bm, radius):
    # A flat dark disc 3.5 cm above the ground: a stylized shadow, because the
    # geodata level has no shadow map (see docs/decisions.md).
    part(bm, "cyl", PALETTE["shade"], (radius * 2, radius * 2, 0.01), (0.35, 0.25, 0.035), segments=10)


def tree_round(bm):
    shade_disc(bm, 1.7)
    part(bm, "cyl", PALETTE["trunk"], (0.3, 0.3, 2.2), (0, 0, 1.1), segments=6)
    part(bm, "ico", PALETTE["leaf"], (3.2, 3.2, 2.8), (0, 0, 3.6))
    part(bm, "ico", PALETTE["leaf_dark"], (2.0, 2.0, 1.8), (0.6, 0.4, 4.6))


def tree_tall(bm):
    shade_disc(bm, 1.3)
    part(bm, "cyl", PALETTE["trunk"], (0.28, 0.28, 2.0), (0, 0, 1.0), segments=6)
    part(bm, "cone", PALETTE["leaf_dark"], (2.6, 2.6, 4.5), (0, 0, 4.0), segments=7)


def bench(bm):
    part(bm, "cube", PALETTE["wood"], (1.8, 0.45, 0.08), (0, 0, 0.45))
    part(bm, "cube", PALETTE["wood"], (1.8, 0.08, 0.40), (0, 0.22, 0.70))
    for x in (-0.75, 0.75):
        part(bm, "cube", PALETTE["metal"], (0.08, 0.45, 0.45), (x, 0, 0.22))


def lamp(bm):
    part(bm, "cyl", PALETTE["metal"], (0.14, 0.14, 4.2), (0, 0, 2.1), segments=6)
    part(bm, "cube", PALETTE["metal"], (0.9, 0.12, 0.10), (0.4, 0, 4.15))
    part(bm, "cube", PALETTE["lamp"], (0.40, 0.25, 0.14), (0.8, 0, 4.05))


def bike_rack(bm):
    for x in (-0.6, 0.0, 0.6):
        part(bm, "cube", PALETTE["rack"], (0.06, 0.06, 0.8), (x - 0.18, 0, 0.4))
        part(bm, "cube", PALETTE["rack"], (0.06, 0.06, 0.8), (x + 0.18, 0, 0.4))
        part(bm, "cube", PALETTE["rack"], (0.42, 0.06, 0.06), (x, 0, 0.8))


def bin_(bm):
    part(bm, "cyl", PALETTE["bin"], (0.6, 0.6, 1.0), (0, 0, 0.5), segments=8)
    part(bm, "cyl", PALETTE["metal"], (0.66, 0.66, 0.06), (0, 0, 1.02), segments=8)


def planter(bm):
    part(bm, "cube", PALETTE["planter"], (1.4, 1.4, 0.5), (0, 0, 0.25))
    part(bm, "ico", PALETTE["leaf"], (1.2, 1.2, 0.7), (0, 0, 0.7))


def roof_unit(bm):
    part(bm, "cube", PALETTE["unit"], (1.6, 1.2, 0.9), (0, 0, 0.45))
    part(bm, "cyl", PALETTE["metal"], (0.9, 0.9, 0.08), (0, 0, 0.94), segments=8)


def water_tower(bm):
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
}


def main():
    clear()
    made = []
    for i, (name, build) in enumerate(BUILDERS.items()):
        ob = prop(name, build)
        ob.location = (i * 5.0, 0, 0)  # Spread out for a look; reset before export.
        made.append(ob)
    report = {}
    for ob in made:
        report[ob.name] = len(ob.data.polygons)
    if OUT:
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
        for i, ob in enumerate(made):
            ob.location = (i * 5.0, 0, 0)
    print(report)


main()
