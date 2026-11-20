"""Skate features for Skate ATL (pbr look): rails, ledges, ramps, benches.

    ~/tools/blender -b -P scripts/blender/skate_features.py -- [OUT_DIR] [--only id,id]

Writes OUT_DIR (default assets/skate-features):
  <feature>.glb      one Draco GLB per feature: node <feature>_lod0 (and
                     <feature>_lod1 when LOD0 is over LOD1_MIN_TRIS), all on ONE
                     material, skate_trim, whose three images are external
                     (uri textures/<image>.jpg), so the texture set downloads once.
  textures/          skate_trim_color.jpg 1024, skate_trim_normal.jpg 1024,
                     skate_trim_orm.jpg 512 (glTF metallicRoughness: G rough, B metal).
  features.json      the grind / collision manifest (model space) and the stats.

Model frame (glTF): +y up, +z forward, origin at the ground center of the
footprint, meters. "Forward" is the side a skater faces or leaves by: the
bench and ledge front, the riding face of a ramp, the downhill side of a
stair set. Long rails, ledges and benches run along x.

The trim sheet is horizontal strips that tile in U (2.0 m per U period,
512 px/m) and are mapped by real size in V. A face taller than its strip is
cut into rows (Builder.poly) instead of being stretched. Textures are painted
here from seeded noise: no photos, no scans, no third-party art, no logos.
"""
import json
import math
import os
import struct
import sys

import bpy
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv and not argv[0].startswith("--") else "assets/skate-features"
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
ONLY = set(opt("--only").split(",")) if opt("--only") else None
os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)

ATLAS = 1024
PX_PER_M = 512
U_PERIOD = ATLAS / PX_PER_M  # 2.0 m
INSET = 3  # px kept clear at each strip edge (mip bleed)
LOD1_MIN_TRIS = 1500
LOD1_DISTANCE = 30.0  # m, extras.lodDistance of the _lod1 node
R4 = lambda v: round(float(v), 4)

# The trim sheet, from the bottom of the atlas (Blender v = 0) up.
STRIP_ORDER = [
    ("concrete", 192), ("concrete_wax", 96), ("granite", 96), ("wood_painted", 96),
    ("wood_ramp", 160), ("galvanized", 96), ("powder_black", 64), ("powder_green", 64),
    ("steel", 96), ("soil", 32), ("leaf", 32),
]
STRIPS = {}
_v = 0
for _n, _h in STRIP_ORDER:
    STRIPS[_n] = (_v, _h)
    _v += _h
assert _v == ATLAS


# ---------- textures ---------------------------------------------------------
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


def scratches(h, seed, count, length=(40, 260)):
    """Thin lines along U (grind scratches): a 0..1 mask, periodic in U."""
    rng = np.random.default_rng(seed)
    m = np.zeros((h, ATLAS))
    for _ in range(count):
        y = rng.integers(0, h)
        x0 = rng.integers(0, ATLAS)
        n = rng.integers(*length)
        xs = (x0 + np.arange(n)) % ATLAS
        m[y, xs] = np.maximum(m[y, xs], rng.uniform(0.4, 1.0) * np.sin(np.linspace(0, math.pi, n)))
    return m


