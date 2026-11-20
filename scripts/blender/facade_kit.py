"""Facade kit for Skate ATL (pbr look): instanceable building modules.

    blender -b -P scripts/blender/facade_kit.py -- OUT_DIR [--stats stats.json]

Writes OUT_DIR/facade-kit.glb: one node per module (and <module>_lod1 for the
larger ones), all on ONE material (facade_kit) with one shared trim-sheet atlas:
baseColor 1024, normal 1024, metallicRoughness 512 (JPEG). See docs/facade-kit.md
for module sizes, anchors, snapping, and the placement algorithm.

Module frame (glTF): +x along the wall (the way the facade u grows), +y up,
+z out of the wall. The origin is on the wall plane (z = 0). The back faces on
the wall are not built. Roof modules have the origin at the bottom center.

The atlas is a trim sheet: horizontal strips that tile in U (2.0 m per U
period, 512 px/m) and are mapped by real size in V (stretched when a face is
taller than its strip). Textures are painted here from seeded noise: no photos,
no third-party art, no generated models.

COLOR_0 is a baked shade (1 open, lower in reveals and soffits). Each node
carries extras.kit (nominal size, anchor, scale limits, tint flag) for the
placement code. Units are meters. Draco compressed.
"""
import json
import math
import os
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith("--") else "assets/facades"
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
STATS = opt("--stats")
os.makedirs(OUT, exist_ok=True)

ATLAS = 1024
PX_PER_M = 512
U_PERIOD = ATLAS / PX_PER_M  # 2.0 m
INSET = 3  # px kept clear at each strip edge (mip bleed)
LOD1_MIN_TRIS = 300

# The trim sheet, from the bottom of the atlas (Blender v = 0) up.
STRIP_ORDER = [
    ("brick", 154), ("stone", 112), ("stucco", 96), ("paint", 80), ("metal_dark", 80),
    ("metal_sage", 64), ("metal_gray", 112), ("louver", 64), ("glass", 96),
    ("fabric_stripe", 96), ("fabric_plain", 32), ("rubber", 16), ("concrete", 22),
]
STRIPS = {}
_v = 0
for _n, _h in STRIP_ORDER:
    STRIPS[_n] = (_v, _h)
    _v += _h
assert _v == ATLAS


