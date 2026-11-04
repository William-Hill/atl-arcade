"""PBR trees for Skate ATL: the six species of src/level/geo/trees.js.

    blender -b -P scripts/blender/pbr_trees.py -- OUT_DIR [--species oak,pine] [--render]

Each species becomes OUT_DIR/<species>.glb with nodes tree_<species>_<v> for v in
0..2 (GLTFLoader drops ":" from node names; geo-view maps them to the treeKindFor()
names). Each is a branching trunk (tapered tubes with a root flare, moss on oak,
maple and dogwood) and leaf cards (two sided). The far shapes are impostors drawn
in the browser (src/render/tree-impostors.js). _LEAF is [u, v, code]: on a card
the code is the leaf shape (src/render/leaf-cut.js LEAF_SHAPES) plus the seed; on
bark it is -1 - the bark kind. Textures are painted here
from seeded noise (no photos, no third-party art) and shared by all species:
bark (color + normal), and a leaf atlas (color with alpha + normal).
COLOR_0.r is the wind sway weight (0 at the trunk base, 1 at the crown edge);
COLOR_0.g is a baked crown occlusion (1 open, 0.35 deep inside).
Units are meters, +y up in glTF, the trunk base at the origin. Draco compressed.
"""
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
RENDER = "--render" in argv
os.makedirs(OUT, exist_ok=True)

# Shapes follow TREE_SPECIES (trees.js): trunk height/radius, crown center height,
# half width, half height. levels: branch recursion depth. leaf: card size (m).
SPECIES = {
    "oak":      dict(trunk=(3.6, 0.32), crown=(7.4, 4.4, 2.6), branches=5, levels=3, spread=0.9, cards=520, leaf=1.5, tint=(0.36, 0.52, 0.2)),
    "pine":     dict(trunk=(11.5, 0.27), crown=(13.4, 2.4, 2.0), branches=7, levels=2, spread=1.35, cards=300, leaf=1.3, tint=(0.24, 0.38, 0.2), needles=True),
    "magnolia": dict(trunk=(1.6, 0.24), crown=(5.0, 2.6, 3.2), branches=6, levels=3, spread=0.7, cards=480, leaf=1.2, tint=(0.18, 0.34, 0.17), glossy=True),
    "myrtle":   dict(trunk=(3.1, 0.1), crown=(4.5, 2.2, 1.4), branches=3, levels=2, spread=0.6, cards=300, leaf=1.1, tint=(0.4, 0.55, 0.24), stems=3, bloom=(0.88, 0.42, 0.62)),
    "dogwood":  dict(trunk=(1.7, 0.13), crown=(3.5, 2.7, 1.3), branches=5, levels=3, spread=1.1, cards=340, leaf=1.1, tint=(0.36, 0.52, 0.22)),
    "street":   dict(trunk=(2.9, 0.18), crown=(5.8, 2.6, 2.4), branches=5, levels=3, spread=0.6, cards=400, leaf=1.2, tint=(0.36, 0.54, 0.2)),
}
VARIANTS = 3
only = opt("--species")
if only:
    SPECIES = {k: v for k, v in SPECIES.items() if k in only.split(",")}
TEX = 512


# ---------- textures -------------------------------------------------------
def noise2(n, scale, seed, octaves=4):
    rng = np.random.default_rng(seed)
    out = np.zeros((n, n))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale * 2 ** o))
        g = rng.random((s + 1, s + 1))
        g[-1, :] = g[0, :]
        g[:, -1] = g[:, 0]
        x = np.linspace(0, s, n, endpoint=False)
        i = x.astype(int)
        f = x - i
        f = f * f * (3 - 2 * f)
        a = g[i][:, i] * (1 - f)[None, :] + g[i][:, i + 1] * f[None, :]
        b = g[i + 1][:, i] * (1 - f)[None, :] + g[i + 1][:, i + 1] * f[None, :]
        out += amp * (a * (1 - f)[:, None] + b * f[:, None])
        tot += amp
        amp *= 0.5
    return out / tot


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def image(name, rgba, srgb=True):
    n = rgba.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=True)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def bark_textures():
    n = TEX
    v = np.linspace(0, 1, n, endpoint=False)
    # Vertical furrows: stretched noise along v (the trunk length).
    fur = noise2(n, 3, 11, 5)
    fur = np.repeat(fur[:, ::1], 1, 0)
    stretch = noise2(n, 2, 12, 3)
    ridges = np.abs(np.sin((v[None, :] * 14 + stretch * 3) * math.pi))
    h = 0.6 * ridges ** 0.6 + 0.4 * fur
    h = np.clip(h, 0, 1)
    base = np.array([0.30, 0.24, 0.19])
    dark = np.array([0.12, 0.09, 0.07])
    col = dark + (base - dark) * h[..., None]
    col *= (0.85 + 0.3 * noise2(n, 8, 13, 3))[..., None]
    rgba = np.concatenate([col, np.ones((n, n, 1))], -1)
    nrm = np.concatenate([normal_from_height(h, 6), np.ones((n, n, 1))], -1)
    return image("bark_color", rgba), image("bark_normal", nrm, srgb=False)


