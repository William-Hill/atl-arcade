"""Storefront dressing for the BeltLine Eastside level (pbr look).

    blender -b -P scripts/blender/storefronts.py -- OUT_DIR [--embed] [--only sign_boards,neon_signs]

Builds the shop pieces of the invented Eastside businesses
(scripts/assets/storefront-businesses.json) from primitives, swept tubes and
extruded outlines, and exports one Draco GLB per piece type into OUT_DIR:
sign_boards, blade_signs, neon_signs, menu_boards, sandwich_boards,
cafe_barriers, patio_furniture, patio_umbrellas, string_lights.

Every textured face samples the one shared sign atlas
(OUT_DIR/storefront-atlas.jpg, painted by scripts/assets/storefront-atlas.mjs;
it is run first when the atlas is missing). By default the GLBs reference the
atlas as an external image (uri "storefront-atlas.jpg"), so a browser fetches
it once; --embed keeps a copy in each GLB instead.

Materials (shared by name across files, so a loader can share one texture):
  sf_sign   atlas base color (sign art, chalk, banners)
  sf_neon   atlas base color + atlas emissive, emissive strength > 1 (neon,
            bulbs, lamp glow; the post bloom threshold is 0.92)
  sf_paint, sf_metal, sf_wood, sf_fabric   COLOR_0 vertex color, no texture
Units are meters, +y up and the front at +z in glTF (Blender -y).
Wall pieces: the back sits on the wall plane (glTF z = 0), x centered, y = 0
at the lowest point. Floor pieces: base at y = 0, centered on x = z = 0.
Large pieces carry <name>_lod1. Sets are empties whose children share meshes.
"""
import json
import math
import os
import struct
import subprocess
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "assets/storefronts")
EMBED = "--embed" in argv
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
ONLY = opt("--only")
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
os.makedirs(OUT, exist_ok=True)

ATLAS_JSON = os.path.join(OUT, "storefront-atlas.json")
if not os.path.exists(ATLAS_JSON):
    subprocess.run(["node", os.path.join(ROOT, "scripts/assets/storefront-atlas.mjs"), "--out", OUT], check=True)
ATLAS = json.load(open(ATLAS_JSON))
BIZ = {b["id"]: b for b in json.load(open(os.path.join(ROOT, "scripts/assets/storefront-businesses.json")))["businesses"]}
SIZE = ATLAS["size"]
NEON_STRENGTH = 3.0
BULB_STRENGTH = 5.0


def lin(h, a=1.0):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c) + (a,)


def mul(c, k):
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


WHITE = (1.0, 1.0, 1.0, 1.0)
IRON = lin("#26282b")
STEEL = lin("#6c7075")
WOOD = lin("#9a6b42")
WOOD_DARK = lin("#5e3d24")
CHALK_FRAME = lin("#6b4a2e")
CONCRETE = lin("#a9a59c")


# ---------- materials ----------------------------------------------------------
MATS = ["sf_sign", "sf_neon", "sf_paint", "sf_metal", "sf_wood", "sf_fabric"]
SIGN, NEON, PAINT, METAL, WOODM, FABRIC = range(6)


def build_materials():
    img = bpy.data.images.load(os.path.join(OUT, ATLAS["image"]))
    img.name = "storefront-atlas"
    out = []
    for name in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.use_backface_culling = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        if name in ("sf_sign", "sf_neon"):
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = img
            tex.interpolation = "Linear"
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = 0.5 if name == "sf_sign" else 0.3
            if name == "sf_neon":
                nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
                bsdf.inputs["Emission Strength"].default_value = NEON_STRENGTH
        else:
            ca = nt.nodes.new("ShaderNodeVertexColor")
            ca.layer_name = "Col"
            nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
            rough, metal = {"sf_paint": (0.55, 0.0), "sf_metal": (0.42, 0.85), "sf_wood": (0.72, 0.0), "sf_fabric": (0.88, 0.0)}[name]
            bsdf.inputs["Roughness"].default_value = rough
            bsdf.inputs["Metallic"].default_value = metal
        out.append(m)
    return out


# ---------- atlas uv -------------------------------------------------------------
def region_uv(key, inset=2):
    x, y, w, h = ATLAS["regions"][key] if key in ATLAS["regions"] else ATLAS["swatches"][key]["rect"]

    def f(u, v):
        return ((x + inset + u * (w - 2 * inset)) / SIZE, 1 - (y + inset + (1 - v) * (h - 2 * inset)) / SIZE)
    return f


def swatch_uv(name):
    f = region_uv(name, inset=16)
    return f(0.5, 0.5)


DEFAULT_UV = (0.0, 0.0)