def paint_concrete(h, seed):
    lo = noise(h, ATLAS, 6, 2, seed)
    fine = noise(h, ATLAS, 384, max(2, h // 3), seed + 1, 3)
    broom = noise(h, ATLAS, 8, max(2, h // 2), seed + 2, 2)  # light broom streaks along U
    st = noise(h, ATLAS, 12, 3, seed + 3)
    stain = np.clip((st - 0.62) * 4, 0, 1)
    k = (0.9 + 0.12 * lo) * (0.94 + 0.1 * fine) * (0.97 + 0.05 * broom) * (1 - 0.12 * stain)
    rgb = tone([0.55, 0.54, 0.51], k)
    return rgb, 1.0 * fine + 0.6 * broom, 0.86 + 0.05 * (fine - 0.5), np.zeros_like(lo)


def paint_concrete_wax(h, seed):
    """Concrete at a skated edge: chipped aggregate, dark glossy wax smears, scratches."""
    rgb, hgt, rough, metal = paint_concrete(h, seed)
    c = noise(h, ATLAS, 256, max(2, h // 2), seed + 4, 2)
    chip = np.clip((c - 0.68) * 8, 0, 1)
    rgb = rgb * (1 - chip[..., None]) + tone([0.74, 0.72, 0.67], 0.92 + 0.1 * c) * chip[..., None]
    hgt = hgt - 1.6 * chip
    w = noise(h, ATLAS, 24, max(2, h // 12), seed + 5, 3)
    wax = np.clip((w - 0.5) * 4, 0, 1)
    rgb = rgb * (1 - 0.38 * wax)[..., None]
    rough = rough * (1 - wax) + 0.3 * wax
    s = scratches(h, seed + 6, 160)
    rgb = rgb * (1 - 0.25 * s)[..., None]
    rough = rough - 0.2 * s
    return rgb, hgt - 0.6 * s, rough, metal


def paint_granite(h, seed):
    n1 = noise(h, ATLAS, 512, max(2, h // 2), seed, 1)
    n2 = noise(h, ATLAS, 384, max(2, h // 3), seed + 1, 1)
    lo = noise(h, ATLAS, 8, 2, seed + 2)
    rgb = tone([0.5, 0.5, 0.51], 0.92 + 0.12 * lo)
    for mask, col in ((n1 < 0.3, [0.11, 0.11, 0.12]), (n1 > 0.74, [0.84, 0.83, 0.8]), (n2 > 0.78, [0.6, 0.47, 0.44])):
        rgb = np.where(mask[..., None], np.array(col)[None, None, :], rgb)
    w = noise(h, ATLAS, 24, max(2, h // 12), seed + 3, 3)
    wax = np.clip((w - 0.58) * 4, 0, 1)
    rgb = rgb * (1 - 0.25 * wax)[..., None]
    return rgb, 0.3 * n1, 0.4 - 0.12 * wax + 0.04 * (lo - 0.5), np.zeros_like(lo)


def paint_wood_painted(h, seed):
    yy, xx = grid(h)
    warp = noise(h, ATLAS, 4, 4, seed + 1, 2)
    grain = 0.5 + 0.5 * np.sin(yy * 0.9 + 14 * warp)
    w = noise(h, ATLAS, 32, 4, seed + 2, 3)
    worn = np.clip((w - 0.66) * 6, 0, 1)
    paint = tone([0.12, 0.3, 0.25], 0.95 + 0.05 * grain)
    wood = tone([0.55, 0.38, 0.22], 0.85 + 0.2 * grain)
    rgb = paint * (1 - worn[..., None]) + wood * worn[..., None]
    return rgb, 0.6 * grain + 0.8 * (1 - worn), 0.5 * (1 - worn) + 0.75 * worn, np.zeros_like(w)


def paint_wood_ramp(h, seed):
    """Painted plywood ramp skin: sheet seams each 1 m in U, screw rows, wheel marks."""
    yy, xx = grid(h)
    fine = noise(h, ATLAS, 256, max(2, h // 4), seed, 3)
    lo = noise(h, ATLAS, 6, 2, seed + 1)
    seam = np.abs(((xx + 256) % 512) - 256) < 1.5
    screw = (np.abs(((xx + 256) % 512) - 256 - 10) < 2.2) & (np.abs((yy % 40) - 20) < 2.2)
    m = noise(h, ATLAS, 96, max(2, h // 10), seed + 3, 3)
    mark = np.clip((m - 0.62) * 3, 0, 1) * 0.3
    k = (0.93 + 0.08 * lo) * (0.96 + 0.06 * fine) * (1 - mark) * np.where(seam, 0.45, 1.0) * np.where(screw, 0.6, 1.0)
    rgb = tone([0.45, 0.38, 0.3], k)
    hgt = 0.4 * fine + np.where(seam, -2.5, 0.0) + np.where(screw, -1.0, 0.0)
    return rgb, hgt, 0.62 - 0.12 * mark, np.where(screw, 0.8, 0.0)


def paint_galvanized(h, seed):
    """Hot-dip galvanized zinc: spangle cells and a fine grain."""
    rng = np.random.default_rng(seed)
    yy, xx = grid(h)
    cs = 32
    cells = rng.random((h // cs + 2, ATLAS // cs))
    off = rng.integers(0, cs, h // cs + 2)
    row = (yy // cs).astype(int)
    col = (((xx + off[row]) // cs).astype(int)) % (ATLAS // cs)
    cell = cells[row, col]
    fine = noise(h, ATLAS, 256, max(2, h // 4), seed + 1, 2)
    rgb = tone([0.72, 0.74, 0.75], 0.86 + 0.14 * cell + 0.05 * fine)
    return rgb, 0.5 * cell + 0.3 * fine, 0.34 + 0.16 * cell, np.full_like(cell, 0.92)


def paint_powder(c):
    def p(h, seed):
        n = noise(h, ATLAS, 256, max(2, h // 4), seed, 2)  # orange peel
        lo = noise(h, ATLAS, 8, 2, seed + 1)
        rgb = tone(c, 0.95 + 0.06 * n + 0.04 * lo)
        return rgb, 0.5 * n, 0.46 + 0.06 * (lo - 0.5), np.full_like(n, 0.12)
    return p


def paint_steel(h, seed):
    """Bare steel worn by grinding (coping, edge angle): scratches along U, wax smudges."""
    rng = np.random.default_rng(seed)
    lo = noise(h, ATLAS, 6, 2, seed + 1)
    rowv = np.convolve(rng.random(h), np.ones(3) / 3, "same")[:, None] * np.ones((1, ATLAS))
    s = scratches(h, seed + 2, 220)
    w = noise(h, ATLAS, 16, max(2, h // 10), seed + 3, 3)
    wax = np.clip((w - 0.58) * 4, 0, 1)
    k = (0.86 + 0.14 * rowv * (0.5 + 0.5 * lo)) * (1 + 0.15 * s) * (1 - 0.3 * wax)
    rgb = tone([0.64, 0.64, 0.65], k)
    return rgb, 0.4 * rowv - 0.5 * s, 0.3 + 0.1 * rowv - 0.1 * wax, np.ones_like(lo)


def paint_grain(c, rough):
    def p(h, seed):
        n = noise(h, ATLAS, 512, max(2, h // 2), seed, 2)
        lo = noise(h, ATLAS, 32, 4, seed + 1)
        rgb = tone(c, (0.55 + 0.6 * n) * (0.9 + 0.2 * lo))
        return rgb, 2.0 * n, np.full_like(n, rough), np.zeros_like(n)
    return p


PAINTERS = {
    "concrete": paint_concrete, "concrete_wax": paint_concrete_wax, "granite": paint_granite,
    "wood_painted": paint_wood_painted, "wood_ramp": paint_wood_ramp, "galvanized": paint_galvanized,
    "powder_black": paint_powder([0.06, 0.065, 0.07]), "powder_green": paint_powder([0.1, 0.26, 0.23]),
    "steel": paint_steel, "soil": paint_grain([0.22, 0.15, 0.1], 0.95), "leaf": paint_grain([0.17, 0.33, 0.13], 0.78),
}


def build_atlas():
    rgb = np.zeros((ATLAS, ATLAS, 3))
    hgt = np.zeros((ATLAS, ATLAS))
    rough = np.zeros((ATLAS, ATLAS))
    metal = np.zeros((ATLAS, ATLAS))
    for i, (name, h) in enumerate(STRIP_ORDER):
        v0 = STRIPS[name][0]
        c, hh, r, m = PAINTERS[name](h, 9001 + 97 * i)
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
    orm = np.stack([np.ones_like(rough), np.clip(rough, 0.05, 1), np.clip(metal, 0, 1)], -1)
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


def trim_material(color, normal, orm):
    m = bpy.data.materials.new("skate_trim")
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


def strip_cap(strip):
    return (STRIPS[strip][1] - 2 * INSET) / PX_PER_M


def strip_v(vs, strip):
    v0, hp = STRIPS[strip]
    lo = min(vs)
    ext = max(vs) - lo
    hm = strip_cap(strip)
    s = 1.0 if ext <= hm else hm / ext
    return [(v0 + INSET + (v - lo) * s * PX_PER_M) / ATLAS for v in vs]


def clip_band(pts, axis, lo, hi):
    """A convex polygon cut to lo <= dot(p, axis) <= hi (Sutherland-Hodgman)."""
    def cut(poly, keep):
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            fa, fb = keep(a), keep(b)
            if fa >= 0:
                out.append(a)
            if (fa >= 0) != (fb >= 0):
                t = fa / (fa - fb)
                out.append(a + (b - a) * t)
        return out
    poly = cut(list(pts), lambda p: float(np.dot(p, axis)) - lo)
    if len(poly) >= 3:
        poly = cut(poly, lambda p: hi - float(np.dot(p, axis)))
    return poly


class Builder:
    def __init__(self, name):
        self.name = name
        self.verts, self.faces, self.uvs, self.smooth = [], [], [], []

    def poly(self, pts, normal, strip):
        pts = [np.asarray(p, float) for p in pts]
        nw = np.zeros(3)
        for i in range(len(pts)):
            nw += np.cross(pts[i], pts[(i + 1) % len(pts)])
        if np.linalg.norm(nw) < 1e-10:
            return
        if np.dot(nw, normal) < 0:
            pts = pts[::-1]
        u_ax, v_ax = frame_axes(normal, pts)
        vals = [float(np.dot(p, v_ax)) for p in pts]
        cap = strip_cap(strip)
        lo, hi = min(vals), max(vals)
        if hi - lo > cap * 1.001:
            # Taller than the strip: cut into rows so nothing is stretched.
            rows = math.ceil((hi - lo) / cap)
            for r in range(rows):
                part = clip_band(pts, v_ax, lo + (hi - lo) * r / rows, lo + (hi - lo) * (r + 1) / rows)
                if len(part) >= 3:
                    self._emit(part, u_ax, v_ax, strip)
            return
        self._emit(pts, u_ax, v_ax, strip)

    def _emit(self, pts, u_ax, v_ax, strip):
        us = [float(np.dot(p, u_ax)) / U_PERIOD for p in pts]
        vs = strip_v([float(np.dot(p, v_ax)) for p in pts], strip)
        base = len(self.verts)
        self.verts += [tuple(p) for p in pts]
        self.faces.append(list(range(base, base + len(pts))))
        self.uvs.append(list(zip(us, vs)))
        self.smooth.append(False)

    def tris(self):
        return sum(len(f) - 2 for f in self.faces)


FACE_N = {"front": (0, 0, 1), "back": (0, 0, -1), "top": (0, 1, 0), "bottom": (0, -1, 0), "left": (-1, 0, 0), "right": (1, 0, 0)}


def box(b, x0, x1, y0, y1, z0, z1, strip, skip=("bottom",), faces=None):
    """An axis box. `faces` maps a face name to its strip (default `strip`)."""
    faces = faces or {}
    q = {
        "front": [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
        "back": [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0)],
        "top": [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)],
        "bottom": [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        "left": [(x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0)],
        "right": [(x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0)],
    }
    for k, pts in q.items():
        if k not in skip:
            b.poly(pts, FACE_N[k], faces.get(k, strip))


def beam(b, p0, p1, w, h, strip, up=(0, 1, 0), caps=True):
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
        b.poly([c[i], c[j], e[j], e[i]], (c[i] + c[j]) / 2 - p0, strip)
    if caps:
        b.poly(c, -d, strip)
        b.poly(e, d, strip)


def tube(b, pts, r, segs, strip, caps=True):
    """A smooth round tube along a polyline. U runs along the tube (it tiles),
    V goes around it inside the strip."""
    pts = [np.asarray(p, float) for p in pts]
    rings = []
    for k, p in enumerate(pts):
        d = unit(pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)])
        if 0 < k < len(pts) - 1:
            d = unit(unit(pts[k + 1] - p) + unit(p - pts[k - 1]))
        ref = np.array([0, 1.0, 0]) if abs(d[1]) < 0.9 else np.array([1.0, 0, 0])
        a = unit(np.cross(d, ref))
        c = np.cross(d, a)
        # Miter: scale the ring across the bend so the tube keeps its radius.
        sc = 1.0
        if 0 < k < len(pts) - 1:
            cosh = float(np.dot(unit(pts[k + 1] - p), d))
            sc = 1.0 / max(cosh, 0.5)
        ring = []
        for i in range(segs + 1):
            t = 2 * math.pi * i / segs
            off = a * math.cos(t) + c * math.sin(t)
            # Only the in-plane component of the bend gets the miter scale.
            if sc != 1.0:
                bend = unit(unit(pts[k + 1] - p) - unit(p - pts[k - 1]))
                along = float(np.dot(off, bend))
                off = off + bend * along * (sc - 1.0)
            ring.append(p + off * r)
        rings.append(ring)
    lens = [0.0]
    for k in range(1, len(pts)):
        lens.append(lens[-1] + float(np.linalg.norm(pts[k] - pts[k - 1])))
    vv = strip_v([2 * math.pi * r * i / segs for i in range(segs + 1)], strip)
    base = len(b.verts)
    for ring in rings:
        b.verts += [tuple(q) for q in ring]
    n = segs + 1
    for k in range(len(pts) - 1):
        for i in range(segs):
            a0 = base + k * n + i
            f = [a0, a0 + 1, a0 + n + 1, a0 + n]
            q = [np.asarray(b.verts[x]) for x in f]
            nw = np.cross(q[1] - q[0], q[3] - q[0])
            if np.dot(nw, (q[0] + q[2]) / 2 - (pts[k] + pts[k + 1]) / 2) < 0:
                f = f[::-1]
            uvm = {a0: (lens[k] / U_PERIOD, vv[i]), a0 + 1: (lens[k] / U_PERIOD, vv[i + 1]),
                   a0 + n: (lens[k + 1] / U_PERIOD, vv[i]), a0 + n + 1: (lens[k + 1] / U_PERIOD, vv[i + 1])}
            b.faces.append(f)
            b.uvs.append([uvm[x] for x in f])
            b.smooth.append(True)
    if caps:
        for k, sign in ((0, -1), (len(pts) - 1, 1)):
            d = unit(pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]) * sign
            b.poly(rings[k][:-1], d, strip)


def flange(b, c, r, h, segs, strip, y0=0.0):
    """A round base plate (a short closed cylinder) at c = (x, z)."""
    ring0 = [(c[0] + r * math.cos(2 * math.pi * i / segs), y0, c[1] + r * math.sin(2 * math.pi * i / segs)) for i in range(segs)]
    ring1 = [(x, y0 + h, z) for x, _, z in ring0]
    for i in range(segs):
        j = (i + 1) % segs
        mid = ((ring0[i][0] + ring0[j][0]) / 2 - c[0], 0, (ring0[i][2] + ring0[j][2]) / 2 - c[1])
        b.poly([ring0[i], ring0[j], ring1[j], ring1[i]], mid, strip)
    b.poly(ring1, (0, 1, 0), strip)


def icosphere(subdiv):
    t = (1 + 5 ** 0.5) / 2
    v = [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]
    v = [unit(p) for p in v]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(subdiv):
        cache, nf = {}, []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                v.append(unit((v[a] + v[b]) / 2))
                cache[k] = len(v) - 1
            return cache[k]
        for a, b_, c in f:
            ab, bc, ca = mid(a, b_), mid(b_, c), mid(c, a)
            nf += [(a, ab, ca), (b_, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    return v, f


def shrub(b, c, r, hy, subdiv, seed):
    """A clipped boxwood: a lumpy, slightly flattened sphere at c = (x, y, z)."""
    v, f = icosphere(subdiv)
    c = np.asarray(c, float)
    ph = np.random.default_rng(seed).uniform(0, 6.28, 3)
    pts = []
    for p in v:
        lump = 1 + 0.1 * math.sin(7 * p[0] + ph[0]) * math.sin(6 * p[1] + ph[1]) * math.sin(5 * p[2] + ph[2])
        q = p * r * lump
        q[1] *= hy
        pts.append(c + q)
    for tri in f:
        q = [pts[i] for i in tri]
        b.poly(q, (q[0] + q[1] + q[2]) / 3 - c, "leaf")


# ---------- features ---------------------------------------------------------
# Each feature function takes the LOD (0 or 1) and returns (Builder, data).
# data (model space, the glTF frame): kind, size, grind edges, collision
# solids (boxes), ramp surfaces (profiles or planar polygons).
FEATURES = []


def feature(fid, **meta):
    def deco(fn):
        FEATURES.append((fid, fn, meta))
        return fn
    return deco


def edge(eid, kind, pts, radius):
    return {"id": eid, "kind": kind, "radius": radius, "points": [[R4(c) for c in p] for p in pts]}


def solid(x0, x1, y0, y1, z0, z1, eid="body"):
    return {"id": eid, "center": [R4((x0 + x1) / 2), R4((y0 + y1) / 2), R4((z0 + z1) / 2)], "size": [R4(x1 - x0), R4(y1 - y0), R4(z1 - z0)]}


FLAT_TOP = 0.33
FLAT_W = 0.05
FLAT_H = 0.1


def flatbar(L, legs):
    def build(lod):
        b = Builder("")
        y0 = FLAT_TOP - FLAT_H
        box(b, -L / 2, L / 2, y0, FLAT_TOP, -FLAT_W / 2, FLAT_W / 2, "powder_black", skip=(), faces={"top": "steel"})
        for x in np.linspace(-L / 2 + 0.3, L / 2 - 0.3, legs):
            box(b, x - 0.025, x + 0.025, 0.012, y0, -0.025, 0.025, "powder_black", skip=("top", "bottom"))
            box(b, x - 0.04, x + 0.04, 0.0, 0.012, -0.18, 0.18, "powder_black")
        data = {"kind": "rail", "grind": [edge("top", "rail", [(-L / 2, FLAT_TOP, 0), (L / 2, FLAT_TOP, 0)], FLAT_W / 2)], "solids": [], "surfaces": []}
        return b, data
    return build


ROUND_R = 0.024
ROUND_Y = 0.4


def round_rail(L, posts):
    def build(lod):
        b = Builder("")
        segs = 16 if lod == 0 else 8
        tube(b, [(-L / 2, ROUND_Y, 0), (L / 2, ROUND_Y, 0)], ROUND_R, segs, "galvanized")
        for x in np.linspace(-L / 2 + 0.25, L / 2 - 0.25, posts):
            tube(b, [(x, 0.012, 0), (x, ROUND_Y, 0)], ROUND_R, segs, "galvanized", caps=False)
            flange(b, (x, 0), 0.07, 0.012, segs, "galvanized")
        top = ROUND_Y + ROUND_R
        data = {"kind": "rail", "grind": [edge("top", "rail", [(-L / 2, top, 0), (L / 2, top, 0)], ROUND_R)], "solids": [], "surfaces": []}
        return b, data
    return build


RISE = 0.17
TREAD = 0.4
STAIR_W = 3.0
RAIL_OVER_NOSING = 0.6  # m, rail center over the nosing line (a skate-height handrail)


def stairs(b, n, d1, d2):
    """n risers (landing n * RISE high), a d1 m top landing, d2 m of flat
    ground after the last riser. The stairs go down toward +z. Returns the
    layout and the collision boxes."""
    T = d1 + TREAD * (n - 1) + d2
    zA = -T / 2
    z0 = zA + d1
    H = n * RISE
    hw = STAIR_W / 2
    WAX = 0.06
    solids = []
    blocks = [(zA, z0, H)] + [(z0 + TREAD * (k - 1), z0 + TREAD * k, (n - k) * RISE) for k in range(1, n)]
    for i, (za, zb, top) in enumerate(blocks):
        b.poly([(-hw, top, za), (hw, top, za), (hw, top, zb - WAX), (-hw, top, zb - WAX)], (0, 1, 0), "concrete")
        b.poly([(-hw, top, zb - WAX), (hw, top, zb - WAX), (hw, top, zb), (-hw, top, zb)], (0, 1, 0), "concrete_wax")
        b.poly([(-hw, 0, zb), (hw, 0, zb), (hw, top - 0.04, zb), (-hw, top - 0.04, zb)], (0, 0, 1), "concrete")
        b.poly([(-hw, top - 0.04, zb), (hw, top - 0.04, zb), (hw, top, zb), (-hw, top, zb)], (0, 0, 1), "concrete_wax")
        for x, nx in ((-hw, -1), (hw, 1)):
            b.poly([(x, 0, za), (x, 0, zb), (x, top, zb), (x, top, za)], (nx, 0, 0), "concrete")
        if i == 0:
            b.poly([(-hw, 0, za), (hw, 0, za), (hw, top, za), (-hw, top, za)], (0, 0, -1), "concrete")
        solids.append(solid(-hw, hw, 0, top, za, zb, "landing" if i == 0 else f"step{i}"))
    return {"zA": zA, "z0": z0, "zb": z0 + TREAD * (n - 1), "zB": T / 2, "H": H}, solids


def nosing_y(s, z):
    return s["H"] - (RISE / TREAD) * (z - s["z0"])


def rail_on_stairs(b, s, pts, post_z, segs):
    tube(b, pts, ROUND_R, segs, "galvanized")

    def rail_y(z):
        for (za, ya), (zb, yb) in zip([(p[2], p[1]) for p in pts], [(p[2], p[1]) for p in pts[1:]]):
            if za - 1e-9 <= z <= zb + 1e-9:
                return ya + (yb - ya) * (z - za) / (zb - za)
        raise ValueError(z)

    def floor_y(z):
        if z <= s["z0"]:
            return s["H"]
        if z >= s["zb"]:
            return 0.0
        k = math.ceil((z - s["z0"]) / TREAD)
        return s["H"] - k * RISE

    for z in post_z:
        fy = floor_y(z)
        tube(b, [(0, fy + 0.012, z), (0, rail_y(z), z)], ROUND_R, segs, "galvanized", caps=False)
        flange(b, (0, z), 0.07, 0.012, segs, "galvanized", y0=fy)


def down_rail(n, d1, d2):
    def build(lod):
        b = Builder("")
        segs = 16 if lod == 0 else 8
        s, solids = stairs(b, n, d1, d2)
        za, zb = s["z0"] - 0.15, s["zb"] + 0.25
        pts = [(0, nosing_y(s, za) + RAIL_OVER_NOSING, za), (0, nosing_y(s, zb) + RAIL_OVER_NOSING, zb)]
        posts = [za + 0.1, zb - 0.1]
        if n >= 6:
            posts.insert(1, s["z0"] + TREAD * (n // 2 - 0.5))
        rail_on_stairs(b, s, pts, posts, segs)
        top = [(x, y + ROUND_R, z) for x, y, z in pts]
        data = {"kind": "stairs", "grind": [edge("rail", "rail", top, ROUND_R)], "solids": solids, "surfaces": [], "stairs": {"risers": n, "rise": RISE, "tread": TREAD, "landing_height": R4(s["H"])}, "run_out_z": [s["zA"], s["zB"]]}
        return b, data
    return build


def kinked_rail(n, d1, d2):
    def build(lod):
        b = Builder("")
        segs = 16 if lod == 0 else 8
        s, solids = stairs(b, n, d1, d2)
        H, z0 = s["H"], s["z0"]
        zk = z0 + H / (RISE / TREAD)  # where the nosing line meets the ground
        pts = [(0, H + RAIL_OVER_NOSING, s["zA"] + 0.25), (0, H + RAIL_OVER_NOSING, z0), (0, RAIL_OVER_NOSING, zk), (0, RAIL_OVER_NOSING, s["zB"] - 0.25)]
        posts = [s["zA"] + 0.35, z0 - 0.2, zk + 0.2, s["zB"] - 0.35]
        rail_on_stairs(b, s, pts, posts, segs)
        top = [(x, y + ROUND_R, z) for x, y, z in pts]
        data = {"kind": "stairs", "grind": [edge("rail", "rail", top, ROUND_R)], "solids": solids, "surfaces": [], "stairs": {"risers": n, "rise": RISE, "tread": TREAD, "landing_height": R4(H)}, "run_out_z": [s["zA"], s["zB"]]}
        return b, data
    return build


def edge_angle(b, x0, x1, y_top, z_edge, sign, leg=0.04, t=0.005):
    """A steel edge angle on a top edge along x: a top flange `leg` wide
    inward from z_edge and a front flange `leg` down, t thick. sign = +1 for
    an edge facing +z, -1 for one facing -z."""
    zi, zo = z_edge - sign * leg, z_edge + sign * t
    za, zb = min(zi, zo), max(zi, zo)
    face = "front" if sign > 0 else "back"
    other = "back" if sign > 0 else "front"
    box(b, x0, x1, y_top - t, y_top, za, zb, "steel", skip=("bottom", other))
    fz0, fz1 = (z_edge, zo) if sign > 0 else (zo, z_edge)
    box(b, x0, x1, y_top - leg, y_top - t, fz0, fz1, "steel", skip=("top", other))


def end_angle(b, z0, z1, y_top, x_edge, sign, leg=0.04, t=0.005):
    """The same angle on a top edge along z (x_edge, facing sign * x)."""
    xi, xo = x_edge - sign * leg, x_edge + sign * t
    xa, xb = min(xi, xo), max(xi, xo)
    other = "left" if sign > 0 else "right"
    box(b, xa, xb, y_top - t, y_top, z0, z1, "steel", skip=("bottom", other))
    fx0, fx1 = (x_edge, xo) if sign > 0 else (xo, x_edge)
    box(b, fx0, fx1, y_top - leg, y_top - t, z0, z1, "steel", skip=("top", other))


LEDGE_H = 0.4
LEDGE_D = 0.5


def concrete_ledge(L):
    def build(lod):
        b = Builder("")
        hw, hd, H = L / 2, LEDGE_D / 2, LEDGE_H
        leg, t, wax = 0.04, 0.005, 0.07
        top = H - t
        # Top: concrete, a waxed band at the back edge; the front is under the angle.
        b.poly([(-hw, top, -hd + wax), (hw, top, -hd + wax), (hw, top, hd - leg), (-hw, top, hd - leg)], (0, 1, 0), "concrete")
        b.poly([(-hw, top, -hd), (hw, top, -hd), (hw, top, -hd + wax), (-hw, top, -hd + wax)], (0, 1, 0), "concrete_wax")
        b.poly([(-hw, 0, hd), (hw, 0, hd), (hw, H - leg, hd), (-hw, H - leg, hd)], (0, 0, 1), "concrete")
        b.poly([(-hw, 0, -hd), (hw, 0, -hd), (hw, top - 0.04, -hd), (-hw, top - 0.04, -hd)], (0, 0, -1), "concrete")
        b.poly([(-hw, top - 0.04, -hd), (hw, top - 0.04, -hd), (hw, top, -hd), (-hw, top, -hd)], (0, 0, -1), "concrete_wax")
        for x, nx in ((-hw, -1), (hw, 1)):
            b.poly([(x, 0, -hd), (x, 0, hd), (x, H - leg, hd), (x, H - leg, -hd)], (nx, 0, 0), "concrete")
            b.poly([(x, H - leg, -hd), (x, H - leg, hd - leg), (x, top, hd - leg), (x, top, -hd)], (nx, 0, 0), "concrete")
        edge_angle(b, -hw, hw, H, hd, 1, leg, t)
        data = {"kind": "ledge", "grind": [edge("front", "ledge", [(-hw, H, hd - 0.01), (hw, H, hd - 0.01)], 0.02),
                                           edge("back", "ledge", [(-hw, top, -hd + 0.01), (hw, top, -hd + 0.01)], 0.02)],
                "solids": [solid(-hw, hw, 0, H, -hd, hd + t)], "surfaces": []}
        return b, data
    return build


@feature("ledge_planter", label="Planter ledge, granite cap, 3.0 x 1.2 m")
def planter(lod):
    b = Builder("")
    W, D, H, cap_t, wall, over = 3.0, 1.2, 0.5, 0.05, 0.2, 0.02
    hw, hd = W / 2, D / 2
    cw = wall + over + 0.04  # cap width: wall + overhang + 4 cm inside lip
    y1 = H - cap_t
    # Outer walls.
    b.poly([(-hw, 0, hd), (hw, 0, hd), (hw, y1, hd), (-hw, y1, hd)], (0, 0, 1), "concrete")
    b.poly([(-hw, 0, -hd), (hw, 0, -hd), (hw, y1, -hd), (-hw, y1, -hd)], (0, 0, -1), "concrete")
    for x, nx in ((-hw, -1), (hw, 1)):
        b.poly([(x, 0, -hd), (x, 0, hd), (x, y1, hd), (x, y1, -hd)], (nx, 0, 0), "concrete")
    # Granite cap ring: front/back full length, the ends between them.
    ox, oz = hw + over, hd + over
    ix, iz = hw - cw + over, hd - cw + over
    g = "granite"
    box(b, -ox, ox, y1, H, iz, oz, g, skip=("back",) if False else ())
    box(b, -ox, ox, y1, H, -oz, -iz, g, skip=())
    box(b, -ox, -ix, y1, H, -iz, iz, g, skip=("front", "back"))
    box(b, ix, ox, y1, H, -iz, iz, g, skip=("front", "back"))
    # Inner walls down to the soil, and the soil.
    soil = 0.4
    b.poly([(-ix, soil, iz), (ix, soil, iz), (ix, y1, iz), (-ix, y1, iz)], (0, 0, -1), "concrete")
    b.poly([(-ix, soil, -iz), (ix, soil, -iz), (ix, y1, -iz), (-ix, y1, -iz)], (0, 0, 1), "concrete")
    for x, nx in ((-ix, 1), (ix, -1)):
        b.poly([(x, soil, -iz), (x, soil, iz), (x, y1, iz), (x, y1, -iz)], (nx, 0, 0), "concrete")
    b.poly([(-ix, soil, -iz), (ix, soil, -iz), (ix, soil, iz), (-ix, soil, iz)], (0, 1, 0), "soil")
    for k, x in enumerate((-0.85, 0.0, 0.85)):
        shrub(b, (x, soil + 0.2, 0), 0.32, 0.78, 3 if lod == 0 else 1, 31 + k)
    gy = H
    data = {"kind": "ledge", "grind": [
        edge("front", "ledge", [(-ox, gy, oz - 0.01), (ox, gy, oz - 0.01)], 0.02),
        edge("back", "ledge", [(-ox, gy, -oz + 0.01), (ox, gy, -oz + 0.01)], 0.02),
        edge("left", "ledge", [(-ox + 0.01, gy, -oz), (-ox + 0.01, gy, oz)], 0.02),
        edge("right", "ledge", [(ox - 0.01, gy, -oz), (ox - 0.01, gy, oz)], 0.02)],
        # The cap ring and the soil inside it, so the open center rides at soil height.
        "solids": [solid(-ox, ox, 0, H, iz, oz, "cap_front"), solid(-ox, ox, 0, H, -oz, -iz, "cap_back"),
                   solid(-ox, -ix, 0, H, -iz, iz, "cap_left"), solid(ix, ox, 0, H, -iz, iz, "cap_right"),
                   solid(-ix, ix, 0, soil, -iz, iz, "soil")], "surfaces": []}
    return b, data


@feature("manual_pad", label="Manual pad, 3.0 x 1.5 x 0.2 m, steel edges")
def manual_pad(lod):
    b = Builder("")
    W, D, H, leg, t = 3.0, 1.5, 0.2, 0.04, 0.005
    hw, hd = W / 2, D / 2
    top = H - t
    b.poly([(-hw + leg, top, -hd + leg), (hw - leg, top, -hd + leg), (hw - leg, top, hd - leg), (-hw + leg, top, hd - leg)], (0, 1, 0), "concrete")
    for z, nz in ((hd, 1), (-hd, -1)):
        b.poly([(-hw, 0, z), (hw, 0, z), (hw, H - leg, z), (-hw, H - leg, z)], (0, 0, nz), "concrete")
    for x, nx in ((-hw, -1), (hw, 1)):
        b.poly([(x, 0, -hd), (x, 0, hd), (x, H - leg, hd), (x, H - leg, -hd)], (nx, 0, 0), "concrete")
    edge_angle(b, -hw, hw, H, hd, 1, leg, t)
    edge_angle(b, -hw, hw, H, -hd, -1, leg, t)
    end_angle(b, -hd + leg, hd - leg, H, hw, 1, leg, t)
    end_angle(b, -hd + leg, hd - leg, H, -hw, -1, leg, t)
    data = {"kind": "ledge", "grind": [
        edge("front", "ledge", [(-hw, H, hd - 0.01), (hw, H, hd - 0.01)], 0.02),
        edge("back", "ledge", [(-hw, H, -hd + 0.01), (hw, H, -hd + 0.01)], 0.02),
        edge("left", "ledge", [(-hw + 0.01, H, -hd), (-hw + 0.01, H, hd)], 0.02),
        edge("right", "ledge", [(hw - 0.01, H, -hd), (hw - 0.01, H, hd)], 0.02)],
        "solids": [solid(-hw - t, hw + t, 0, H, -hd - t, hd + t)], "surfaces": []}
    return b, data


def curved_profile(H, R, segs):
    """A circular transition tangent to the ground: [(u, y)], u along the ride."""
    th = math.acos((R - H) / R)
    return [(R * math.sin(th * i / segs), R * (1 - math.cos(th * i / segs))) for i in range(segs + 1)]


def ramp_face(b, prof, hw, z_toe, toe_strip, face_strip):
    """The riding face: prof [(u, y)] going toward -z from z_toe."""
    for i in range(len(prof) - 1):
        (ua, ya), (ub, yb) = prof[i], prof[i + 1]
        za, zb = z_toe - ua, z_toe - ub
        n = (0, za - zb, yb - ya)
        b.poly([(-hw, ya, za), (hw, ya, za), (hw, yb, zb), (-hw, yb, zb)], n, toe_strip if i == 0 else face_strip)


def ramp_sides(b, prof, hw, z_toe, z_back, H, strip):
    for x, nx in ((-hw, -1), (hw, 1)):
        for i in range(len(prof) - 1):
            (ua, ya), (ub, yb) = prof[i], prof[i + 1]
            za, zb = z_toe - ua, z_toe - ub
            b.poly([(x, 0, za), (x, ya, za), (x, yb, zb), (x, 0, zb)], (nx, 0, 0), strip)
        z_lip = z_toe - prof[-1][0]
        if z_lip - z_back > 1e-6:
            b.poly([(x, 0, z_lip), (x, H, z_lip), (x, H, z_back), (x, 0, z_back)], (nx, 0, 0), strip)


@feature("ramp_quarter", label="Quarter pipe, 3.0 m wide, 1.2 m high, steel coping")
def quarter(lod):
    b = Builder("")
    W, H, R, deck = 3.0, 1.2, 1.8, 0.9
    hw = W / 2
    prof = curved_profile(H, R, 24 if lod == 0 else 10)
    umax = prof[-1][0]
    z_toe = (umax + deck) / 2
    z_lip = z_toe - umax
    z_back = z_lip - deck
    ramp_face(b, prof, hw, z_toe, "steel", "wood_ramp")
    ramp_sides(b, prof, hw, z_toe, z_back, H, "wood_ramp")
    b.poly([(-hw, H, z_lip), (hw, H, z_lip), (hw, H, z_back), (-hw, H, z_back)], (0, 1, 0), "wood_ramp")
    b.poly([(-hw, 0, z_back), (hw, 0, z_back), (hw, H, z_back), (-hw, H, z_back)], (0, 0, -1), "wood_ramp")
    cr = 0.03
    tube(b, [(-hw, H, z_lip - 0.01), (hw, H, z_lip - 0.01)], cr, 16 if lod == 0 else 8, "steel")
    surf = [[R4(z_toe - u), R4(y)] for u, y in curved_profile(H, R, 24)] + [[R4(z_back), R4(H)]]
    data = {"kind": "ramp", "grind": [edge("coping", "coping", [(-hw, H + cr, z_lip - 0.01), (hw, H + cr, z_lip - 0.01)], cr)],
            "solids": [], "surfaces": [{"id": "face", "kind": "profile", "x": [R4(-hw), R4(hw)], "points": surf}],
            "ramp": {"height": H, "radius": R, "deck": deck}}
    return b, data


@feature("ramp_kicker", label="Kicker / launch ramp, 1.2 m wide, 0.45 m high")
def kicker(lod):
    b = Builder("")
    W, L, H = 1.2, 1.2, 0.45
    hw = W / 2
    R = (L * L + H * H) / (2 * H)
    prof = curved_profile(H, R, 14 if lod == 0 else 6)
    z_toe = L / 2
    z_back = z_toe - prof[-1][0]
    ramp_face(b, prof, hw, z_toe, "steel", "wood_ramp")
    ramp_sides(b, prof, hw, z_toe, z_back, H, "wood_ramp")
    b.poly([(-hw, 0, z_back), (hw, 0, z_back), (hw, H, z_back), (-hw, H, z_back)], (0, 0, -1), "wood_ramp")
    surf = [[R4(z_toe - u), R4(y)] for u, y in curved_profile(H, R, 14)]
    data = {"kind": "ramp", "grind": [], "solids": [],
            "surfaces": [{"id": "face", "kind": "profile", "x": [R4(-hw), R4(hw)], "points": surf}],
            "ramp": {"height": H, "radius": R4(R), "launch_deg": R4(math.degrees(math.asin(L / R)))}}
    return b, data


@feature("ramp_bank", label="Concrete bank, 3.0 m wide, 0.9 m high, steel top edge")
def bank(lod):
    b = Builder("")
    W, H, run, deck, wax = 3.0, 0.9, 2.0, 0.8, 0.07
    hw = W / 2
    z_toe = (run + deck) / 2
    z_lip = z_toe - run
    z_back = z_lip - deck
    leg, t = 0.04, 0.005
    n = (0, run, H)
    b.poly([(-hw, 0, z_toe), (hw, 0, z_toe), (hw, H - leg * H / run, z_lip + leg), (-hw, H - leg * H / run, z_lip + leg)], n, "concrete")
    b.poly([(-hw, H - leg * H / run, z_lip + leg), (hw, H - leg * H / run, z_lip + leg), (hw, H, z_lip), (-hw, H, z_lip)], n, "steel")
    b.poly([(-hw, H, z_lip), (hw, H, z_lip), (hw, H, z_lip - leg), (-hw, H, z_lip - leg)], (0, 1, 0), "steel")
    b.poly([(-hw, H, z_lip - leg), (hw, H, z_lip - leg), (hw, H, z_back + wax), (-hw, H, z_back + wax)], (0, 1, 0), "concrete")
    b.poly([(-hw, H, z_back + wax), (hw, H, z_back + wax), (hw, H, z_back), (-hw, H, z_back)], (0, 1, 0), "concrete_wax")
    b.poly([(-hw, 0, z_back), (hw, 0, z_back), (hw, H, z_back), (-hw, H, z_back)], (0, 0, -1), "concrete")
    for x, nx in ((-hw, -1), (hw, 1)):
        b.poly([(x, 0, z_toe), (x, H, z_lip), (x, H, z_back), (x, 0, z_back)], (nx, 0, 0), "concrete")
    data = {"kind": "ramp", "grind": [edge("lip", "ledge", [(-hw, H, z_lip - 0.01), (hw, H, z_lip - 0.01)], 0.02)], "solids": [],
            "surfaces": [{"id": "face", "kind": "profile", "x": [R4(-hw), R4(hw)], "points": [[R4(z_toe), 0], [R4(z_lip), R4(H)], [R4(z_back), R4(H)]]}],
            "ramp": {"height": H, "slope_deg": R4(math.degrees(math.atan2(H, run))), "deck": deck}}
    return b, data


@feature("ramp_pyramid", label="Pyramid / funbox, 4.4 x 4.4 m, 0.6 m high, steel top edges")
def pyramid(lod):
    b = Builder("")
    top, H, run, leg = 1.0, 0.6, 1.2, 0.05
    o = top + run
    i2 = top - leg
    # The flat top: concrete inside a steel border band.
    b.poly([(-i2, H, -i2), (i2, H, -i2), (i2, H, i2), (-i2, H, i2)], (0, 1, 0), "concrete")
    polys = []
    for ang in range(4):
        c, s = round(math.cos(ang * math.pi / 2)), round(math.sin(ang * math.pi / 2))
        rot = lambda x, y, z: (x * c + z * s, y, -x * s + z * c)
        # The side facing +z, turned by ang * 90 degrees.
        border = [rot(-top, H, top), rot(top, H, top), rot(i2, H, i2), rot(-i2, H, i2)]
        b.poly(border, (0, 1, 0), "steel")
        k = leg / run * H
        lip = [rot(-top - leg, H - k, top + leg), rot(top + leg, H - k, top + leg), rot(top, H, top), rot(-top, H, top)]
        nrm = rot(0, run, H)
        b.poly(lip, nrm, "steel")
        face = [rot(-o, 0, o), rot(o, 0, o), rot(top + leg, H - k, top + leg), rot(-top - leg, H - k, top + leg)]
        b.poly(face, nrm, "concrete")
        polys.append([[R4(v) for v in p] for p in [rot(-o, 0, o), rot(o, 0, o), rot(top, H, top), rot(-top, H, top)]])
    edges = []
    for eid, a, bb in (("front", (-top, top), (top, top)), ("right", (top, top), (top, -top)), ("back", (top, -top), (-top, -top)), ("left", (-top, -top), (-top, top))):
        edges.append(edge(eid, "ledge", [(a[0], H, a[1]), (bb[0], H, bb[1])], 0.02))
    surfaces = [{"id": "top", "kind": "polygon", "points": [[-top, H, -top], [top, H, -top], [top, H, top], [-top, H, top]]}]
    surfaces += [{"id": f"bank{k}", "kind": "polygon", "points": p} for k, p in enumerate(polys)]
    data = {"kind": "ramp", "grind": edges, "solids": [], "surfaces": surfaces, "ramp": {"height": H, "slope_deg": R4(math.degrees(math.atan2(H, run))), "top": [2 * top, 2 * top]}}
    return b, data


@feature("bench_trail", label="Trail bench, 1.8 m, painted slats, steel front edge (grindable)")
def bench_trail(lod):
    b = Builder("")
    L = 1.8
    hl = L / 2
    st, sw, seat_y = 0.04, 0.09, 0.42
    # Two steel end frames (powder coat).
    for x in (-0.75, 0.75):
        fs = 0.045
        beam(b, (x, 0.0, 0.2), (x, seat_y, 0.2), fs, fs, "powder_green")  # front leg
        beam(b, (x, 0.0, -0.17), (x, 0.86, -0.27), fs, fs, "powder_green", up=(0, 0, 1))  # back leg, leaning back
        beam(b, (x, seat_y - 0.02, 0.24), (x, seat_y - 0.02, -0.2), fs, 0.04, "powder_green")  # seat rail
        beam(b, (x, 0.02, 0.27), (x, 0.02, -0.24), 0.06, 0.04, "powder_green")  # foot runner
    # Seat slats.
    for k in range(4):
        zc = 0.17 - k * 0.11
        box(b, -hl, hl, seat_y, seat_y + st, zc - sw / 2, zc + sw / 2, "wood_painted", skip=())
    # Back slats on the back legs.
    for k in range(3):
        f = 0.58 + k * 0.12
        zc = -0.17 + (-0.1) * (f / 0.86) - 0.035
        p0 = np.array([-hl, f, zc])
        p1 = np.array([hl, f, zc])
        beam(b, p0, p1, 0.022, sw, "wood_painted", up=(0, 0.86, -0.1))
    # The grindable steel angle on the front seat edge.
    front = 0.17 + sw / 2
    box(b, -hl, hl, seat_y + st, seat_y + st + 0.005, front - 0.03, front + 0.006, "steel", skip=("bottom",))
    box(b, -hl, hl, seat_y - 0.02, seat_y + st, front, front + 0.006, "steel", skip=("back",))
    gy = seat_y + st + 0.005
    data = {"kind": "bench", "grind": [edge("front", "bench", [(-hl, gy, front - 0.01), (hl, gy, front - 0.01)], 0.02)],
            "solids": [solid(-hl, hl, 0, gy, -0.18, front + 0.006, "seat"), solid(-hl, hl, 0, 0.86, -0.3, -0.18, "back")], "surfaces": []}
    return b, data


@feature("bench_block", label="Block bench, 2.4 m, concrete, wood top, steel edges, no skatestoppers")
def bench_block(lod):
    b = Builder("")
    L, D, H = 2.4, 0.6, 0.4
    hl, hd = L / 2, D / 2
    leg, t, top = 0.045, 0.005, 0.445
    inner = hd - leg
    box(b, -hl, hl, 0, H, -hd, hd, "concrete", skip=("bottom", "top", "front", "back"))
    for z, nz in ((hd, 1), (-hd, -1)):
        b.poly([(-hl, 0, z), (hl, 0, z), (hl, top - 0.085, z), (-hl, top - 0.085, z)], (0, 0, nz), "concrete")
    b.poly([(-hl, H, -inner), (hl, H, -inner), (hl, H, inner), (-hl, H, inner)], (0, 1, 0), "concrete")
    # The ends of the steel angles stand above the concrete: close them.
    for x, nx in ((-hl, -1), (hl, 1)):
        b.poly([(x, H, -hd), (x, H, hd), (x, top, hd), (x, top, -hd)], (nx, 0, 0), "concrete")
    # Five slats across the top, 1.15 m from the center: 5 cm of concrete shows at the ends.
    n, gap = 5, 0.012
    sw = (2 * inner - gap * (n - 1)) / n
    for k in range(n):
        z0 = -inner + k * (sw + gap)
        box(b, -hl + 0.05, hl - 0.05, H, top - 0.003, z0, z0 + sw, "wood_painted", skip=("bottom",))
    edge_angle(b, -hl, hl, top, hd, 1, 0.085, t)
    edge_angle(b, -hl, hl, top, -hd, -1, 0.085, t)
    data = {"kind": "bench", "grind": [edge("front", "bench", [(-hl, top, hd - 0.01), (hl, top, hd - 0.01)], 0.02),
                                       edge("back", "bench", [(-hl, top, -hd + 0.01), (hl, top, -hd + 0.01)], 0.02)],
            "solids": [solid(-hl, hl, 0, top, -hd - t, hd + t)], "surfaces": []}
    return b, data


for _L, _legs in ((3, 2), (6, 3), (9, 4)):
    feature(f"rail_flatbar_{_L}m", label=f"Flat bar, {_L} m, powder-coated, 0.33 m high")(flatbar(_L, _legs))
for _L, _p in ((3, 2), (6, 3)):
    feature(f"rail_round_{_L}m", label=f"Round rail, {_L} m, galvanized, 0.42 m high")(round_rail(_L, _p))
feature("rail_down_4", label="Down rail over a 4-stair, 3.0 m wide stairs, galvanized handrail")(down_rail(4, 1.2, 1.0))
feature("rail_down_7", label="Down rail over a 7-stair, 3.0 m wide stairs, galvanized handrail")(down_rail(7, 1.2, 1.0))
feature("rail_kinked", label="Kinked rail (flat, down, flat) over a 4-stair")(kinked_rail(4, 2.0, 2.2))
for _L in (3, 6):
    feature(f"ledge_concrete_{_L}m", label=f"Concrete ledge, {_L} m, 0.4 m high, steel front edge")(concrete_ledge(_L))

ORDER = ["rail_flatbar_3m", "rail_flatbar_6m", "rail_flatbar_9m", "rail_round_3m", "rail_round_6m", "rail_down_4", "rail_down_7", "rail_kinked",
         "ledge_concrete_3m", "ledge_concrete_6m", "ledge_planter", "manual_pad", "ramp_quarter", "ramp_kicker", "ramp_bank", "ramp_pyramid",
         "bench_trail", "bench_block"]
FEATURES.sort(key=lambda f: ORDER.index(f[0]))


# ---------- export -----------------------------------------------------------
def to_object(b, mat, extras):
    # glTF frame (x, y up, z forward) -> Blender (x, -z, y); the exporter maps it back.
    verts = [(x, -z, y) for x, y, z in b.verts]
    me = bpy.data.meshes.new(b.name)
    me.from_pydata(verts, [], b.faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    for fi, poly in enumerate(me.polygons):
        for k, loop in enumerate(poly.loop_indices):
            uv.data[loop].uv = b.uvs[fi][k]
        poly.use_smooth = b.smooth[fi]
    me.materials.append(mat)
    ob = bpy.data.objects.new(b.name, me)
    bpy.context.scene.collection.objects.link(ob)
    for k, v in extras.items():
        ob[k] = v
    return ob


def glb_parts(path):
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gj = json.loads(data[20:20 + jlen])
    bin_off = 20 + jlen
    blen = struct.unpack_from("<I", data, bin_off)[0]
    return gj, data[bin_off + 8:bin_off + 8 + blen]


def externalize(path, tex_dir):
    """Replace the embedded images of a GLB by external uris (textures/<name>.jpg),
    write the image files once, and repack the binary chunk (bufferView
    indices are remapped everywhere). Returns the geometry byte count per mesh."""
    gj, binary = glb_parts(path)
    drop = {}
    for img in gj.get("images", []):
        if "bufferView" not in img:
            continue
        v = gj["bufferViews"][img["bufferView"]]
        drop[img["bufferView"]] = img
        fn = os.path.join(tex_dir, f"{img['name']}.jpg")
        if not os.path.exists(fn):
            open(fn, "wb").write(binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]])
    for img in gj.get("images", []):
        img.pop("bufferView", None)
        img["uri"] = f"textures/{img['name']}.jpg"
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


def bounds(b):
    a = np.array(b.verts)
    return [[R4(v) for v in a.min(0)], [R4(v) for v in a.max(0)]]


bpy.ops.wm.read_factory_settings(use_empty=True)
rgb, nrm, orm = build_atlas()
mat = trim_material(image("skate_trim_color", rgb, True), image("skate_trim_normal", nrm, False), image("skate_trim_orm", orm, False))
tex_dir = os.path.join(OUT, "textures")
for fn in os.listdir(tex_dir):
    os.remove(os.path.join(tex_dir, fn))

man_path = os.path.join(OUT, "features.json")
manifest = json.load(open(man_path)) if ONLY and os.path.exists(man_path) else {"features": {}}
for fid, fn, meta in FEATURES:
    if ONLY and fid not in ONLY:
        continue
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    b0, data = fn(0)
    b0.name = f"{fid}_lod0"
    objs = [to_object(b0, mat, {"feature": fid, "lod": 0, "lodDistance": 0.0})]
    lods = {"lod0": {"node": b0.name, "triangles": b0.tris(), "vertices": len(b0.verts), "distance": 0}}
    if b0.tris() > LOD1_MIN_TRIS:
        b1, _ = fn(1)
        b1.name = f"{fid}_lod1"
        if b1.tris() < b0.tris() * 0.8:
            objs.append(to_object(b1, mat, {"feature": fid, "lod": 1, "lodDistance": LOD1_DISTANCE}))
            lods["lod1"] = {"node": b1.name, "triangles": b1.tris(), "vertices": len(b1.verts), "distance": LOD1_DISTANCE}
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    path = os.path.join(OUT, f"{fid}.glb")
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_vertex_color="NONE", export_extras=True, export_image_format="JPEG", export_image_quality=86,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=14, export_animations=False, export_cameras=False, export_lights=False,
    )
    externalize(path, tex_dir)
    lo, hi = bounds(b0)
    # A stair set's footprint includes the flat run-out after the last riser.
    rz = data.pop("run_out_z", None)
    if rz:
        lo[2], hi[2] = R4(min(lo[2], rz[0])), R4(max(hi[2], rz[1]))
    manifest["features"][fid] = {
        "label": meta["label"], "file": f"{fid}.glb", "bytes": os.path.getsize(path), "lods": lods,
        "bounds": {"min": lo, "max": hi}, "size": [R4(hi[i] - lo[i]) for i in range(3)],
        "footprint": {"min": [lo[0], lo[2]], "max": [hi[0], hi[2]]}, **data,
    }
    print(f"{fid:20s} {b0.tris():5d} tris" + (f"  lod1 {lods['lod1']['triangles']}" if "lod1" in lods else "") + f"  {os.path.getsize(path)} B")

manifest["features"] = {k: manifest["features"][k] for k in ORDER if k in manifest["features"]}
manifest["frame"] = "glTF model space: +y up, +z forward (the front, the riding face, the downhill side), origin at the ground center of the footprint, meters. Long features run along x."
manifest["grind_format"] = "points: the grind contact polyline (the top of the rail, ledge, or coping), the same { points } spline format as src/level/splines.js; radius: the rail or edge half-width in m."
manifest["surfaces_format"] = "profile: height y over z (points [z, y], z decreasing from the toe) for x in [x0, x1]; polygon: a planar convex polygon [x, y, z] walked on from above."
manifest["textures"] = {i.name: {"file": f"textures/{i.name}.jpg", "size": list(i.size), "bytes": os.path.getsize(os.path.join(tex_dir, f"{i.name}.jpg"))} for i in bpy.data.images}
manifest["strips"] = {k: {"v_px": v, "height_px": h} for k, (v, h) in STRIPS.items()}
manifest["lod1_min_triangles"] = LOD1_MIN_TRIS
json.dump(manifest, open(man_path, "w"), indent=1)
print("TEXTURES", {k: v["bytes"] for k, v in manifest["textures"].items()})