# ---------- textures -------------------------------------------------------
def noise(h, w, cu, cv, seed, octaves=4):
    """Value noise, periodic in U over the atlas width (cu cells per period)."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        su = int(cu * 2 ** o)
        sv = max(1, int(round(cv * 2 ** o)))
        g = rng.random((sv + 1, su))
        x = np.arange(w) / w * su
        i = x.astype(int)
        fx = x - i
        fx = fx * fx * (3 - 2 * fx)
        i1 = (i + 1) % su
        y = np.arange(h) / h * sv
        j = np.minimum(y.astype(int), sv - 1)
        fy = y - j
        fy = fy * fy * (3 - 2 * fy)
        a = g[j][:, i] * (1 - fx) + g[j][:, i1] * fx
        b = g[j + 1][:, i] * (1 - fx) + g[j + 1][:, i1] * fx
        out += amp * (a * (1 - fy)[:, None] + b * fy[:, None])
        tot += amp
        amp *= 0.5
    return out / tot


def grid(h):
    yy, xx = np.mgrid[0:h, 0:ATLAS].astype(float)
    return yy, xx


def tone(c, k):
    return np.array(c, float)[None, None, :] * k[..., None]


def paint_brick(h, seed):
    rng = np.random.default_rng(seed)
    yy, xx = grid(h)
    ch = h / 4  # 4 courses, 75 mm each
    course = np.floor(yy / ch).astype(int)
    within = yy - course * ch
    bw = ATLAS / 10  # 10 bricks per 2 m
    bx = xx / bw + (course % 2) * 0.5
    bi = np.floor(bx).astype(int) % 10
    fx = (bx - np.floor(bx)) * bw
    joint = 4.5
    mortar = (within < joint) | (fx < joint)
    pal = np.array([[0.62, 0.3, 0.23], [0.68, 0.35, 0.26], [0.56, 0.27, 0.21], [0.64, 0.38, 0.29], [0.53, 0.25, 0.2]])
    cols = pal[rng.integers(0, len(pal), (4, 10))] * rng.uniform(0.9, 1.08, (4, 10, 1))
    n = noise(h, ATLAS, 64, 6, seed + 1)
    rgb = cols[course % 4, bi] * (0.88 + 0.24 * n)[..., None]
    mcol = tone([0.72, 0.7, 0.65], 0.9 + 0.2 * noise(h, ATLAS, 128, 12, seed + 2, 3))
    rgb = np.where(mortar[..., None], mcol, rgb)
    ex = np.minimum(fx - joint, bw - fx)
    ey = np.minimum(within - joint, ch - within)
    e = np.clip(np.minimum(ex, ey) / 3.0, 0, 1)
    height = np.where(mortar, 0.0, 1.6 + 1.2 * e) + 0.5 * n
    rough = np.where(mortar, 0.95, 0.86) + 0.04 * (n - 0.5)
    return rgb, height, rough, np.zeros_like(n)


def paint_stone(h, seed):
    lo = noise(h, ATLAS, 6, 2, seed)
    fine = noise(h, ATLAS, 256, max(2, h // 4), seed + 1, 3)
    rgb = tone([0.86, 0.82, 0.74], (0.92 + 0.14 * lo) * (0.95 + 0.1 * fine))
    return rgb, 1.2 * fine, 0.8 + 0.06 * (fine - 0.5), np.zeros_like(lo)


def paint_stucco(h, seed):
    lo = noise(h, ATLAS, 8, 2, seed)
    fine = noise(h, ATLAS, 384, max(2, h // 3), seed + 1, 3)
    rgb = tone([0.94, 0.92, 0.88], (0.94 + 0.08 * lo) * (0.93 + 0.12 * fine))
    return rgb, 2.2 * fine, 0.92 + 0.04 * (fine - 0.5), np.zeros_like(lo)


def paint_paint(h, seed):
    streak = noise(h, ATLAS, 12, max(2, h // 2), seed, 3)
    rgb = tone([0.94, 0.93, 0.9], 0.97 + 0.05 * streak)
    return rgb, 0.4 * streak, 0.5 + 0.06 * (streak - 0.5), np.zeros_like(streak)


def paint_metal(c, rough, metal):
    def p(h, seed):
        n = noise(h, ATLAS, 32, 3, seed)
        s = noise(h, ATLAS, 4, max(2, h // 2), seed + 5, 2)
        rgb = tone(c, 0.92 + 0.12 * n + 0.04 * s)
        return rgb, 0.3 * n, rough + 0.08 * (n - 0.5), np.full_like(n, metal)
    return p


def paint_metal_gray(h, seed):
    yy, xx = grid(h)
    n = noise(h, ATLAS, 32, 3, seed)
    streak = noise(h, ATLAS, 64, 2, seed + 3, 2)
    seam = np.abs(((xx + 128) % 256) - 128) < 2.0  # a panel seam every 0.5 m
    k = (0.9 + 0.1 * n + 0.06 * streak) * np.where(seam, 0.55, 1.0)
    rgb = tone([0.73, 0.75, 0.76], k)
    height = np.where(seam, -1.5, 0.0) + 0.3 * n
    return rgb, height, 0.45 + 0.08 * (n - 0.5), np.where(seam, 0.3, 0.55)


def paint_louver(h, seed):
    yy, xx = grid(h)
    n = noise(h, ATLAS, 32, 3, seed)
    period = h / 3
    t = (yy % period) / period
    gap = t < 0.22
    k = np.where(gap, 0.12, 0.62 + 0.38 * (t - 0.22) / 0.78) * (0.95 + 0.1 * n)
    rgb = tone([0.7, 0.72, 0.73], k)
    height = np.where(gap, 0.0, 3.0 * (t - 0.22) / 0.78)
    return rgb, height, np.where(gap, 0.8, 0.45), np.where(gap, 0.0, 0.5)


def paint_glass(h, seed):
    yy, xx = grid(h)
    lo = noise(h, ATLAS, 4, 1, seed)
    k = 0.9 + 0.16 * lo + 0.12 * (yy / h)
    rgb = tone([0.15, 0.22, 0.28], k)
    return rgb, 0.15 * lo, np.full_like(lo, 0.06), np.zeros_like(lo)


def paint_fabric(stripes):
    def p(h, seed):
        yy, xx = grid(h)
        n = noise(h, ATLAS, 64, 3, seed)
        weave = 0.5 + 0.25 * (np.sin(xx * math.pi / 2) + np.sin(yy * math.pi / 2))
        k = 0.95 + 0.06 * n - 0.04 * weave
        if stripes:  # 0.25 m stripes along U; light and mid tone, tinted per instance
            d = np.abs(((xx % 128) - 64))
            s = np.clip((d - 30) / 4, 0, 1)  # 1 inside the light stripe
            k = k * (0.6 + 0.4 * s)
        rgb = tone([0.97, 0.96, 0.93], k)
        return rgb, 0.8 * weave, 0.85 + 0.05 * (n - 0.5), np.zeros_like(n)
    return p


PAINTERS = {
    "brick": paint_brick, "stone": paint_stone, "stucco": paint_stucco, "paint": paint_paint,
    "metal_dark": paint_metal([0.13, 0.13, 0.14], 0.38, 0.55),
    "metal_sage": paint_metal([0.33, 0.42, 0.35], 0.45, 0.3),
    "metal_gray": paint_metal_gray, "louver": paint_louver, "glass": paint_glass,
    "fabric_stripe": paint_fabric(True), "fabric_plain": paint_fabric(False),
    "rubber": paint_metal([0.05, 0.05, 0.055], 0.7, 0.0),
    "concrete": paint_metal([0.66, 0.65, 0.62], 0.92, 0.0),
}


def build_atlas():
    rgb = np.zeros((ATLAS, ATLAS, 3))
    hgt = np.zeros((ATLAS, ATLAS))
    rough = np.zeros((ATLAS, ATLAS))
    metal = np.zeros((ATLAS, ATLAS))
    for i, (name, h) in enumerate(STRIP_ORDER):
        v0 = STRIPS[name][0]
        c, hh, r, m = PAINTERS[name](h, 7001 + 97 * i)
        rgb[v0:v0 + h] = c
        hgt[v0:v0 + h] = hh
        rough[v0:v0 + h] = r
        metal[v0:v0 + h] = m
    # Rows are bottom first (Blender pixel order), so +row is +v.
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * 0.5
    dy = (np.roll(hgt, -1, 0) - np.roll(hgt, 1, 0)) * 0.5
    nrm = np.stack([-dx, -dy, np.ones_like(hgt)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    nrm = nrm * 0.5 + 0.5
    orm = np.stack([np.ones_like(rough), np.clip(rough, 0.02, 1), np.clip(metal, 0, 1)], -1)
    orm = orm.reshape(ATLAS // 2, 2, ATLAS // 2, 2, 3).mean(axis=(1, 3))
    return np.clip(rgb, 0, 1), nrm, orm


def image(name, arr, srgb):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    rgba = np.concatenate([arr, np.ones((h, w, 1))], -1)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.file_format = "JPEG"
    img.pack()
    return img


def kit_material(color, normal, orm):
    m = bpy.data.materials.new("facade_kit")
    m.use_nodes = True
    # Single sided: every visible face is built, so the GPU culls the backs.
    m.use_backface_culling = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexImage")
    tc.image = color
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    to = nt.nodes.new("ShaderNodeTexImage")
    to.image = orm
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = normal
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# ---------- geometry ---------------------------------------------------------
def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def frame_axes(n, pts):
    n = unit(n)
    if abs(n[1]) < 0.7:
        u = unit(np.cross([0.0, 1.0, 0.0], n))
    else:
        ext = np.ptp(np.array(pts), axis=0)
        u = np.array([1.0, 0, 0]) if ext[0] >= ext[2] else np.array([0, 0, 1.0])
        u = unit(u - n * np.dot(u, n))
    return u, np.cross(n, u)


def strip_v(vs, strip):
    v0, hp = STRIPS[strip]
    lo = min(vs)
    ext = max(vs) - lo
    hm = (hp - 2 * INSET) / PX_PER_M
    s = 1.0 if ext <= hm else hm / ext
    return [(v0 + INSET + (v - lo) * s * PX_PER_M) / ATLAS for v in vs]


class Builder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.uvs, self.cols, self.smooth = [], [], [], [], []

    def poly(self, pts, normal, strip, shade=1.0):
        pts = [np.asarray(p, float) for p in pts]
        nw = np.zeros(3)
        for i in range(len(pts)):
            nw += np.cross(pts[i], pts[(i + 1) % len(pts)])
        if np.linalg.norm(nw) < 1e-10:
            return
        if np.dot(nw, normal) < 0:
            pts = pts[::-1]
        u_ax, v_ax = frame_axes(normal, pts)
        us = [float(np.dot(p, u_ax)) / U_PERIOD for p in pts]
        vs = strip_v([float(np.dot(p, v_ax)) for p in pts], strip)
        base = len(self.verts)
        self.verts += [tuple(p) for p in pts]
        self.cols += [shade] * len(pts)
        self.faces.append(list(range(base, base + len(pts))))
        self.uvs.append(list(zip(us, vs)))
        self.smooth.append(False)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


SIDE = 0.92
UNDER = 0.78


def box(b, x0, x1, y0, y1, z0, z1, strip, skip=("back",), shade=1.0):
    P = lambda x, y, z: (x, y, z)
    if "front" not in skip:
        b.poly([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], (0, 0, 1), strip, shade)
    if "back" not in skip:
        b.poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0)], (0, 0, -1), strip, shade * SIDE)
    if "top" not in skip:
        b.poly([P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], (0, 1, 0), strip, shade)
    if "bottom" not in skip:
        b.poly([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], (0, -1, 0), strip, shade * UNDER)
    if "left" not in skip:
        b.poly([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], (-1, 0, 0), strip, shade * SIDE)
    if "right" not in skip:
        b.poly([P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0)], (1, 0, 0), strip, shade * SIDE)


def beam(b, p0, p1, w, h, strip, up=(0, 1, 0), caps=True, shade=1.0):
    """An oriented box from p0 to p1, w wide and h tall across the axis."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = unit(p1 - p0)
    s = np.cross(d, up)
    if np.linalg.norm(s) < 1e-6:
        s = np.cross(d, (1, 0, 0))
    s = unit(s) * w / 2
    u = unit(np.cross(s, d)) * h / 2
    c = [p0 - s - u, p0 + s - u, p0 + s + u, p0 - s + u]
    e = [q + (p1 - p0) for q in c]
    for i in range(4):
        j = (i + 1) % 4
        mid = (c[i] + c[j]) / 2 - p0
        b.poly([c[i], c[j], e[j], e[i]], mid, strip, shade * (UNDER if mid[1] < -1e-6 else 1.0))
    if caps:
        b.poly(c, -d, strip, shade * SIDE)
        b.poly(e, d, strip, shade * SIDE)