# ---------- mesh builder ---------------------------------------------------------
class M:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")

    def face(self, pts, mat, color=WHITE, uvs=None, smooth=False):
        vs = [p if isinstance(p, bmesh.types.BMVert) else self.bm.verts.new(p) for p in pts]
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = mat
        f.smooth = smooth
        for i, l in enumerate(f.loops):
            l[self.col] = color
            l[self.uv].uv = uvs[i] if uvs else (uvs_const := DEFAULT_UV)
        return f

    def quad(self, o, a, b, mat, color=WHITE, uvf=None, flipu=False):
        o, a, b = Vector(o), Vector(a), Vector(b)
        pts = [o, o + a, o + a + b, o + b]
        uvs = None
        if uvf:
            us = [(0, 0), (1, 0), (1, 1), (0, 1)]
            uvs = [uvf(1 - u if flipu else u, v) for u, v in us]
        self.face(pts, mat, color, uvs)

    def box(self, lo, hi, mat, color=WHITE, front=None, back=None, skip=()):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        dx, dy, dz = x1 - x0, y1 - y0, z1 - z0
        faces = {
            "-y": ((x0, y0, z0), (dx, 0, 0), (0, 0, dz), front),
            "+y": ((x1, y1, z0), (-dx, 0, 0), (0, 0, dz), back),
            "-x": ((x0, y1, z0), (0, -dy, 0), (0, 0, dz), None),
            "+x": ((x1, y0, z0), (0, dy, 0), (0, 0, dz), None),
            "-z": ((x0, y1, z0), (dx, 0, 0), (0, -dy, 0), None),
            "+z": ((x0, y0, z1), (dx, 0, 0), (0, dy, 0), None),
        }
        for k, (o, a, b, art) in faces.items():
            if k in skip:
                continue
            if art:
                self.quad(o, a, b, art[0], WHITE, art[1])
            else:
                self.quad(o, a, b, mat, color)

    def tube(self, pts, radii, seg, mat, color, caps=True, smooth=True, uv=None):
        pts = [Vector(p) for p in pts]
        if not isinstance(radii, (list, tuple)):
            radii = [radii] * len(pts)
        rings = []
        t0 = (pts[1] - pts[0]).normalized()
        n = t0.orthogonal().normalized()
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            n = (n - t * n.dot(t)).normalized()
            b = t.cross(n)
            rings.append([self.bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radii[i]) for a in (2 * math.pi * k / seg for k in range(seg))])
        uvs = [uv] * 4 if uv else None
        for r0, r1 in zip(rings, rings[1:]):
            for k in range(seg):
                self.face([r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]], mat, color, uvs, smooth)
        if caps:
            for ring, rev in ((rings[0], True), (rings[-1], False)):
                if radii[0 if rev else -1] > 1e-5:
                    self.face(list(reversed(ring)) if rev else ring, mat, color, [uv] * seg if uv else None)

    def cyl(self, p0, p1, r, seg, mat, color, caps=True, r1=None, uv=None):
        self.tube([p0, p1], [r, r if r1 is None else r1], seg, mat, color, caps, uv=uv)

    def sphere(self, c, r, seg, rings, mat, color, uv=None, squash=1.0):
        c = Vector(c)
        top = self.bm.verts.new(c + Vector((0, 0, r * squash)))
        bot = self.bm.verts.new(c - Vector((0, 0, r * squash)))
        lat = []
        for i in range(1, rings):
            th = math.pi * i / rings
            lat.append([self.bm.verts.new(c + Vector((math.sin(th) * math.cos(2 * math.pi * k / seg) * r, math.sin(th) * math.sin(2 * math.pi * k / seg) * r, math.cos(th) * r * squash))) for k in range(seg)])
        u3, u4 = ([uv] * 3, [uv] * 4) if uv else (None, None)
        for k in range(seg):
            k1 = (k + 1) % seg
            self.face([top, lat[0][k], lat[0][k1]], mat, color, u3, True)
            self.face([bot, lat[-1][k1], lat[-1][k]], mat, color, u3, True)
            for a, b in zip(lat, lat[1:]):
                self.face([a[k], b[k], b[k1], a[k1]], mat, color, u4, True)

    def panel(self, outline, O, U, V, N, t, front, side_mat, side_color, back=None, back_color=None):
        """Extrude an outline (u, v in 0..1) in the plane O + U u + V v, t thick
        along N. front/back: (mat, uv fn) for art, or None for side color."""
        O, U, V, N = Vector(O), Vector(U), Vector(V), Vector(N).normalized()
        ccw = U.cross(V).dot(N) > 0
        pts = outline if ccw else list(reversed(outline))
        F = [O + U * u + V * v + N * (t / 2) for u, v in pts]
        B = [O + U * u + V * v - N * (t / 2) for u, v in pts]
        if front:
            self.face(F, front[0], WHITE, [front[1](u, v) for u, v in pts])
        else:
            self.face(F, side_mat, side_color)
        rev = list(reversed(pts))
        Br = list(reversed(B))
        if back:
            self.face(Br, back[0], WHITE, [back[1](1 - u, v) for u, v in rev])
        else:
            self.face(Br, side_mat, back_color or side_color)
        n = len(pts)
        for i in range(n):
            j = (i + 1) % n
            self.face([F[j], F[i], B[i], B[j]], side_mat, side_color)

    def finish(self, name, mats):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        col = me.color_attributes["Col"]
        me.color_attributes.active_color = col
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
        for m in mats:
            me.materials.append(m)
        obj = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(obj)
        return obj