def leaf_textures():
    """A 2x1 atlas: left a broadleaf cluster, right a needle cluster."""
    n = TEX
    w = 2 * n
    alpha = np.zeros((n, w))
    shade = np.zeros((n, w))
    height = np.zeros((n, w))
    rng = random.Random(5)
    yy, xx = np.mgrid[0:n, 0:w].astype(float)
    # Broad leaves: rotated ellipses along a few twigs from the bottom center.
    for _ in range(46):
        cx = n * (0.5 + rng.uniform(-0.38, 0.38))
        cy = n * (0.42 + rng.uniform(-0.34, 0.36))
        ang = rng.uniform(0, math.pi)
        a, b = n * rng.uniform(0.07, 0.11), n * rng.uniform(0.03, 0.05)
        dx, dy = xx[:, :n] - cx, yy[:, :n] - cy
        u = dx * math.cos(ang) + dy * math.sin(ang)
        t = -dx * math.sin(ang) + dy * math.cos(ang)
        e = (u / a) ** 2 + (t / b) ** 2
        m = e < 1
        k = rng.uniform(0.6, 1.0)
        shade[:, :n][m] = k * (0.85 + 0.15 * (u[m] / a))
        height[:, :n][m] = 1 - e[m] + 0.15 * (np.abs(t[m] / b) < 0.12)
        alpha[:, :n][m] = 1
    # Needles: thin strokes radiating from twigs.
    for _ in range(26):
        ox = n + n * (0.5 + rng.uniform(-0.3, 0.3))
        oy = n * (0.5 + rng.uniform(-0.3, 0.3))
        for _ in range(28):
            ang = rng.uniform(0, 2 * math.pi)
            L = n * rng.uniform(0.06, 0.14)
            for s in np.linspace(0, 1, 30):
                px, py = int(ox + math.cos(ang) * L * s), int(oy + math.sin(ang) * L * s)
                if n <= px < w - 1 and 0 <= py < n - 1:
                    alpha[py:py + 2, px:px + 2] = 1
                    shade[py:py + 2, px:px + 2] = 0.65 + 0.35 * s
                    height[py:py + 2, px:px + 2] = 1
    g = shade
    col = np.stack([0.55 * g + 0.2, 0.75 * g + 0.2, 0.35 * g + 0.1], -1)  # tinted per species by vertex... kept neutral-green
    col *= (0.85 + 0.25 * noise2(n, 6, 21, 3)).repeat(2, 1)[..., None]
    rgba = np.concatenate([np.clip(col, 0, 1), alpha[..., None]], -1)
    nrm = normal_from_height(height, 3)
    nrm = np.concatenate([nrm, np.ones((n, w, 1))], -1)
    img_c = bpy.data.images.new("leaf_color", w, n, alpha=True)
    img_c.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img_c.pack()
    img_n = bpy.data.images.new("leaf_normal", w, n, alpha=False)
    img_n.colorspace_settings.name = "Non-Color"
    img_n.pixels.foreach_set(np.flipud(nrm).astype(np.float32).ravel())
    img_n.pack()
    return img_c, img_n