def tube(b, pts, r, segs, strip, caps=False, shade=1.0):
    """A smooth round tube along a polyline (shared ring vertices)."""
    pts = [np.asarray(p, float) for p in pts]
    rings = []
    for k, p in enumerate(pts):
        d = unit((pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]))
        ref = np.array([0, 0, 1.0]) if abs(d[2]) < 0.9 else np.array([1.0, 0, 0])
        a = unit(np.cross(d, ref))
        c = np.cross(d, a)
        ring = []
        for i in range(segs + 1):
            t = 2 * math.pi * i / segs
            ring.append(p + (a * math.cos(t) + c * math.sin(t)) * r)
        rings.append(ring)
    vlen = [0.0]
    for k in range(1, len(pts)):
        vlen.append(vlen[-1] + float(np.linalg.norm(pts[k] - pts[k - 1])))
    vv = strip_v(vlen, strip)
    base = len(b.verts)
    for ring in rings:
        b.verts += [tuple(q) for q in ring]
        b.cols += [shade] * len(ring)
    n = segs + 1
    for k in range(len(pts) - 1):
        for i in range(segs):
            a0 = base + k * n + i
            f = [a0, a0 + 1, a0 + n + 1, a0 + n]
            # Outward winding: check against the ring center.
            q = [np.asarray(b.verts[x]) for x in f]
            nw = np.cross(q[1] - q[0], q[3] - q[0])
            if np.dot(nw, (q[0] + q[2]) / 2 - (pts[k] + pts[k + 1]) / 2) < 0:
                f = f[::-1]
            b.faces.append(f)
            uvmap = {a0: (2 * math.pi * r * i / segs / U_PERIOD, vv[k]), a0 + 1: (2 * math.pi * r * (i + 1) / segs / U_PERIOD, vv[k]),
                     a0 + n: (2 * math.pi * r * i / segs / U_PERIOD, vv[k + 1]), a0 + n + 1: (2 * math.pi * r * (i + 1) / segs / U_PERIOD, vv[k + 1])}
            b.uvs.append([uvmap[x] for x in f])
            b.smooth.append(True)
    if caps:
        for k, sign in ((0, -1), (len(pts) - 1, 1)):
            d = unit(pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]) * sign
            b.poly(rings[k][:-1], d, strip, shade * SIDE)


def cone(b, c, r0, y0, r1, y1, segs, strip, cap0=False, cap1=False, inside=None, shade=1.0):
    """A smooth frustum around the vertical axis at c = (x, z)."""
    pts = []
    for y, r in ((y0, r0), (y1, r1)):
        pts.append([(c[0] + r * math.cos(2 * math.pi * i / segs), y, c[1] + r * math.sin(2 * math.pi * i / segs)) for i in range(segs + 1)])
    vv = strip_v([0.0, math.hypot(y1 - y0, r1 - r0)], strip)
    for outward, strip_k, sh in ((True, strip, shade), (False, inside, shade * 0.8)):
        if strip_k is None:
            continue
        base = len(b.verts)
        for ring in pts:
            b.verts += ring
            b.cols += [sh] * len(ring)
        n = segs + 1
        for i in range(segs):
            f = [base + i, base + i + 1, base + n + i + 1, base + n + i]
            q = [np.asarray(b.verts[x]) for x in f]
            nw = np.cross(q[1] - q[0], q[3] - q[0])
            radial = (q[0] + q[1]) / 2 - np.array([c[0], q[0][1], c[1]])
            if (np.dot(nw, radial) < 0) == outward:
                f = f[::-1]
            b.faces.append(f)
            rr = (r0 + r1) / 2
            uvm = {base + i: (2 * math.pi * rr * i / segs / U_PERIOD, vv[0]), base + i + 1: (2 * math.pi * rr * (i + 1) / segs / U_PERIOD, vv[0]),
                   base + n + i: (2 * math.pi * rr * i / segs / U_PERIOD, vv[1]), base + n + i + 1: (2 * math.pi * rr * (i + 1) / segs / U_PERIOD, vv[1])}
            b.uvs.append([uvm[x] for x in f])
            b.smooth.append(True)
    if cap0 and r0 > 0:
        b.poly(pts[0][:-1], (0, -1, 0), cap0 if isinstance(cap0, str) else strip, shade * UNDER)
    if cap1 and r1 > 0:
        b.poly(pts[1][:-1], (0, 1, 0), cap1 if isinstance(cap1, str) else strip, shade)


def extrude(b, prof, x0, x1, strip, skip_d=0.0, caps=True, shade=1.0):
    """A molding: the closed profile [(y, d)] (CCW: out along the bottom, up the
    front, back along the top) extruded along x. Segments on the wall
    (d <= skip_d at both ends) are not built."""
    n = len(prof)
    for k in range(n):
        (ya, da), (yb, db) = prof[k], prof[(k + 1) % n]
        if da <= skip_d + 1e-6 and db <= skip_d + 1e-6:
            continue
        nrm = (0.0, -(db - da), yb - ya)
        sh = shade * (UNDER if nrm[1] < -1e-6 and abs(nrm[2]) < 1e-6 else 1.0)
        b.poly([(x0, ya, da), (x1, ya, da), (x1, yb, db), (x0, yb, db)], nrm, strip, sh)
    if caps:
        b.poly([(x0, y, d) for y, d in prof], (-1, 0, 0), strip, shade * SIDE)
        b.poly([(x1, y, d) for y, d in prof], (1, 0, 0), strip, shade * SIDE)


def extrude_corner(b, prof, arm, strip, skip_d=0.0, shade=1.0):
    """An outside 90 degree corner of a molding: wall A runs along +x to the
    corner at the origin, wall B turns away along -z with its outward normal
    +x. The two arms meet on the miter x = z."""
    n = len(prof)
    for k in range(n):
        (ya, da), (yb, db) = prof[k], prof[(k + 1) % n]
        if da <= skip_d + 1e-6 and db <= skip_d + 1e-6:
            continue
        dd, dy = db - da, yb - ya
        sh = shade * (UNDER if dd > 1e-6 and abs(dy) < 1e-6 else 1.0)
        b.poly([(-arm, ya, da), (da, ya, da), (db, yb, db), (-arm, yb, db)], (0.0, -dd, dy), strip, sh)
        b.poly([(da, ya, da), (da, ya, -arm), (db, yb, -arm), (db, yb, db)], (dy, -dd, 0.0), strip, sh)
    b.poly([(-arm, y, d) for y, d in prof], (-1, 0, 0), strip, shade * SIDE)
    b.poly([(d, y, -arm) for y, d in prof], (0, 0, -1), strip, shade * SIDE)


def glass(b, x0, x1, y0, y1, z):
    b.poly([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], (0, 0, 1), "glass")


def louver_rows(b, x0, x1, y0, y1, z, normal=(0, 0, 1), along="x"):
    """A louver panel split into rows of about one strip height (0.12 m)."""
    rows = max(1, round((y1 - y0) / 0.12))
    for r in range(rows):
        ya = y0 + (y1 - y0) * r / rows
        yb = y0 + (y1 - y0) * (r + 1) / rows
        if along == "x":
            b.poly([(x0, ya, z), (x1, ya, z), (x1, yb, z), (x0, yb, z)], normal, "louver")
        else:  # x0, x1 are z values; z is the x plane
            b.poly([(z, ya, x0), (z, ya, x1), (z, yb, x1), (z, yb, x0)], normal, "louver")


# ---------- modules ----------------------------------------------------------
MODULES = []  # (name, builder fn(lod) -> Builder, meta)


def module(name, **meta):
    def deco(fn):
        MODULES.append((name, fn, meta))
        return fn
    return deco


# Storefronts: fill one ground-floor bay between the piers (bay - 0.36 m).
SF_H = 3.3