def tris(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# ---------- shared parts ---------------------------------------------------------
def gooseneck(m, x, top, out=0.42, seg=6):
    """A gooseneck sign lamp on the wall plane over a board whose top is at
    `top`; the shade points down at the board face."""
    arm = [(x, 0.0, top + 0.18), (x, -0.06, top + 0.32), (x, -0.2, top + 0.4), (x, -out + 0.06, top + 0.38), (x, -out, top + 0.3)]
    m.box((x - 0.05, -0.02, top + 0.1), (x + 0.05, 0.0, top + 0.26), METAL, IRON)
    m.tube(arm, 0.016, seg, METAL, IRON, caps=False)
    tip = Vector(arm[-1])
    d = Vector((0, 0.45, -1)).normalized()
    m.cyl(tip - d * 0.02, tip + d * 0.1, 0.035, 10, METAL, IRON, caps=False, r1=0.09)
    # The lit lens, a disc at the mouth of the shade (sf_neon, warm swatch).
    c = tip + d * 0.095
    b1 = d.orthogonal().normalized()
    b2 = d.cross(b1)
    ring = [c + (b1 * math.cos(a) + b2 * math.sin(a)) * 0.085 for a in (2 * math.pi * k / 10 for k in range(10))]
    uv = swatch_uv("warm")
    m.face(list(reversed(ring)), NEON, WHITE, [uv] * 10)
    m.face(ring, METAL, IRON)


def rect_outline():
    return [(0, 0), (1, 0), (1, 1), (0, 1)]


def blade_outline(shape, n=28):
    # Pixel outline in the 128 x 96 blade region (matches the painted rim).
    w, h, i = 128.0, 96.0, 3.0
    if shape == "round":
        pts = [(w / 2 + (w / 2 - i) * math.cos(a), h / 2 + (h / 2 - i) * math.sin(a)) for a in (2 * math.pi * k / n for k in range(n))]
    elif shape == "shield":
        pts = [(i, h - i), (w - i, h - i), (w - i, 30)]
        for k in range(1, 12):
            t = k / 12
            x = (1 - t) ** 2 * (w - i) + 2 * (1 - t) * t * (w / 2) + t * t * i
            y = (1 - t) ** 2 * 30 + 2 * (1 - t) * t * (-7) + t * t * 30
            pts.append((x, y))
        pts.append((i, 30))
    else:
        pts = [(i, i), (w - i, i), (w - i, h - i), (i, h - i)]
    out = [(x / w, 1 - y / h) for x, y in pts]
    # Counter-clockwise in (u, v).
    area = sum(out[k][0] * out[(k + 1) % len(out)][1] - out[(k + 1) % len(out)][0] * out[k][1] for k in range(len(out)))
    return out if area > 0 else list(reversed(out))


def outline_top(outline, u):
    best = 0.0
    for (u0, v0), (u1, v1) in zip(outline, outline[1:] + outline[:1]):
        if (u0 - u) * (u1 - u) <= 0 and u0 != u1:
            best = max(best, v0 + (v1 - v0) * (u - u0) / (u1 - u0))
    return best


# ---------- pieces -------------------------------------------------------------------
BOARD_W, BOARD_H, BOARD_D = 2.4, 0.6, 0.07


def sign_board(b, mats, wide=False):
    m = M()
    W = 3.6 if wide else BOARD_W
    trim = IRON
    bgc = lin(b["bg"])
    art = region_uv(f"board_{b['id']}")
    # Body: painted box, the art panel on its face, and a metal edge trim.
    m.box((-W / 2, -BOARD_D, 0), (W / 2, 0, BOARD_H), PAINT, bgc, skip=("-y",))
    x0 = -BOARD_W / 2
    m.quad((x0, -BOARD_D, 0), (BOARD_W, 0, 0), (0, 0, BOARD_H), SIGN, WHITE, art)
    if wide:
        for sx in (-W / 2, BOARD_W / 2):
            m.quad((sx, -BOARD_D, 0), ((W - BOARD_W) / 2, 0, 0), (0, 0, BOARD_H), PAINT, bgc)
            # A small rosette on each wing.
            cx = sx + (W - BOARD_W) / 4
            m.cyl((cx, -BOARD_D, BOARD_H / 2), (cx, -BOARD_D - 0.015, BOARD_H / 2), 0.07, 12, PAINT, lin(b["accent"]))
    e = 0.025
    m.box((-W / 2 - e, -BOARD_D - e, BOARD_H), (W / 2 + e, 0, BOARD_H + e), METAL, trim)
    m.box((-W / 2 - e, -BOARD_D - e, -e), (W / 2 + e, 0, 0), METAL, trim)
    for sx in (-W / 2 - e, W / 2):
        m.box((sx, -BOARD_D - e, 0), (sx + e, 0, BOARD_H), METAL, trim)
    if b.get("lamps"):
        n = 3 if wide else 2
        for k in range(n):
            gooseneck(m, -W / 2 + W * (k + 0.5) / n, BOARD_H)
    return m.finish(f"sign_board_{b['id']}" + ("_wide" if wide else ""), mats)


BLADE_W, BLADE_H, BLADE_T, BLADE_GAP = 0.72, 0.54, 0.04, 0.16


def blade_sign(b, mats):
    m = M()
    out = blade_outline(b["blade"])
    art = region_uv(f"blade_{b['id']}")
    far = -(BLADE_GAP + BLADE_W)
    # Panel in the plane x = 0: u runs from the far end to the wall.
    m.panel(out, (0, far, 0), (0, BLADE_W, 0), (0, 0, BLADE_H), (1, 0, 0), BLADE_T, (SIGN, art), PAINT, lin(b["accent"]), back=(SIGN, art))
    top = BLADE_H + 0.12
    arm_end = far - 0.08
    m.box((-0.05, -0.02, top - 0.2), (0.05, 0.0, top + 0.08), METAL, IRON)
    m.tube([(0, 0, top), (0, arm_end, top)], 0.018, 6, METAL, IRON)
    m.sphere((0, arm_end - 0.02, top), 0.035, 8, 4, METAL, IRON)
    # Scroll brace under the arm.
    sc = [(0, -0.0 - 0.02, top - 0.17)] + [(0, -0.1 - 0.32 * t, top - 0.17 * (1 - t) ** 2 - 0.01) for t in (0.15, 0.35, 0.6, 0.85, 1.0)]
    m.tube(sc, 0.012, 5, METAL, IRON, caps=False)
    m.tube([(0, -0.3, top - 0.01), (0, -0.25, top - 0.09), (0, -0.33, top - 0.12), (0, -0.37, top - 0.06)], 0.009, 5, METAL, IRON, caps=False)
    for u in (0.22, 0.78):
        y = far + u * BLADE_W
        vz = outline_top(out, u) * BLADE_H
        m.cyl((0, y, vz - 0.01), (0, y, top), 0.008, 5, METAL, STEEL)
    return m.finish(f"blade_sign_{b['id']}", mats)


NEON_W, NEON_H = 1.1, 0.55


def neon_sign(key, mats):
    m = M()
    art = region_uv(f"neon_{key}")
    d = 0.1
    m.box((-NEON_W / 2, -d - 0.02, 0), (NEON_W / 2, -d, NEON_H), METAL, lin("#121117"), front=(NEON, art))
    # Clear acrylic edge and four standoffs to a raceway on the wall.
    for x in (-NEON_W / 2 + 0.08, NEON_W / 2 - 0.08):
        for z in (0.08, NEON_H - 0.08):
            m.cyl((x, 0, z), (x, -d, z), 0.012, 6, METAL, STEEL)
    m.box((-NEON_W * 0.35, -0.05, NEON_H * 0.3), (NEON_W * 0.35, 0, NEON_H * 0.42), METAL, IRON)
    m.cyl((NEON_W * 0.35, -0.03, NEON_H * 0.36), (NEON_W * 0.5 + 0.05, -0.03, NEON_H * 0.36), 0.008, 5, METAL, IRON)
    return m.finish(f"neon_sign_{key}", mats)


MENU_W, MENU_H = 0.6, 0.975


def menu_board(b, mats):
    m = M()
    art = region_uv(f"menu_{b['id']}")
    f, d = 0.05, 0.035
    m.box((-MENU_W / 2, -d + 0.01, 0), (MENU_W / 2, 0, MENU_H), PAINT, lin("#26302e"), front=(SIGN, art))
    for lo, hi in (((-MENU_W / 2 - f, -d, -f), (MENU_W / 2 + f, 0, 0)), ((-MENU_W / 2 - f, -d, MENU_H), (MENU_W / 2 + f, 0, MENU_H + f)),
                   ((-MENU_W / 2 - f, -d, 0), (-MENU_W / 2, 0, MENU_H)), ((MENU_W / 2, -d, 0), (MENU_W / 2 + f, 0, MENU_H))):
        m.box(lo, hi, WOODM, CHALK_FRAME)
    # Chalk ledge.
    m.box((-MENU_W / 2, -d - 0.05, -f), (MENU_W / 2, -d, -f + 0.02), WOODM, CHALK_FRAME)
    if b.get("lamps"):
        gooseneck(m, 0, MENU_H + f, out=0.3)
    return m.finish(f"menu_board_{b['id']}", mats)


SW_W, SW_H, SW_TILT = 0.62, 1.0, math.radians(13)


def sandwich_board(b, mats):
    m = M()
    art = region_uv(f"sandwich_{b['id']}")
    up = Vector((0, math.sin(SW_TILT), math.cos(SW_TILT)))
    for side in (-1, 1):
        # Leg frame from the floor to the hinge; side -1 faces the front (-y).
        base = Vector((0, side * SW_H * math.sin(SW_TILT), 0))
        u = Vector((0, -side * math.sin(SW_TILT), math.cos(SW_TILT)))
        n = Vector((0, side, 0)).cross(Vector((1, 0, 0))).cross(u)
        n = Vector((0, side * math.cos(SW_TILT), math.sin(SW_TILT)))
        for x in (-SW_W / 2, SW_W / 2 - 0.04):
            p0 = base + Vector((x + 0.02, 0, 0))
            m.tube([p0, p0 + u * SW_H], 0.022, 4, WOODM, WOOD, smooth=False)
        # Chalk panel (art) and the wooden kick panel under it.
        o = base + u * 0.32 + n * 0.012 + Vector((-SW_W / 2 + 0.03, 0, 0))
        U = Vector((SW_W - 0.06, 0, 0))
        V = u * 0.64
        if side < 0:
            m.quad(o, U, V, SIGN, WHITE, art)
        else:
            m.quad(o + U, -U, V, SIGN, WHITE, art)
        m.panel(rect_outline(), base + u * 0.08 + Vector((-SW_W / 2 + 0.03, 0, 0)), U, u * 0.22, n, 0.018, None, WOODM, lin(b["bg"]))
        m.panel(rect_outline(), base + u * 0.3 + Vector((-SW_W / 2 + 0.03, 0, 0)), U, u * 0.68, n, 0.012, None, PAINT, lin("#26302e"))
    m.cyl((-SW_W / 2, 0, SW_H * math.cos(SW_TILT)), (SW_W / 2, 0, SW_H * math.cos(SW_TILT)), 0.018, 6, METAL, IRON)
    return m.finish(f"sandwich_board_{b['id']}", mats)


BAR_W, BAR_H = 1.8, 0.45


def cafe_barrier(b, mats):
    m = M()
    art = region_uv(f"board_{b['id']}")
    z0 = 0.32
    m.panel(rect_outline(), (-BAR_W / 2, 0, z0), (BAR_W, 0, 0), (0, 0, BAR_H), (0, -1, 0), 0.01, (FABRIC, art) if False else (SIGN, art), FABRIC, lin(b["bg"]), back=(SIGN, art))
    for x in (-BAR_W / 2 - 0.03, BAR_W / 2 + 0.03):
        m.cyl((x, 0, 0.02), (x, 0, 0.95), 0.022, 8, METAL, IRON)
        m.sphere((x, 0, 0.97), 0.03, 8, 4, METAL, IRON)
        m.box((x - 0.06, -0.2, 0), (x + 0.06, 0.2, 0.025), METAL, IRON)
    m.cyl((-BAR_W / 2 - 0.03, 0, 0.9), (BAR_W / 2 + 0.03, 0, 0.9), 0.014, 6, METAL, IRON)
    return m.finish(f"cafe_barrier_{b['id']}", mats)


CHAIR_COLORS = {"green": "#2f6b4f", "teal": "#1f8a8a", "red": "#b8423a"}


def bistro_chair(color, mats, lod=0):
    m = M()
    c = lin(color)
    s = 10 if lod == 0 else 6
    ts = 5 if lod == 0 else 3
    m.cyl((0, 0, 0.43), (0, 0, 0.46), 0.21, s * 2 if lod == 0 else 8, METAL, c)
    for a in (45, 135, 225, 315):
        r = math.radians(a)
        top = (math.cos(r) * 0.16, math.sin(r) * 0.16, 0.43)
        foot = (math.cos(r) * 0.22, math.sin(r) * 0.22, 0.0)
        m.tube([foot, top], 0.012, ts, METAL, c)
    hoop = [(math.cos(t) * 0.19, 0.05 + math.sin(t) * 0.16, 0.46 + 0.4 * math.sin(t) ** 0.6) for t in (math.pi * k / 10 for k in range(11))] if lod == 0 else [(0.19, 0.05, 0.46), (0.15, 0.17, 0.86), (-0.15, 0.17, 0.86), (-0.19, 0.05, 0.46)]
    m.tube(hoop, 0.012, ts, METAL, c, caps=False)
    if lod == 0:
        m.tube([(-0.15, 0.17, 0.74), (0, 0.22, 0.76), (0.15, 0.17, 0.74)], 0.03, 4, METAL, c)
        for x in (-0.06, 0.06):
            m.tube([(x, 0.16, 0.46), (x, 0.21, 0.73)], 0.008, 4, METAL, c)
    name = f"patio_chair_bistro_{[k for k, v in CHAIR_COLORS.items() if v == color][0]}"
    return m.finish(name + ("_lod1" if lod else ""), mats)


def bistro_table(mats, lod=0):
    m = M()
    s = 20 if lod == 0 else 8
    m.cyl((0, 0, 0.71), (0, 0, 0.74), 0.3, s, PAINT, lin("#c9c1b2"))
    m.cyl((0, 0, 0.69), (0, 0, 0.71), 0.29, s, METAL, IRON, caps=False)
    m.cyl((0, 0, 0.02), (0, 0, 0.69), 0.025, 8 if lod == 0 else 5, METAL, IRON)
    m.cyl((0, 0, 0), (0, 0, 0.03), 0.22, s, METAL, IRON)
    return m.finish("patio_table_bistro" + ("_lod1" if lod else ""), mats)


def four_table(mats, lod=0):
    m = M()
    for k in range(5 if lod == 0 else 1):
        if lod == 0:
            y0 = -0.4 + k * 0.16
            m.box((-0.4, y0 + 0.005, 0.72), (0.4, y0 + 0.155, 0.75), WOODM, mul(WOOD, 1 + 0.06 * ((k * 7) % 3 - 1)))
        else:
            m.box((-0.4, -0.4, 0.72), (0.4, 0.4, 0.75), WOODM, WOOD)
    for x in (-0.36, 0.36):
        for y in (-0.36, 0.36):
            m.box((x - 0.02, y - 0.02, 0), (x + 0.02, y + 0.02, 0.72), METAL, IRON)
    m.box((-0.37, -0.37, 0.66), (0.37, 0.37, 0.72), METAL, IRON, skip=("+z", "-z")) if lod == 0 else None
    return m.finish("patio_table_four" + ("_lod1" if lod else ""), mats)


def slat_chair(mats, lod=0):
    m = M()
    for x in (-0.2, 0.2):
        m.box((x - 0.015, -0.2, 0), (x + 0.015, -0.17, 0.44), METAL, IRON)
        m.box((x - 0.015, 0.17, 0), (x + 0.015, 0.2, 0.88), METAL, IRON)
        m.box((x - 0.015, -0.2, 0.41), (x + 0.015, 0.2, 0.44), METAL, IRON)
    n = 4 if lod == 0 else 1
    for k in range(n):
        if lod == 0:
            y0 = -0.21 + k * 0.105
            m.box((-0.22, y0, 0.44), (0.22, y0 + 0.09, 0.465), WOODM, WOOD)
        else:
            m.box((-0.22, -0.21, 0.44), (0.22, 0.21, 0.465), WOODM, WOOD)
    for k in range(3 if lod == 0 else 1):
        z0 = 0.56 + k * 0.1 if lod == 0 else 0.56
        m.box((-0.22, 0.2, z0), (0.22, 0.225, z0 + (0.075 if lod == 0 else 0.28)), WOODM, WOOD)
    return m.finish("patio_chair_slat" + ("_lod1" if lod else ""), mats)


def picnic(mats, lod=0):
    m = M()
    L = 1.8
    planks = 5 if lod == 0 else 1
    for k in range(planks):
        if lod == 0:
            y0 = -0.36 + k * 0.145
            m.box((-L / 2, y0 + 0.005, 0.72), (L / 2, y0 + 0.14, 0.755), WOODM, mul(WOOD, 1 + 0.05 * ((k * 5) % 3 - 1)))
        else:
            m.box((-L / 2, -0.36, 0.72), (L / 2, 0.36, 0.755), WOODM, WOOD)
    for sy in (-1, 1):
        m.box((-L / 2, sy * 0.62 - 0.13, 0.43), (L / 2, sy * 0.62 + 0.13, 0.465), WOODM, mul(WOOD, 0.95))
    for x in (-L / 2 + 0.25, L / 2 - 0.25):
        for sy in (-1, 1):
            m.tube([(x, sy * 0.72, 0.0), (x, sy * 0.05, 0.72)], 0.04, 4, WOODM, WOOD_DARK, smooth=False)
        m.box((x - 0.04, -0.75, 0.37), (x + 0.04, 0.75, 0.43), WOODM, WOOD_DARK)
    return m.finish("patio_picnic" + ("_lod1" if lod else ""), mats)


UMBRELLAS = {"marigold": ("#f2b233", "#fff4dc"), "teal": ("#178f8a", "#f4f1e8"), "tomato": ("#c8372d", "#f7ecd7"), "sage": ("#5d8a5a", "#5d8a5a")}


def umbrella(name, cols, mats, lod=0):
    m = M()
    a, b = lin(cols[0]), lin(cols[1])
    R, H, rise = 1.2, 2.35, 0.42
    n = 8
    rings = [(0.0, H + rise), (0.55, H + rise * 0.55), (R, H)] if lod == 0 else [(0.0, H + rise), (R, H)]
    m.cyl((0, 0, 0.05), (0, 0, H + rise + 0.05), 0.022, 8 if lod == 0 else 4, WOODM, WOOD)
    m.cyl((0, 0, 0), (0, 0, 0.08), 0.24, 12 if lod == 0 else 6, METAL, IRON)
    m.sphere((0, 0, H + rise + 0.09), 0.04, 6, 3, WOODM, WOOD)
    for k in range(n):
        t0, t1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        c = a if k % 2 == 0 else b
        under = mul(c, 0.7)
        for (r0, z0), (r1, z1) in zip(rings, rings[1:]):
            p = [(r0 * math.cos(t0), r0 * math.sin(t0), z0), (r1 * math.cos(t0), r1 * math.sin(t0), z1), (r1 * math.cos(t1), r1 * math.sin(t1), z1), (r0 * math.cos(t1), r0 * math.sin(t1), z0)]
            if r0 == 0:
                p = p[:3]
            m.face(list(reversed(p)), FABRIC, c)
            m.face([(x, y, zz - 0.006) for x, y, zz in p], FABRIC, under)
        # Valance flap.
        if lod == 0:
            p0 = (R * math.cos(t0), R * math.sin(t0), H)
            p1 = (R * math.cos(t1), R * math.sin(t1), H)
            q0 = (p0[0], p0[1], H - 0.14)
            q1 = (p1[0], p1[1], H - 0.14)
            m.face([p0, p1, q1, q0], FABRIC, c)
            m.face([q0, q1, p1, p0], FABRIC, under)
            m.tube([(0.03 * math.cos(t0), 0.03 * math.sin(t0), H - 0.55), (R * 0.55 * math.cos(t0), R * 0.55 * math.sin(t0), H + rise * 0.55 - 0.03)], 0.006, 3, METAL, STEEL, caps=False)
    return m.finish(f"patio_umbrella_{name}" + ("_lod1" if lod else ""), mats)


def string_lights(L, mats, lod=0):
    m = M()
    sag = 0.06 * L
    seg = 24 if lod == 0 else 8
    pts = [(-L / 2 + L * i / seg, 0, -sag * (1 - (2 * i / seg - 1) ** 2)) for i in range(seg + 1)]
    m.tube(pts, 0.006, 4 if lod == 0 else 3, METAL, IRON, caps=False)
    uv = swatch_uv("bulb")
    nb = int(round(L / 0.5))
    for k in range(nb):
        x = -L / 2 + L * (k + 0.5) / nb
        z = -sag * (1 - (2 * (x + L / 2) / L - 1) ** 2)
        if lod == 0:
            m.cyl((x, 0, z), (x, 0, z - 0.04), 0.012, 6, METAL, IRON)
            m.sphere((x, 0, z - 0.075), 0.032, 8, 5, NEON, WHITE, uv=uv, squash=1.25)
        else:
            m.sphere((x, 0, z - 0.06), 0.035, 4, 2, NEON, WHITE, uv=uv)
    return m.finish(f"string_lights_{L:g}m" + ("_lod1" if lod else ""), mats)


def light_post(mats, lod=0):
    m = M()
    m.box((-0.23, -0.23, 0), (0.23, 0.23, 0.42), PAINT, CONCRETE)
    if lod == 0:
        m.box((-0.2, -0.2, 0.42), (0.2, 0.2, 0.44), PAINT, lin("#4a3626"))
        for dx, dy in ((-0.1, -0.08), (0.09, 0.06), (0.0, 0.12), (-0.08, 0.1)):
            m.sphere((dx, dy, 0.52), 0.1, 6, 4, FABRIC, lin("#4f7d3a"))
    m.box((-0.05, -0.05, 0.42), (0.05, 0.05, 3.3), WOODM, WOOD_DARK)
    m.box((-0.05, -0.35, 3.18), (0.05, 0.05, 3.25), WOODM, WOOD_DARK)
    m.cyl((0, -0.32, 3.18), (0, -0.32, 3.1), 0.01, 4, METAL, IRON)
    return m.finish("string_light_post" + ("_lod1" if lod else ""), mats)


# ---------- export ---------------------------------------------------------------
def clear_objects():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for me in list(bpy.data.meshes):
        bpy.data.meshes.remove(me)


def place(objs, spacing=None):
    x = 0.0
    for o in objs:
        o.location.x = 0.0


def make_set(name, parts):
    """An empty `name` whose children are linked copies (shared meshes)."""
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for i, (src, loc, rot) in enumerate(parts):
        o = bpy.data.objects.new(f"{name}_{src.name}_{i}", src.data)
        bpy.context.scene.collection.objects.link(o)
        o.parent = root
        o.location = loc
        o.rotation_euler = (0, 0, math.radians(rot))
    return root


def externalize(path, uri):
    """Replace the embedded images of a GLB by an external uri and repack the
    binary chunk (bufferView indices are remapped everywhere)."""
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack_from("<I", data, bin_off)[0]
    binary = data[bin_off + 8:bin_off + 8 + blen]
    drop = {img["bufferView"] for img in gj.get("images", []) if "bufferView" in img}
    if not drop:
        return
    for img in gj["images"]:
        img.pop("bufferView", None)
        img["uri"] = uri
        img["mimeType"] = "image/jpeg"
    remap, views, out = {}, [], bytearray()
    for i, v in enumerate(gj["bufferViews"]):
        if i in drop:
            continue
        chunk = binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]
        while len(out) % 4:
            out.append(0)
        v["byteOffset"] = len(out)
        out += chunk
        remap[i] = len(views)
        views.append(v)
    gj["bufferViews"] = views

    def walk(o):
        if isinstance(o, dict):
            for k, val in o.items():
                if k == "bufferView" and isinstance(val, int):
                    o[k] = remap[val]
                else:
                    walk(val)
        elif isinstance(o, list):
            for val in o:
                walk(val)
    walk({k: v for k, v in gj.items() if k != "bufferViews"})
    while len(out) % 4:
        out.append(0)
    gj["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(gj, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A))
        f.write(js)
        f.write(struct.pack("<II", len(out), 0x004E4942))
        f.write(out)


def export(name, stats):
    path = os.path.join(OUT, f"{name}.glb")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    # Lay the pieces out in a row in Blender only for inspection; the export
    # keeps every root at the origin.
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_materials="EXPORT", export_image_format="JPEG", export_image_quality=90,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_normal_quantization=10,
                              export_draco_texcoord_quantization=14, export_draco_color_quantization=8,
                              export_cameras=False, export_lights=False, export_animations=False, export_extras=False)
    textured = any(s.material and s.material.name in ("sf_sign", "sf_neon") for o in meshes for s in o.material_slots
                   if any(p.material_index == list(o.material_slots).index(s) for p in o.data.polygons))
    if not EMBED:
        externalize(path, ATLAS["image"])
    nodes = {}
    for o in bpy.data.objects:
        if o.type == "MESH" and o.parent is None:
            nodes[o.name] = {"triangles": tris(o), "size_m": [round(v, 3) for v in o.dimensions]}
        elif o.type == "EMPTY":
            ch = [c for c in bpy.data.objects if c.parent is o]
            nodes[o.name] = {"triangles": sum(tris(c) for c in ch), "instances": [c.data.name for c in ch]}
    stats[f"{name}.glb"] = {"bytes": os.path.getsize(path), "textured": textured, "nodes": nodes,
                            "unique_triangles": sum(tris(o) for o in bpy.data.objects if o.type == "MESH" and o.parent is None)}
    print("EXPORT", name, stats[f"{name}.glb"]["bytes"], "bytes", stats[f"{name}.glb"]["unique_triangles"], "tris")