def material(name, color, normal, rough, alpha=False, tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = color
    if tint:
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(tc.outputs["Color"], mix.inputs["A"])
        mix.inputs["B"].default_value = (*tint, 1)
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    else:
        nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = rough
    if alpha:
        nt.links.new(tc.outputs["Alpha"], bsdf.inputs["Alpha"])
        m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
        m.use_backface_culling = False
        try:
            m.surface_render_method = "DITHERED"
        except Exception:
            pass
    return m


# ---------- geometry ---------------------------------------------------------
class Mesh:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")
        self.sway = self.bm.verts.layers.float.new("_SWAY")
        self.leaf = self.bm.verts.layers.float_vector.new("_LEAF")
        self.normals = []
        self.bark = lambda p, radial: (*[x * min(1.0, 0.8 + 0.08 * p.z) for x in lin(BARK_SRGB)], 1)  # bark, a little darker at the base
        self.bark_code = -1.0

    def face(self, verts, uvs, cols, mat, sway=None, seed=0.0, normals=None):
        vs = [self.bm.verts.new(v) for v in verts]
        f = self.bm.faces.new(vs)
        f.material_index = mat
        for k, (l, uv, c) in enumerate(zip(f.loops, uvs, cols)):
            l[self.uv].uv = uv
            l[self.col] = c
            l.vert[self.sway] = sway[k] if sway else c[0]
            l.vert[self.leaf] = (uv[0], uv[1], seed) if seed else (0, 0, 0)
        self.normals.extend(normals or [None] * len(vs))
        return f


def tube(M, pts, radii, sway, segs, mat, lobes=None):
    """A tapered tube along pts; bark UVs tile ~1 m per v, around = 1. lobes[i]
    swells ring i into 5 root buttresses (the root flare)."""
    rings = []
    vlen = 0.0
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a)
        if i:
            vlen += (p - pts[i - 1]).length
        ring = []
        for k in range(segs + 1):
            ang = 2 * math.pi * k / segs
            radial = a * math.cos(ang) + b * math.sin(ang)
            r = radii[i] * (1 + (lobes[i] if lobes else 0) * max(0.0, math.cos(5 * ang)) ** 2)
            ring.append((p + radial * r, radial))
        rings.append((ring, vlen / max(0.6, radii[0] * 6), sway[i]))
    for (r0, v0, s0), (r1, v1, s1) in zip(rings, rings[1:]):
        for k in range(segs):
            q = [r0[k], r0[k + 1], r1[k + 1], r1[k]]
            M.face([x[0] for x in q], [(k / segs, v0), ((k + 1) / segs, v0), ((k + 1) / segs, v1), (k / segs, v1)],
                   [M.bark(*x) for x in q], mat, sway=[s0, s0, s1, s1], seed=M.bark_code)


def grow(sp, rng):
    """Branch skeleton: list of (points, radii, depth). Returns branches and leaf anchor points."""
    th, tr = sp["trunk"]
    cy, hw, hh = sp["crown"]
    branches, anchors = [], []
    stems = sp.get("stems", 1)
    for s in range(stems):
        lean = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)).normalized() * (0.35 if stems > 1 else 0.04)
        top = Vector((0, 0, cy - hh * (0.2 if not sp.get("needles") else -0.6))) + lean * th
        pts = [Vector((0, 0, 0)).lerp(top, t) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), 0)) * 0.06 * t for t in np.linspace(0, 1, 7)]
        r0 = tr if stems == 1 else tr * 1.1
        branches.append((pts, [r0 * (1.15 - 0.85 * t) for t in np.linspace(0, 1, 7)], 0))

        def recurse(start, direction, length, radius, depth):
            pts = [start]
            d = direction.normalized()
            for i in range(4):
                d = (d + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.1, 0.25)))).normalized()
                pts.append(pts[-1] + d * length / 4)
            branches.append((pts, [radius * (1 - 0.7 * i / 4) for i in range(5)], depth))
            if depth >= sp["levels"]:
                anchors.extend(pts[2:])
                return
            for j in range(2 + (depth < 2)):
                k = rng.randint(1, 4)
                nd = (d + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 0.6))) * sp["spread"]).normalized()
                recurse(pts[k], nd, length * 0.62, radius * 0.55, depth + 1)

        nb = sp["branches"]
        for i in range(nb):
            t = (0.55 if not sp.get("needles") else 0.82) + 0.4 * i / max(1, nb - 1) * (0.45 if not sp.get("needles") else 0.2)
            idx = min(6, int(t * 6))
            ang = 2 * math.pi * (i / nb) + rng.uniform(-0.4, 0.4)
            d = Vector((math.cos(ang), math.sin(ang), 0.55 if not sp.get("needles") else 0.15))
            recurse(pts[idx], d, hw * (1.0 if not sp.get("needles") else 0.9), r0 * 0.5, 1)
    return branches, anchors


def lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


LEAF_SRGB = {"oak": (0.5, 0.76, 0.3), "pine": (0.34, 0.58, 0.36), "magnolia": (0.28, 0.54, 0.3), "myrtle": (0.48, 0.72, 0.34), "dogwood": (0.44, 0.68, 0.32), "street": (0.46, 0.7, 0.3)}
BARK_SRGB = (0.5, 0.42, 0.35)
# The leaf shape and bark kind codes of src/render/leaf-cut.js (LEAF_SHAPE_OF,
# BARK_KIND_OF), the bark color, and moss at the foot of the trunk.
LEAF_SHAPE = {"oak": 1, "pine": 2, "magnolia": 3, "myrtle": 4, "dogwood": 5, "street": 6}
BARK_KIND = {"oak": 0, "pine": 1, "magnolia": 2, "myrtle": 2, "dogwood": 0, "street": 0}
BARK_OF = {"pine": (0.5, 0.36, 0.28), "magnolia": (0.54, 0.52, 0.47), "myrtle": (0.68, 0.53, 0.42)}
MOSS = {"oak", "street", "dogwood"}
MOSS_SRGB = (0.36, 0.44, 0.2)