def storefront(name, W, door, lod):
    b = Builder(name)
    FD, jw = 0.12, 0.08
    hw = W / 2
    thin = lod > 0
    sk = ("back", "top", "bottom", "left", "right") if thin else ("back",)

    def fr(x0, x1, y0, y1, z0=0.0, z1=FD, strip="metal_dark"):
        box(b, x0, x1, y0, y1, z0, z1, strip, skip=sk)

    tb0, tb1 = SF_H - 0.78, SF_H - 0.70
    fr(-hw, -hw + jw, 0, SF_H)
    fr(hw - jw, hw, 0, SF_H)
    fr(-hw + jw, hw - jw, SF_H - 0.12, SF_H)
    fr(-hw + jw, hw - jw, tb0, tb1)
    dw = 1.0
    spans = [(-hw + jw, hw - jw)]
    if door:
        spans = [(-hw + jw, -dw / 2 - 0.06), (dw / 2 + 0.06, hw - jw)]
        fr(-dw / 2 - 0.06, -dw / 2, 0, tb0)
        fr(dw / 2, dw / 2 + 0.06, 0, tb0)
        # The door leaf, set back 2 cm, with a tall glass panel and a push bar.
        st, z0, z1 = 0.1, 0.02, 0.07
        box(b, -dw / 2, -dw / 2 + st, 0, tb0, z0, z1, "metal_dark", skip=sk)
        box(b, dw / 2 - st, dw / 2, 0, tb0, z0, z1, "metal_dark", skip=sk)
        box(b, -dw / 2 + st, dw / 2 - st, 0, 0.3, z0, z1, "metal_dark", skip=sk)
        box(b, -dw / 2 + st, dw / 2 - st, tb0 - 0.1, tb0, z0, z1, "metal_dark", skip=sk)
        glass(b, -dw / 2 + st, dw / 2 - st, 0.3, tb0 - 0.1, 0.045)
        if not thin:
            beam(b, (-dw / 2 + 0.16, 1.05, 0.12), (dw / 2 - 0.16, 1.05, 0.12), 0.03, 0.03, "metal_gray")
            box(b, -dw / 2, dw / 2, 0, 0.02, 0, 0.22, "stone", skip=("back",))
    for a, c in spans:
        if c - a < 0.15:
            continue
        box(b, a, c, 0, 0.5, 0, 0.15, "stone", skip=sk)
        fr(a, c, 0.5, 0.57, 0, 0.13)
        panes = max(1, round((c - a) / 1.3))
        for k in range(1, panes):
            x = a + (c - a) * k / panes
            fr(x - 0.03, x + 0.03, 0.57, tb0)
        glass(b, a, c, 0.57, tb0, 0.05)
    lites = max(2, round((W - 2 * jw) / 0.7))
    for k in range(1, lites):
        x = -hw + jw + (W - 2 * jw) * k / lites
        fr(x - 0.02, x + 0.02, tb1, SF_H - 0.12, 0.03, 0.09)
    glass(b, -hw + jw, hw - jw, tb1, SF_H - 0.12, 0.05)
    return b


for bay, W in (("26", 2.24), ("32", 2.84), ("45", 4.14)):
    for door in (True, False):
        nm = f"storefront_{'door' if door else 'glass'}_{bay}"
        MODULES.append((nm, (lambda W, door, nm: lambda lod: storefront(nm, W, door, lod))(W, door, nm),
                        dict(kind="wall", anchor="ground-floor bay center, at the wall base", size=[W, SF_H, 0.15],
                             fits=f"ground-floor bay of {int(bay) / 10:.1f} m (bay - 0.36 m pier)", scaleX=[0.8, 1.2], scaleY=[0.85, 1.3], tint=False)))


# Upper-floor windows: the module is the shader's window + frame rectangle
# ((window + 0.07) x bay, (window + 0.07) x floor), origin at its bottom
# center (the sill top), plus the sill and the header around it.
def window_grid(b, W, H, cols, rows, strip, fw, fd, mw, lod, gz=0.02):
    hw = W / 2
    sk = ("back",) if lod == 0 else ("back", "top", "bottom", "left", "right")
    box(b, -hw, hw, 0, fw, 0, fd, strip, skip=sk)
    box(b, -hw, hw, H - fw, H, 0, fd, strip, skip=sk)
    box(b, -hw, -hw + fw, fw, H - fw, 0, fd, strip, skip=sk)
    box(b, hw - fw, hw, fw, H - fw, 0, fd, strip, skip=sk)
    glass(b, -hw + fw, hw - fw, fw, H - fw, gz)
    if lod == 0:
        for i in range(1, cols):
            x = -hw + fw + (W - 2 * fw) * i / cols
            box(b, x - mw / 2, x + mw / 2, fw, H - fw, gz, fd * 0.75, strip, skip=("back",))
        for j in range(1, rows):
            y = fw + (H - 2 * fw) * j / rows
            box(b, -hw + fw, hw - fw, y - mw / 2, y + mw / 2, gz, fd * 0.75, strip, skip=("back",))