bpy.ops.wm.read_factory_settings(use_empty=True)
mats = build_materials()
biz = list(BIZ.values())
neon_keys = [b["id"] for b in biz if b.get("neon")] + ["open"]
GROUPS = {
    "sign_boards": lambda: [sign_board(b, mats, w) for b in biz for w in (False, True)],
    "blade_signs": lambda: [blade_sign(b, mats) for b in biz],
    "neon_signs": lambda: [neon_sign(k, mats) for k in neon_keys],
    "menu_boards": lambda: [menu_board(b, mats) for b in biz if b.get("menu")],
    "sandwich_boards": lambda: [sandwich_board(b, mats) for b in biz if b.get("sandwich")],
    "cafe_barriers": lambda: [cafe_barrier(b, mats) for b in biz],
    "patio_furniture": None,
    "patio_umbrellas": lambda: [umbrella(k, c, mats, lod) for k, c in UMBRELLAS.items() for lod in (0, 1)],
    "string_lights": lambda: [string_lights(L, mats, lod) for L in (4, 6, 9) for lod in (0, 1)] + [light_post(mats, lod) for lod in (0, 1)],
}


def furniture():
    chairs = {k: bistro_chair(c, mats) for k, c in CHAIR_COLORS.items()}
    for c in CHAIR_COLORS.values():
        bistro_chair(c, mats, 1)
    bt, bt1 = bistro_table(mats), bistro_table(mats, 1)
    ft, ft1 = four_table(mats), four_table(mats, 1)
    sc, sc1 = slat_chair(mats), slat_chair(mats, 1)
    picnic(mats)
    picnic(mats, 1)
    for col, ch in chairs.items():
        make_set(f"patio_set_bistro_{col}", [(bt, (0, 0, 0), 0), (ch, (0.52, 0, 0), -90), (ch, (-0.52, 0, 0), 90)])
    make_set("patio_set_four", [(ft, (0, 0, 0), 0), (sc, (0, 0.62, 0), 180), (sc, (0, -0.62, 0), 0), (sc, (0.62, 0, 0), 90), (sc, (-0.62, 0, 0), -90)])
    make_set("patio_set_four_lod1", [(ft1, (0, 0, 0), 0), (sc1, (0, 0.62, 0), 180), (sc1, (0, -0.62, 0), 0), (sc1, (0.62, 0, 0), 90), (sc1, (-0.62, 0, 0), -90)])


GROUPS["patio_furniture"] = furniture
stats_path = os.path.join(OUT, "stats.json")
stats = json.load(open(stats_path)) if ONLY and os.path.exists(stats_path) else {}
for name, build in GROUPS.items():
    if ONLY and name not in ONLY.split(","):
        continue
    clear_objects()
    build()
    export(name, stats)
json.dump(stats, open(stats_path, "w"), indent=1)
print("DONE", sum(v["bytes"] for v in stats.values()), "bytes")