def crown_occlusion(p, sp):
    cy, hw, hh = sp["crown"]
    q = Vector((p.x / hw, p.y / hw, (p.z - cy) / hh))
    return max(0.5, min(1.0, 0.5 + 0.6 * q.length))


def crown_normal(p, sp):
    """The normal of the crown as one volume at p: out from a point under the
    crown center, bent up toward the sky, so the inside of a crown is not
    lit as a back face."""
    cy, hw, hh = sp["crown"]
    out = Vector(((p.x) / hw, (p.y) / hw, (p.z - (cy - hh * 0.3)) / hh)).normalized()
    return (out + Vector((0, 0, 0.45))).normalized()


def finish_normals(me, normals):
    me.update()
    me.color_attributes.active_color_name = "Col"
    me.color_attributes.render_color_index = 0
    vn = [Vector(v.normal) for v in me.vertices]
    for i, n in enumerate(normals):
        if n is not None:
            vn[i] = n
    me.normals_split_custom_set_from_vertices(vn)


def build_tree(name, sp, seed, mats):
    rng = random.Random(seed)
    M = Mesh()
    branches, anchors = grow(sp, rng)
    cy, hw, hh = sp["crown"]
    top_h = cy + hh
    barkc = lin(BARK_OF.get(sp["name"], BARK_SRGB))
    mossc = lin(MOSS_SRGB)
    moss = sp["name"] in MOSS

    def bark(p, radial):
        c = [x * min(1.0, 0.8 + 0.08 * p.z) for x in barkc]
        if moss and p.z < 1.0:
            # Moss on the shaded (north, -y) foot of the trunk.
            m = (1 - p.z / 1.0) * max(0.0, -radial.y * 0.8 + 0.3)
            c = [x + (y - x) * min(1.0, m) for x, y in zip(c, mossc)]
        return (*c, 1)

    M.bark = bark
    M.bark_code = -1.0 - BARK_KIND[sp["name"]]
    for pts, radii, depth in branches:
        segs = 8 if depth == 0 else (5 if depth == 1 else 3)
        if radii[0] < 0.012:
            continue
        lobes = None
        if depth == 0:
            # The root flare: a wide lobed foot, half a meter up into the trunk.
            pts = [pts[0], pts[0].lerp(pts[1], 0.3)] + pts[1:]
            radii = [radii[0] * 1.6, radii[0] * 1.15] + radii[1:]
            lobes = [0.4, 0.15] + [0] * (len(pts) - 2)
        sway = [min(1, max(0, (p.z / top_h) ** 2 * 0.6 + 0.4 * depth / 3)) for p in pts]
        tube(M, pts, radii, sway, segs, 0, lobes)
    # The crown core: low icospheres at a few branch tips, shaded like the cards.
    core = bmesh.new()
    tips = anchors[:: max(1, len(anchors) // sp.get("cores", 7))][: sp.get("cores", 7)]
    for tip in tips:
        q = Vector((tip.x / hw, tip.y / hw, (tip.z - cy) / hh))
        c0 = Vector((0, 0, cy)) + (tip - Vector((0, 0, cy))) * 0.7
        bmesh.ops.create_icosphere(core, subdivisions=2, radius=1.0, matrix=Matrix.Translation(c0) @ Matrix.Diagonal((hw * 0.34, hw * 0.34, hh * 0.4, 1)))
    for f in core.faces:
        vs = [v.co.copy() for v in f.verts]
        k = 0.85 * rng.uniform(0.9, 1.05)
        col = (*[x * k for x in lin(sp["leafc"])], 1)
        nrm = [crown_normal(q, sp) for q in vs]
        M.face(vs, [(0, 0)] * len(vs), [col] * len(vs), 1, sway=[0.6] * len(vs), normals=nrm)
    core.free()
    # Leaf cards around the anchors, inside the crown ellipsoid.
    rng.shuffle(anchors)
    n = sp["cards"]
    u0 = 0.5 if sp.get("needles") else 0.0
    for i in range(n):
        base = anchors[i % len(anchors)] if anchors else Vector((0, 0, cy))
        c = base + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.6, 0.8))) * sp["leaf"] * 0.6
        q = Vector((c.x / hw, c.y / hw, (c.z - cy) / hh))
        if q.length > 1.08:
            c = Vector((0, 0, cy)) + (c - Vector((0, 0, cy))) * (1.08 / q.length)
        s = sp["leaf"] * rng.uniform(0.8, 1.25)
        out = (c - Vector((0, 0, cy - hh * 0.4))).normalized()
        rot = Matrix.Rotation(rng.uniform(0, 2 * math.pi), 3, "Z") @ Matrix.Rotation(rng.uniform(-0.9, 0.9), 3, "X")
        a = (rot @ Vector((1, 0, 0))) * s / 2
        b = (rot @ Vector((0, 0.35, 1)).normalized()) * s / 2
        occ = crown_occlusion(c, sp)
        sw = min(1.0, 0.55 + 0.45 * q.length)
        k = occ * rng.uniform(0.85, 1.12)
        bloom = sp.get("bloom") and rng.random() < 0.55
        col = (*[x * k for x in lin(sp["bloom"] if bloom else sp["leafc"])], 1)
        quad = [c - a - b, c + a - b, c + a + b, c - a + b]
        # The card normals point out of the crown, so the cards shade as one volume.
        nrm = [crown_normal(q, sp) for q in quad]
        M.face(quad, [(0, 0), (1, 0), (1, 1), (0, 1)], [col] * 4, 1, sway=[sw] * 4, seed=LEAF_SHAPE[sp["name"]] + rng.uniform(0.05, 0.95), normals=nrm)
    me = bpy.data.meshes.new(name)
    M.bm.to_mesh(me)
    M.bm.free()
    finish_normals(me, M.normals)
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for p in me.polygons:
        p.use_smooth = True
    return obj, (len(me.polygons), sum(len(p.vertices) - 2 for p in me.polygons))