def window_brick(name, W, H, cols, rows, lod):
    b = Builder(name)
    hw = W / 2
    window_grid(b, W, H, cols, rows, "metal_sage", 0.07, 0.06, 0.03, lod)
    # The operable center hopper sits 1 cm proud of the grid.
    if lod == 0:
        cw = (W - 0.14) / cols
        rh = (H - 0.14) / rows
        x0 = -cw / 2 if cols % 2 else -cw
        x1 = cw / 2 if cols % 2 else cw
        y0 = 0.07 + rh * (rows // 2 - 1)
        box(b, x0, x1, y0, y0 + rh, 0.05, 0.075, "metal_sage", skip=("back",))
        glass(b, x0 + 0.03, x1 - 0.03, y0 + 0.03, y0 + rh - 0.03, 0.076)
    # A soldier-course brick header and a cast stone sill.
    box(b, -hw - 0.2, hw + 0.2, H, H + 0.24, 0, 0.035, "brick", skip=("back",))
    box(b, -hw - 0.12, hw + 0.12, H + 0.24, H + 0.29, 0, 0.05, "stone", skip=("back",))
    box(b, -hw - 0.1, hw + 0.1, -0.1, 0, 0, 0.14, "stone", skip=("back",))
    return b


def window_stucco(name, W, H, lod):
    b = Builder(name)
    hw = W / 2
    band = 0.14
    sk = ("back",) if lod == 0 else ("back", "bottom", "left", "right")
    # The stucco surround, a small cap over it, and a painted sill.
    box(b, -hw - band, -hw, 0, H, 0, 0.035, "stucco", skip=sk)
    box(b, hw, hw + band, 0, H, 0, 0.035, "stucco", skip=sk)
    box(b, -hw - band, hw + band, H, H + band, 0, 0.035, "stucco", skip=sk)
    box(b, -hw - band - 0.05, hw + band + 0.05, H + band, H + band + 0.06, 0, 0.07, "stucco", skip=sk)
    box(b, -hw - band - 0.04, hw + band + 0.04, -0.07, 0, 0, 0.1, "paint", skip=sk)
    # A painted 1-over-1 sash: the upper sash 2 cm in front of the lower.
    window_grid(b, W, H, 1, 1, "paint", 0.06, 0.07, 0.03, lod)
    box(b, -hw + 0.06, hw - 0.06, H / 2 - 0.035, H / 2 + 0.035, 0.02, 0.065, "paint", skip=sk)
    if lod == 0:
        box(b, -hw + 0.06, hw - 0.06, H / 2 + 0.035, H / 2 + 0.07, 0.02, 0.05, "paint", skip=("back",))
    return b


def window_modern(name, W, H, lod):
    b = Builder(name)
    hw = W / 2
    t, D = 0.06, 0.22
    sk = ("back",) if lod == 0 else ("back", "left", "right")
    # A dark metal box frame that sticks out 22 cm, and a fixed pane over an
    # awning vent with an off-center mullion.
    box(b, -hw - t, -hw, -t, H + t, 0, D, "metal_dark", skip=sk)
    box(b, hw, hw + t, -t, H + t, 0, D, "metal_dark", skip=sk)
    box(b, -hw, hw, H, H + t, 0, D, "metal_dark", skip=sk)
    box(b, -hw, hw, -t, 0, 0, D, "metal_dark", skip=sk)
    window_grid(b, W, H, 1, 1, "metal_dark", 0.05, 0.06, 0.04, lod)
    box(b, -hw + 0.05, hw - 0.05, 0.58, 0.62, 0.02, 0.06, "metal_dark", skip=("back",) if lod == 0 else sk)
    x = -hw + W * 0.36
    box(b, x - 0.02, x + 0.02, 0.62, H - 0.05, 0.02, 0.06, "metal_dark", skip=("back",) if lod == 0 else sk)
    return b


for nm, fn, meta in (
    ("window_brick_loft", lambda lod: window_brick("window_brick_loft", 2.1, 2.9, 3, 4, lod), dict(size=[2.1, 2.9, 0.14], fits="brick-loft (window 0.55 x 0.62, bay 3.4, floor 4.2)")),
    ("window_brick_warehouse", lambda lod: window_brick("window_brick_warehouse", 3.0, 2.85, 4, 4, lod), dict(size=[3.0, 2.85, 0.14], fits="brick-warehouse (window 0.6 x 0.5, bay 4.5, floor 5)")),
    ("window_stucco_apartment", lambda lod: window_stucco("window_stucco_apartment", 1.56, 1.98, lod), dict(size=[1.56, 1.98, 0.1], fits="stucco-apartment, craftsman-house, shotgun-house")),
    ("window_stucco_modern", lambda lod: window_modern("window_stucco_modern", 2.0, 2.28, lod), dict(size=[2.0, 2.28, 0.22], fits="modern-apartment (window 0.7 x 0.62, bay 2.6, floor 3.3)")),
):
    MODULES.append((nm, fn, dict(kind="wall", anchor="window bottom center (frame bottom = sill top)", scaleX=[0.8, 1.25], scaleY=[0.8, 1.25], tint=False, **meta)))


# Moldings: 2 m segments and an outside corner (arms of 0.6 m), one profile each.
CORNICE = [(0, 0), (0, .05), (.30, .05), (.30, .08), (.36, .08), (.36, .12), (.42, .18), (.46, .18),
           (.46, .46), (.60, .46), (.60, .50), (.66, .50), (.76, 0)]
CORNICE_LOD1 = [(0, 0), (0, .08), (.36, .08), (.46, .46), (.66, .46), (.76, 0)]
BRACKET = [(.10, .05), (.10, .12), (.30, .40), (.46, .40), (.46, .05)]
PARAPET = [(-.05, -.38), (-.05, .07), (.10, .07), (.15, -.16), (.10, -.38)]
BELT = [(0, 0), (0, .08), (.04, .12), (.20, .12), (.26, .04), (.26, 0)]
SEG = 2.0
ARM = 0.6


def cornice_seg(lod):
    b = Builder("cornice_segment")
    if lod:
        extrude(b, CORNICE_LOD1, -SEG / 2, SEG / 2, "paint")
        return b
    extrude(b, CORNICE, -SEG / 2, SEG / 2, "paint")
    for k in range(4):  # brackets every 0.5 m
        x = -SEG / 2 + 0.25 + 0.5 * k
        extrude(b, BRACKET, x - 0.05, x + 0.05, "paint", skip_d=0.05, shade=0.95)
        for j in range(4):  # dentils between brackets
            xd = x + 0.1 + 0.1 * j - 0.025
            if xd + 0.05 < SEG / 2 and abs(xd + 0.025 - (x + 0.5)) > 0.08:
                box(b, xd, xd + 0.05, .22, .30, .05, .10, "paint", skip=("back", "top"), shade=0.9)
    return b


def cornice_corner(lod):
    b = Builder("cornice_corner")
    extrude_corner(b, CORNICE_LOD1 if lod else CORNICE, ARM, "paint")
    if not lod:
        for x in (-0.35,):
            extrude(b, BRACKET, x - 0.05, x + 0.05, "paint", skip_d=0.05, shade=0.95)
        # The arm on wall B: the same bracket turned 90 degrees.
        for z in (-0.35,):
            for (ya, da), (yb, db) in zip(BRACKET, BRACKET[1:] + BRACKET[:1]):
                if da <= .05 + 1e-6 and db <= .05 + 1e-6:
                    continue
                b.poly([(da, ya, z + 0.05), (da, ya, z - 0.05), (db, yb, z - 0.05), (db, yb, z + 0.05)], (yb - ya, -(db - da), 0), "paint", 0.95)
            b.poly([(d, y, z + 0.05) for y, d in BRACKET], (0, 0, 1), "paint", 0.9)
            b.poly([(d, y, z - 0.05) for y, d in BRACKET], (0, 0, -1), "paint", 0.9)
    return b


MOLD = dict(kind="wall-run", scaleX=[0.75, 1.25], scaleY=[1, 1], tint=True)
MODULES += [
    ("cornice_segment", cornice_seg, dict(MOLD, size=[SEG, 0.76, 0.5], anchor="wall top (roof line) at the segment center; top of the profile at y = 0.76", fits="styles with parapet >= 0.5 m and height > 5 m")),
    ("cornice_corner", cornice_corner, dict(MOLD, size=[ARM + 0.5, 0.76, ARM + 0.5], kind="wall-corner", anchor="outside corner on the wall line, wall A ends here (+x), wall B turns to -z", fits="outside corners 75-105 deg")),
    ("parapet_cap_segment", lambda lod: (lambda b: (extrude(b, PARAPET, -SEG / 2, SEG / 2, "stone", skip_d=-9), b)[1])(Builder("parapet_cap_segment")), dict(MOLD, size=[SEG, 0.2, 0.45], anchor="parapet top on the wall line; the cap reaches 0.38 m back over the roof", fits="every flat-roof style with a parapet")),
    ("parapet_cap_corner", lambda lod: (lambda b: (extrude_corner(b, PARAPET, ARM, "stone", skip_d=-9), b)[1])(Builder("parapet_cap_corner")), dict(MOLD, size=[ARM + 0.07, 0.2, ARM + 0.07], kind="wall-corner", anchor="parapet top at the outside corner", fits="outside corners 75-105 deg")),
    ("belt_course_segment", lambda lod: (lambda b: (extrude(b, BELT, -SEG / 2, SEG / 2, "stone"), b)[1])(Builder("belt_course_segment")), dict(MOLD, size=[SEG, 0.26, 0.12], anchor="belt line (top of the ground floor) at the segment center", fits="storefront styles with 2+ floors")),
    ("belt_course_corner", lambda lod: (lambda b: (extrude_corner(b, BELT, ARM, "stone"), b)[1])(Builder("belt_course_corner")), dict(MOLD, size=[ARM + 0.12, 0.26, ARM + 0.12], kind="wall-corner", anchor="belt line at the outside corner", fits="outside corners 75-105 deg")),
]


def awning_fabric(lod):
    b = Builder("awning_fabric")
    W, P, D, V = 2.84, 1.2, 0.7, 0.25
    hw = W / 2
    top = [(-hw, 0, 0), (hw, 0, 0), (hw, -D, P), (-hw, -D, P)]
    b.poly(top, (0, P, D), "fabric_stripe")
    b.poly(top, (0, -P, -D), "fabric_stripe", 0.62)
    val = [(-hw, -D, P), (hw, -D, P), (hw, -D - V, P), (-hw, -D - V, P)]
    b.poly(val, (0, 0, 1), "fabric_stripe")
    b.poly(val, (0, 0, -1), "fabric_stripe", 0.62)
    for x, s in ((-hw, -1), (hw, 1)):
        side = [(x, 0, 0), (x, -D, P), (x, -D - V, P)]
        b.poly(side, (s, 0, 0), "fabric_plain", 0.9)
        b.poly(side, (-s, 0, 0), "fabric_plain", 0.6)
    if lod == 0:
        n = 12  # a scalloped valance edge
        for k in range(n):
            xa = -hw + W * k / n
            xb = -hw + W * (k + 1) / n
            tri = [(xa, -D - V, P), (xb, -D - V, P), ((xa + xb) / 2, -D - V - 0.07, P)]
            b.poly(tri, (0, 0, 1), "fabric_stripe")
            b.poly(tri, (0, 0, -1), "fabric_stripe", 0.62)
        tube(b, [(-hw, -D, P - 0.02), (hw, -D, P - 0.02)], 0.018, 6, "metal_dark")
        tube(b, [(-hw, -D, P - 0.02), (-hw, -0.05, 0.02)], 0.015, 6, "metal_dark")
        tube(b, [(hw, -D, P - 0.02), (hw, -0.05, 0.02)], 0.015, 6, "metal_dark")
    box(b, -hw, hw, -0.04, 0.04, 0, 0.05, "metal_dark")
    return b


def awning_metal(lod):
    b = Builder("awning_metal")
    W, P = 2.84, 1.0
    hw = W / 2
    box(b, -hw, hw, -0.16, 0, 0, P, "metal_dark")
    if lod == 0:
        louver_rows(b, -hw + 0.05, hw - 0.05, -0.17, -0.17, 0, (0, -1, 0))  # no-op guard
        for x in (-hw + 0.3, hw - 0.3):
            beam(b, (x, -0.02, P - 0.06), (x, 0.9, 0.02), 0.025, 0.025, "metal_gray")
            box(b, x - 0.06, x + 0.06, 0.82, 0.98, 0, 0.02, "metal_dark")
        box(b, -hw - 0.02, hw + 0.02, -0.2, 0.04, 0, 0.03, "metal_dark")
    return b


MODULES += [
    ("awning_fabric", awning_fabric, dict(kind="wall", size=[2.84, 1.02, 1.2], anchor="top edge on the wall at the bay center; y = 0 is the attach line (just under the sign band)", fits="storefront bays (scale x to bay - 0.36)", scaleX=[0.8, 1.6], scaleY=[0.8, 1.2], tint=True)),
    ("awning_metal", awning_metal, dict(kind="wall", size=[2.84, 1.14, 1.0], anchor="canopy top on the wall at the bay center", fits="brick-loft, brick-warehouse, modern-apartment, glass-office bays", scaleX=[0.8, 1.6], scaleY=[1, 1], tint=False)),
]


def railing(b, x0, x1, z0, z1, h, posts, step, lod, strip="metal_dark"):
    """A railing on the line (x0, z0)-(x1, z1): top and bottom rails, posts, pickets."""
    p0, p1 = np.array([x0, 0, z0]), np.array([x1, 0, z1])
    L = float(np.linalg.norm(p1 - p0))
    up = np.array([0, 1.0, 0])
    beam(b, p0 + up * (h - 0.02), p1 + up * (h - 0.02), 0.045, 0.04, strip)
    beam(b, p0 + up * 0.1, p1 + up * 0.1, 0.03, 0.03, strip, caps=False)
    for k in range(posts + 1):
        p = p0 + (p1 - p0) * k / posts
        beam(b, p, p + up * (h - 0.04), 0.04, 0.04, strip, caps=False)
    if lod == 0:
        n = max(1, round(L / step))
        for k in range(1, n):
            p = p0 + (p1 - p0) * k / n
            beam(b, p + up * 0.115, p + up * (h - 0.04), 0.016, 0.016, strip, caps=False)
    else:
        beam(b, p0 + up * h * 0.5, p1 + up * h * 0.5, 0.03, 0.03, strip, caps=False)


def balcony_juliet(lod):
    b = Builder("balcony_juliet")
    W, D = 1.9, 0.28
    hw = W / 2
    box(b, -hw - 0.06, hw + 0.06, -0.12, 0, 0, D + 0.04, "stone")
    railing(b, -hw, hw, D, D, 1.05, 2, 0.11, lod)
    railing(b, -hw, -hw, 0.02, D, 1.05, 1, 0.12, lod)
    railing(b, hw, hw, 0.02, D, 1.05, 1, 0.12, lod)
    return b


def balcony_slab(lod):
    b = Builder("balcony_slab")
    W, P = 3.0, 1.4
    hw = W / 2
    box(b, -hw, hw, -0.2, 0, 0, P, "concrete")
    railing(b, -hw + 0.04, hw - 0.04, P - 0.04, P - 0.04, 1.07, 3, 0.12, lod)
    railing(b, -hw + 0.04, -hw + 0.04, 0.02, P - 0.04, 1.07, 1, 0.12, lod)
    railing(b, hw - 0.04, hw - 0.04, 0.02, P - 0.04, 1.07, 1, 0.12, lod)
    return b


MODULES += [
    ("balcony_juliet", balcony_juliet, dict(kind="wall", size=[2.02, 1.07, 0.32], anchor="floor line of the floor, at the window bay center", fits="stucco-apartment, brick-loft upper floors", scaleX=[0.8, 1.3], scaleY=[1, 1], tint=False)),
    ("balcony_slab", balcony_slab, dict(kind="wall", size=[3.0, 1.27, 1.4], anchor="floor line (slab top), at the bay center", fits="modern-apartment upper floors", scaleX=[0.8, 1.4], scaleY=[1, 1], tint=False)),
]


# Fire escapes: one unit per floor. The platform top is at the floor line
# (y = 0); the stair rises to the platform of the unit above (y = FE_H).
FE_W, FE_P, FE_H = 3.4, 1.1, 4.2
OPEN = (0.6, 1.65, 0.5)  # stair opening in each platform: x0, x1, z0


def fe_platform(b, lod):
    hw = FE_W / 2
    box(b, -hw, hw, -0.12, 0, FE_P - 0.05, FE_P, "metal_dark")
    box(b, -hw, -hw + 0.05, -0.12, 0, 0, FE_P - 0.05, "metal_dark")
    box(b, hw - 0.05, hw, -0.12, 0, 0, FE_P - 0.05, "metal_dark")
    box(b, -hw + 0.05, hw - 0.05, -0.12, 0, 0, 0.05, "metal_dark")
    if lod == 0:
        n = 13
        for i in range(n):
            z0 = 0.06 + i * (FE_P - 0.12) / n
            z1 = z0 + 0.05
            pieces = [(-hw + 0.05, hw - 0.05)] if z0 < OPEN[2] else [(-hw + 0.05, OPEN[0]), (OPEN[1], hw - 0.05)]
            for a, c in pieces:
                if c - a > 0.02:
                    box(b, a, c, -0.035, 0, z0, z1, "metal_dark", skip=())
    else:
        box(b, -hw + 0.05, hw - 0.05, -0.04, -0.01, 0.05, FE_P - 0.05, "metal_dark", skip=("back", "left", "right"))
    railing(b, -hw, hw, FE_P - 0.02, FE_P - 0.02, 1.0, 2, 0.15, lod)
    railing(b, -hw + 0.02, -hw + 0.02, 0.05, FE_P - 0.02, 1.0, 1, 0.15, lod)
    railing(b, hw - 0.02, hw - 0.02, 0.05, FE_P - 0.02, 1.0, 1, 0.15, lod)
    for x in (-hw + 0.35, hw - 0.35):
        beam(b, (x, -0.1, FE_P - 0.1), (x, -0.9, 0.02), 0.04, 0.04, "metal_dark")


def fire_escape_floor(lod):
    b = Builder("fire_escape_floor")
    fe_platform(b, lod)
    xa, xb = -1.4, 1.45
    z0, z1 = 0.56, 1.0
    for z in (z0 - 0.01, z1 + 0.01):
        beam(b, (xa, 0, z), (xb, FE_H, z), 0.02, 0.18, "metal_dark", up=(0, 0, 1) if False else (0, 1, 0))
    if lod == 0:
        n = 16
        for i in range(1, n + 1):
            t = i / (n + 1)
            x, y = xa + (xb - xa) * t, FE_H * t
            box(b, x - 0.1, x + 0.1, y - 0.03, y, z0, z1, "metal_dark", skip=())
    else:
        beam(b, ((xa + 0.05), 0.05, (z0 + z1) / 2), (xb, FE_H - 0.05, (z0 + z1) / 2), z1 - z0, 0.04, "metal_dark")
    beam(b, (xa, 0.9, z1 + 0.04), (xb - 0.2, FE_H + 0.6, z1 + 0.04), 0.035, 0.035, "metal_dark")
    return b


def fire_escape_top(lod):
    b = Builder("fire_escape_top")
    fe_platform(b, lod)
    return b


def fire_escape_ladder(lod):
    b = Builder("fire_escape_ladder")
    x0, z = (OPEN[0] + OPEN[1]) / 2, 0.8
    for x in (x0 - 0.22, x0 + 0.22):
        beam(b, (x, -2.4, z), (x, 0.9, z), 0.05, 0.02, "metal_dark", up=(0, 0, 1))
    for k in range(11):
        y = -2.25 + 0.3 * k
        beam(b, (x0 - 0.21, y, z), (x0 + 0.21, y, z), 0.025, 0.025, "metal_dark", caps=False)
    return b


FE = dict(kind="wall", scaleX=[0.9, 1.15], tint=False)
MODULES += [
    ("fire_escape_floor", fire_escape_floor, dict(FE, size=[FE_W, FE_H + 0.6, FE_P], anchor="floor line, centered on a window bay; one per floor; the stair lands on the unit above", fits="brick-loft, brick-warehouse, stucco-apartment side and back walls", scaleY=[0.75, 1.2])),
    ("fire_escape_top", fire_escape_top, dict(FE, size=[FE_W, 1.0, FE_P], anchor="floor line of the top floor", fits="caps a fire_escape_floor stack", scaleY=[1, 1])),
    ("fire_escape_ladder", fire_escape_ladder, dict(FE, size=[0.49, 3.3, 0.82], anchor="floor line of the lowest platform (same origin as the platform)", fits="under the lowest fire escape platform", scaleY=[0.8, 1.2])),
]


def ac_unit(lod):
    b = Builder("ac_unit_wall")
    W, H, D = 0.66, 0.42, 0.45
    hw = W / 2
    box(b, -hw, hw, 0, H, 0, D, "metal_gray", skip=("back", "front", "left", "right"))
    louver_rows(b, -hw + 0.03, hw - 0.03, 0.03, H - 0.03, D, (0, 0, 1))
    box(b, -hw, hw, 0, 0.03, D - 0.01, D, "metal_gray", skip=("back",))
    box(b, -hw, hw, H - 0.03, H, D - 0.01, D, "metal_gray", skip=("back",))
    box(b, -hw, -hw + 0.03, 0.03, H - 0.03, D - 0.01, D, "metal_gray", skip=("back",))
    box(b, hw - 0.03, hw, 0.03, H - 0.03, D - 0.01, D, "metal_gray", skip=("back",))
    for x, s in ((-hw, -1), (hw, 1)):
        louver_rows(b, 0.0, D - 0.01, 0, H, x, (s, 0, 0), along="z")
    if lod == 0:
        for x in (-hw + 0.08, hw - 0.08):
            beam(b, (x, 0, D - 0.05), (x, -0.32, 0.01), 0.03, 0.03, "metal_dark")
            box(b, x - 0.04, x + 0.04, -0.36, -0.26, 0, 0.012, "metal_dark")
    return b


MODULES.append(("ac_unit_wall", ac_unit, dict(kind="wall", size=[0.66, 0.78, 0.45], anchor="bottom center on the wall; place 0.45 m under a window bottom", fits="stucco-apartment, brick-loft, shotgun/craftsman side walls", scaleX=[0.9, 1.1], scaleY=[0.9, 1.1], tint=False)))


# Roof modules: origin at the bottom center, front is +z.
def fan_top(b, cx, cz, y, r, lod):
    cone(b, (cx, cz), r, y, r, y + 0.08, 16 if lod == 0 else 8, "metal_gray", cap1="rubber")
    if lod == 0:
        for a in (0, math.pi / 2, math.pi / 4, -math.pi / 4):
            dx, dz = math.cos(a) * r, math.sin(a) * r
            beam(b, (cx - dx, y + 0.09, cz - dz), (cx + dx, y + 0.09, cz + dz), 0.015, 0.015, "metal_gray", caps=False)
        cone(b, (cx, cz), 0.07, y + 0.08, 0.07, y + 0.11, 8, "metal_dark", cap1=True)


def hvac_rooftop(lod):
    b = Builder("hvac_rooftop")
    L, Wd, H = 2.2, 1.3, 1.1
    box(b, -L / 2 - 0.08, L / 2 + 0.08, 0, 0.2, -Wd / 2 - 0.08, Wd / 2 + 0.08, "concrete", skip=("bottom",))
    y0, y1 = 0.2, 0.2 + H
    box(b, -L / 2, L / 2, y0, y1, -Wd / 2, Wd / 2, "metal_gray", skip=("bottom",))
    # Louvered coil panels on the left half of both long sides and the end.
    louver_rows(b, -L / 2 + 0.06, -0.05, y0 + 0.1, y1 - 0.12, Wd / 2 + 0.004, (0, 0, 1))
    louver_rows(b, -L / 2 + 0.06, -0.05, y0 + 0.1, y1 - 0.12, -Wd / 2 - 0.004, (0, 0, -1))
    louver_rows(b, -Wd / 2 + 0.06, Wd / 2 - 0.06, y0 + 0.1, y1 - 0.12, -L / 2 - 0.004, (-1, 0, 0), along="z")
    for cx in (-0.55, 0.45):
        fan_top(b, cx, 0, y1, 0.36, lod)
    if lod == 0:
        for x in (0.3, 0.75):  # service door handles
            box(b, x, x + 0.12, y0 + 0.5, y0 + 0.54, Wd / 2, Wd / 2 + 0.03, "metal_dark")
        tube(b, [(L / 2 - 0.2, y0 + 0.2, Wd / 2 - 0.2), (L / 2 + 0.25, y0 + 0.2, Wd / 2 - 0.2), (L / 2 + 0.25, 0.05, Wd / 2 - 0.2)], 0.04, 8, "rubber")
    return b


def hvac_condenser(lod):
    b = Builder("hvac_condenser")
    S, H = 0.9, 0.85
    for x in (-S / 2 + 0.05, S / 2 - 0.1):
        box(b, x, x + 0.05, 0, 0.08, -S / 2, S / 2, "rubber", skip=("bottom",))
    y0 = 0.08
    box(b, -S / 2, S / 2, y0, y0 + H, -S / 2, S / 2, "metal_gray", skip=("bottom", "front", "back", "left", "right"))
    for n, (ax, s) in {"f": ("x", 1), "b": ("x", -1), "l": ("z", -1), "r": ("z", 1)}.items():
        if ax == "x":
            louver_rows(b, -S / 2, S / 2, y0, y0 + H, s * S / 2, (0, 0, s))
        else:
            louver_rows(b, -S / 2, S / 2, y0, y0 + H, s * S / 2, (s, 0, 0), along="z")
    box(b, -S / 2 - 0.01, S / 2 + 0.01, y0 + H - 0.06, y0 + H, -S / 2 - 0.01, S / 2 + 0.01, "metal_gray", skip=("top",))
    fan_top(b, 0, 0, y0 + H, 0.33, lod)
    return b


def roof_vent(lod):
    b = Builder("roof_vent")
    cone(b, (0, 0), 0.2, 0, 0.2, 0.06, 10, "metal_gray", cap1=True)
    cone(b, (0, 0), 0.08, 0.06, 0.08, 0.5, 10, "metal_gray")
    cone(b, (0, 0), 0.2, 0.5, 0.03, 0.64, 10, "metal_gray", cap0=True)
    return b


def roof_exhaust(lod):
    b = Builder("roof_exhaust")
    box(b, -0.36, 0.36, 0, 0.3, -0.36, 0.36, "metal_gray", skip=("bottom",))
    cone(b, (0, 0), 0.3, 0.3, 0.3, 0.5, 16, "louver")
    cone(b, (0, 0), 0.42, 0.48, 0.1, 0.68, 16, "metal_gray", cap0=True)
    cone(b, (0, 0), 0.1, 0.68, 0.0, 0.7, 16, "metal_gray")
    return b


ROOF = dict(kind="roof", scaleX=[0.9, 1.1], scaleY=[0.9, 1.1], tint=False)
MODULES += [
    ("hvac_rooftop", hvac_rooftop, dict(ROOF, size=[2.5, 1.41, 1.46], anchor="bottom center on the roof", fits="flat roofs over 300 m2 (not houses)")),
    ("hvac_condenser", hvac_condenser, dict(ROOF, size=[0.92, 1.04, 0.92], anchor="bottom center on the roof", fits="flat roofs of apartments and storefronts")),
    ("roof_vent", roof_vent, dict(ROOF, size=[0.4, 0.64, 0.4], anchor="bottom center on the roof", fits="any flat roof; clusters of 2-4")),
    ("roof_exhaust", roof_exhaust, dict(ROOF, size=[0.84, 0.7, 0.84], anchor="bottom center on the roof", fits="storefront and market roofs (kitchen exhaust)")),
]


def pilaster_cap(lod):
    b = Builder("trim_pilaster_cap")
    prof = [(0, 0), (0, .1), (.12, .1), (.12, .14), (.2, .16), (.26, .16), (.26, 0)]
    extrude(b, prof, -0.25, 0.25, "stone")
    return b


def downspout(lod):
    b = Builder("trim_downspout")
    tube(b, [(0, 0, 0.09), (0, 1.0, 0.09)], 0.05, 8, "paint")
    box(b, -0.07, 0.07, 0.47, 0.53, 0, 0.145, "paint", skip=("back",), shade=0.9)
    return b


def downspout_shoe(lod):
    b = Builder("trim_downspout_shoe")
    tube(b, [(0, 0.45, 0.09), (0, 0.2, 0.09), (0, 0.08, 0.2), (0, 0.04, 0.36)], 0.05, 8, "paint", caps=True)
    return b


def downspout_head(lod):
    b = Builder("trim_downspout_head")
    prof = [(0, 0), (0, .12), (.22, .2), (.32, .2), (.32, 0)]
    extrude(b, prof, -0.16, 0.16, "paint")
    tube(b, [(0, -0.3, 0.09), (0, 0.02, 0.09)], 0.05, 8, "paint")
    return b


def sign_board(lod):
    b = Builder("trim_sign_board")
    W, H = 1.8, 0.5
    box(b, -W / 2, W / 2, 0, H, 0, 0.04, "paint")
    for x0, x1, y0, y1 in ((-W / 2 - .04, W / 2 + .04, -.04, 0), (-W / 2 - .04, W / 2 + .04, H, H + .04), (-W / 2 - .04, -W / 2, 0, H), (W / 2, W / 2 + .04, 0, H)):
        box(b, x0, x1, y0, y1, 0, 0.065, "paint", shade=0.95)
    return b


def gooseneck(lod):
    b = Builder("trim_gooseneck_lamp")
    box(b, -0.07, 0.07, -0.07, 0.07, 0, 0.03, "metal_dark")
    arc = [(0, 0, 0.03), (0, 0.1, 0.16), (0, 0.17, 0.34), (0, 0.14, 0.5), (0, 0.04, 0.6), (0, -0.04, 0.62)]
    tube(b, arc, 0.018, 6, "metal_dark")
    cone(b, (0, 0.62), 0.035, -0.03, 0.17, -0.18, 14, "metal_dark", cap0=True, inside="paint")
    return b


TRIM = dict(kind="wall", tint=True)
MODULES += [
    ("trim_pilaster", lambda lod: (lambda b: (box(b, -0.2, 0.2, 0, 1.0, 0, 0.08, "stone"), b)[1])(Builder("trim_pilaster")), dict(TRIM, size=[0.4, 1.0, 0.08], anchor="bottom center on a bay line; scale y to the run", fits="storefront piers, loft corners", scaleX=[0.8, 1.2], scaleY=[0.5, 12])),
    ("trim_pilaster_cap", pilaster_cap, dict(TRIM, size=[0.5, 0.26, 0.16], anchor="top of a trim_pilaster", fits="under the belt course", scaleX=[0.8, 1.2], scaleY=[1, 1])),
    ("trim_downspout", downspout, dict(TRIM, size=[0.14, 1.0, 0.145], anchor="bottom center; stack or scale y to the wall height", fits="next to a building corner or a fire escape", scaleX=[1, 1], scaleY=[0.5, 20])),
    ("trim_downspout_head", downspout_head, dict(TRIM, size=[0.32, 0.62, 0.2], anchor="at the roof line (cornice bottom)", fits="top of a downspout run", scaleX=[1, 1], scaleY=[1, 1])),
    ("trim_downspout_shoe", downspout_shoe, dict(TRIM, size=[0.1, 0.5, 0.41], anchor="wall base", fits="bottom of a downspout run", scaleX=[1, 1], scaleY=[1, 1])),
    ("trim_sign_board", sign_board, dict(TRIM, size=[1.88, 0.58, 0.065], anchor="bottom center on the sign band; blank (decal or shop-name texture goes on top)", fits="storefront sign bands", scaleX=[0.7, 1.6], scaleY=[0.8, 1.2])),
    ("trim_gooseneck_lamp", gooseneck, dict(kind="wall", tint=False, size=[0.34, 0.42, 0.79], anchor="wall plate center, 0.35 m above a sign board", fits="over storefront sign boards", scaleX=[1, 1], scaleY=[1, 1])),
]


# ---------- Blender objects ----------------------------------------------------
def to_object(b, mat, meta=None):
    # Kit frame (x, y up, z out) -> Blender (x, -z, y); glTF export maps it back.
    verts = [(x, -z, y) for x, y, z in b.verts]
    me = bpy.data.meshes.new(b.name)
    me.from_pydata(verts, [], b.faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    li = 0
    for fi, poly in enumerate(me.polygons):
        for k, loop in enumerate(poly.loop_indices):
            uv.data[loop].uv = b.uvs[fi][k]
        poly.use_smooth = b.smooth[fi]
    col = me.color_attributes.new("shade", "FLOAT_COLOR", "POINT")
    col.data.foreach_set("color", np.array([[s, s, s, 1.0] for s in b.cols], np.float32).ravel())
    me.color_attributes.active_color = col
    me.materials.append(mat)
    ob = bpy.data.objects.new(b.name, me)
    bpy.context.scene.collection.objects.link(ob)
    if meta:
        ob["kit"] = meta
    lo = np.min(np.array(b.verts), axis=0)
    hi = np.max(np.array(b.verts), axis=0)
    return ob, {"triangles": b.tris(), "vertices": len(b.verts), "bounds_m": {"min": [round(float(v), 3) for v in lo], "max": [round(float(v), 3) for v in hi]}}


bpy.ops.wm.read_factory_settings(use_empty=True)
rgb, nrm, orm = build_atlas()
img_c = image("facade_kit_color", rgb, True)
img_n = image("facade_kit_normal", nrm, False)
img_o = image("facade_kit_orm", orm, False)
mat = kit_material(img_c, img_n, img_o)

stats = {"modules": {}}
for name, fn, meta in MODULES:
    b0 = fn(0)
    b0.name = name
    meta = dict(meta)
    entry = {}
    if b0.tris() > LOD1_MIN_TRIS:
        b1 = fn(1)
        b1.name = f"{name}_lod1"
        if b1.tris() < b0.tris() * 0.8:
            meta["lod1"] = b1.name
            _, s1 = to_object(b1, mat, {"lod_of": name})
            entry["lod1_triangles"] = s1["triangles"]
    _, s0 = to_object(b0, mat, meta)
    entry = {**s0, **entry}
    stats["modules"][name] = entry
    print(f"{name:28s} {s0['triangles']:5d} tris" + (f"  lod1 {entry['lod1_triangles']}" if "lod1_triangles" in entry else ""))

path = os.path.join(OUT, "facade-kit.glb")
bpy.ops.export_scene.gltf(
    filepath=path, export_format="GLB", export_yup=True, export_apply=True,
    export_vertex_color="ACTIVE", export_all_vertex_colors=False, export_extras=True,
    export_image_format="JPEG", export_image_quality=86,
    export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
    export_draco_position_quantization=14, export_draco_normal_quantization=10,
    export_draco_texcoord_quantization=12, export_draco_color_quantization=8,
    export_animations=False, export_cameras=False, export_lights=False,
)
stats["bytes"] = os.path.getsize(path)
stats["textures"] = {i.name: f"{i.size[0]}x{i.size[1]}" for i in bpy.data.images}
stats["strips"] = {k: {"v_px": v, "height_px": h} for k, (v, h) in STRIPS.items()}
print("BYTES", stats["bytes"])
if STATS:
    json.dump(stats, open(STATS, "w"), indent=1)