# ---------- main --------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
bark_c, bark_n = bark_textures()
leaf_c, leaf_n = leaf_textures()
stats = {}
for species, sp in SPECIES.items():
    sp["leafc"] = LEAF_SRGB[species]
    sp["name"] = species
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bark = material(f"{species}_bark", bark_c, bark_n, 0.92)
    leaf = material(f"{species}_leaf", leaf_c, leaf_n, 0.45 if sp.get("glossy") else 0.7, alpha=True, tint=sp["tint"])
    stats[species] = {}
    for v in range(VARIANTS):
        seed = sum(ord(ch) * 131 ** i for i, ch in enumerate(f"{species}:{v}")) & 0xFFFFFFFF
        o0, (_, t0) = build_tree(f"tree_{species}_{v}", sp, seed, [bark, leaf])
        o0.location.x = 0
        stats[species][v] = {"lod0_triangles": t0}
    path = os.path.join(OUT, f"{species}.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_apply=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                              export_active_vertex_color_when_no_material=True, export_attributes=True,
                              export_materials="NONE" if not RENDER else "EXPORT",
                              export_image_format="WEBP", export_image_quality=85,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    stats[species]["bytes"] = os.path.getsize(path)
    if RENDER:
        objs = [o for o in bpy.data.objects if o.type == "MESH"]
        for i, o in enumerate(objs):
            o.location.x = (i // 2) * 12 if not o.name.endswith("_lod1") else (i // 2) * 12
            o.location.y = 0 if not o.name.endswith("_lod1") else 14
        scn = bpy.context.scene
        scn.render.engine = "BLENDER_EEVEE"
        scn.render.resolution_x, scn.render.resolution_y = 1200, 700
        world = bpy.data.worlds.new("w")
        world.use_nodes = True
        world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
        world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
        scn.world = world
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.5
        sun.rotation_euler = (math.radians(50), 0, math.radians(35))
        scn.collection.objects.link(sun)
        bpy.ops.mesh.primitive_plane_add(size=200)
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scn.collection.objects.link(cam)
        scn.camera = cam
        cam.location = (12, -38, sp["crown"][0] * 0.9)
        cam.rotation_euler = (math.radians(84), 0, 0)
        cam.data.lens = 30
        scn.render.filepath = os.path.join(OUT, f"{species}.png")
        bpy.ops.render.render(write_still=True)
        for o in [sun, cam] + [o for o in bpy.data.objects if o.name.startswith("Plane")]:
            bpy.data.objects.remove(o, do_unlink=True)
import json
json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), indent=1)
print("STATS", json.dumps(stats))
