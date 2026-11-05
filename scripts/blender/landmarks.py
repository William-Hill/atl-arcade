"""Procedural landmark facsimiles for the beltline-eastside level.

blender -b -P scripts/blender/landmarks.py -- [--only key,key] [--out assets/landmarks]

Reads assets/landmarks/sites.json (scripts/assets/landmark-sites.mjs: the
real OSM footprints, the game heights, the terrain, and the bridge decks, in
meters local to each landmark origin) and writes, for every landmark,
assets/landmarks/<key>/<key>.glb (Draco) with one node per LOD
(<key>_lod0, <key>_lod1, and <key>_lod2 for Ponce City Market), all LODs
sharing one set of materials and tiling textures, plus provenance.json.

Axes: the level axes (+x east, +y up, +z south) are glTF axes, so the
placement transform of each model is { position: site origin, yaw: 0 }.
No photo pixels, scans of the real buildings, logos, or real names are in
the models; the sign texts are generic or fictional.
"""
import datetime
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector, geometry

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = lambda k, d=None: argv[argv.index(k) + 1] if k in argv else d
OUT = opt("--out", "assets/landmarks")
ONLY = opt("--only")
SITES = json.load(open(opt("--sites", "assets/landmarks/sites.json")))
TEXDIR = "assets/landmarks/textures"
TODAY = datetime.date.today().isoformat()

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- textures ---------------------------------------------------------
def load_pixels(path):
    img = bpy.data.images.load(os.path.abspath(path))
    w, h = img.size
    a = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    bpy.data.images.remove(img)
    return np.flipud(a)[..., :3]  # row 0 = top


def new_image(name, rgb, srgb=True, alpha=None):
    h, w = rgb.shape[:2]
    a = alpha if alpha is not None else np.ones((h, w))
    rgba = np.concatenate([np.clip(rgb, 0, 1), a[..., None]], -1)
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    img.pixels.foreach_set(np.flipud(rgba).astype(np.float32).ravel())
    img.file_format = "PNG"
    img.pack()
    return img


def file_image(name, path, srgb=True):
    img = bpy.data.images.load(os.path.abspath(path))
    img.name = name
    img.colorspace_settings.name = "sRGB" if srgb else "Non-Color"
    return img


def down2(a):
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) / 4


def noise(h, w, cells, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1))
    y = np.linspace(0, cells, h, endpoint=False)
    x = np.linspace(0, cells, w, endpoint=False)
    iy, ix = y.astype(int), x.astype(int)
    fy, fx = y - iy, x - ix
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[iy][:, ix] * (1 - fx) + g[iy][:, ix + 1] * fx
    b = g[iy + 1][:, ix] * (1 - fx) + g[iy + 1][:, ix + 1] * fx
    return a * (1 - fy)[:, None] + b * fy[:, None]


def normal_from_height(h, strength):
    # OpenGL / glTF normal maps: +x right, +y up (row 0 is the top row).
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def blur(a, r):
    out = a.copy()
    for _ in range(r):
        out = (out + np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) / 5
    return out


ATLAS_N = 1024
CELLS = 4  # 4 x 4 cells of 256 px
CELL = {}  # name -> (col, row)


def window_atlas():
    """The shared window atlas: 16 cells, row 0 at the top. Each cell is one
    window (frame, panes, glass with a sky reflection, the room behind)."""
    n = ATLAS_N
    c = n // CELLS
    col = np.zeros((n, n, 3))
    hgt = np.zeros((n, n))
    rgh = np.zeros((n, n))
    emi = np.zeros((n, n, 3))
    yy, xx = np.mgrid[0:c, 0:c].astype(float) / c

    def paint(idx, name, kind, cols, rows, frame, border=0.05, mull=0.022, seed=0, room=(0.10, 0.09, 0.08), blinds=0.0, curtains=False, lit=0.0, tanks=False, transom=None):
        cx, cy = idx % CELLS, idx // CELLS
        CELL[name] = (cx, cy)
        rng = np.random.default_rng(seed)
        frame = np.array(frame)
        dim = np.ones((c, c))
        f = (xx < border) | (xx > 1 - border) | (yy < border) | (yy > 1 - border)
        if kind in ("sash", "store"):
            for k in range(1, cols):
                f |= np.abs(xx - (border + (1 - 2 * border) * k / cols)) < mull / 2
            ys = [border + (1 - 2 * border) * k / rows for k in range(1, rows)]
            if transom:
                ys.append(transom)
            for y in ys:
                f |= np.abs(yy - y) < mull / 2
            # The room: dark, warm, a ceiling band; lit rooms are brighter.
            depth = 0.55 + 0.45 * yy
            rc = 1.6 * np.array(room)[None, None, :] * (0.7 + 0.6 * noise(c, c, 3, seed + 1)[..., None]) * depth[..., None]
            if lit:
                spots = np.zeros((c, c))
                for _ in range(3):
                    sx = rng.random()
                    spots += np.exp(-(((xx - sx) / 0.12) ** 2 + ((yy - 0.18) / 0.06) ** 2))
                rc = rc + lit * (np.array([1.0, 0.78, 0.5]) * (0.25 + 0.6 * spots[..., None]))
            if tanks:
                for k in range(3):
                    tx = 0.2 + 0.3 * k
                    t = (np.abs(xx - tx) < 0.11) & (yy > 0.35)
                    shade = 0.55 + 0.45 * np.cos((xx - tx) / 0.11 * 1.4)
                    rc[t] = (np.array([0.62, 0.42, 0.26])[None, :] * shade[t][:, None])
                    dim[t] = 0.5
            if curtains:
                for side in (0, 1):
                    m = (xx < 0.22) if side == 0 else (xx > 0.78)
                    fold = 0.82 + 0.18 * np.sin(xx * 90)
                    rc[m] = (np.array([0.80, 0.78, 0.72]) * fold[m][:, None])
                    dim[m] = 0.7
            if blinds:
                for k in range(cols):
                    x0 = border + (1 - 2 * border) * k / cols
                    x1 = border + (1 - 2 * border) * (k + 1) / cols
                    drop = blinds * (0.3 + 0.7 * rng.random())
                    m = (xx >= x0) & (xx < x1) & (yy < border + drop)
                    slat = 0.85 + 0.15 * np.sin(yy * 500)
                    rc[m] = (np.array([0.78, 0.75, 0.68]) * slat[m][:, None])
                    dim[m] = 0.45
            # Pane tint and the sky in the glass.
            pane = np.zeros((c, c))
            pk = rng.random((rows + 1, cols + 1))
            pane = pk[np.clip((yy * rows).astype(int), 0, rows), np.clip((xx * cols).astype(int), 0, cols)]
            refl = 0.2 + 0.32 * (1 - yy) ** 1.2 + 0.2 * np.clip(np.sin((xx + yy) * 7 + seed) * 0.5 + 0.2, 0, 1) + 0.1 * pane
            sky = np.array([0.62, 0.70, 0.78])
            glass = rc * (1 - refl[..., None]) + sky * refl[..., None]
            img = np.where(f[..., None], frame * (0.9 + 0.2 * noise(c, c, 8, seed + 2)[..., None]), glass)
            h = np.where(f, 1.0, 0.0)
            r = np.where(f, 0.55, 0.06)
            # The night glow of the room (emissive map): warm, brighter under
            # the ceiling lights, dimmer behind blinds and curtains, none on
            # the frame. landmark-models.js scales it by the game's windowLit.
            glow = (0.5 + 0.5 * noise(c, c, 3, seed + 5)) * (0.75 + 0.25 * (1 - yy)) * (1 + 0.3 * lit) * dim
            e = np.array([1.0, 0.72, 0.42])[None, None, :] * np.clip(glow, 0, 1.2)[..., None] * 0.8
            emi[sl_of(idx)] = np.where(f[..., None], 0.0, e)
        elif kind == "door":
            panel = (np.abs(xx - 0.5) < 0.38) & (yy > 0.08) & (yy < 0.45)
            img = np.where(panel[..., None], np.array([0.12, 0.11, 0.1]) + 0.4 * (1 - yy[..., None]) * 0.4, frame)
            f = ~panel
            h = np.where(panel, 0.0, 1.0)
            r = np.where(panel, 0.08, 0.5)
        elif kind == "screen":
            mesh = 0.5 + 0.5 * np.sin(xx * 700) * np.sin(yy * 700)
            img = np.where(f[..., None], frame, np.array([0.06, 0.065, 0.07]) * (0.8 + 0.4 * mesh[..., None]))
            h = np.where(f, 1.0, 0.2 * mesh)
            r = np.where(f, 0.5, 0.75)
        elif kind == "garage":
            slat = (yy * 22) % 1.0
            img = np.array([0.42, 0.43, 0.44])[None, None, :] * (0.75 + 0.25 * slat[..., None]) * (0.9 + 0.2 * noise(c, c, 6, seed)[..., None])
            img = np.where(f[..., None], frame, img)
            h = np.where(f, 1.0, slat * 0.6)
            r = np.where(f, 0.5, 0.45)
        elif kind == "louver":
            slat = (yy * 14) % 1.0
            img = np.array([0.5, 0.51, 0.5])[None, None, :] * (0.55 + 0.45 * slat[..., None])
            img = np.where(f[..., None], frame, img)
            h = np.where(f, 1.0, slat)
            r = np.where(f, 0.5, 0.5)
        sl = (slice(cy * c, (cy + 1) * c), slice(cx * c, (cx + 1) * c))
        col[sl] = img
        hgt[sl] = blur(h, 1)
        rgh[sl] = r

    def sl_of(idx):
        cx, cy = idx % CELLS, idx // CELLS
        return (slice(cy * c, (cy + 1) * c), slice(cx * c, (cx + 1) * c))

    steel = (0.50, 0.53, 0.50)
    dark = (0.07, 0.07, 0.075)
    paint(0, "pcm_a", "sash", 3, 6, steel, seed=1)
    paint(1, "pcm_b", "sash", 3, 6, steel, seed=2, blinds=0.5)
    paint(2, "pcm_c", "sash", 3, 6, steel, seed=3, lit=0.6, room=(0.2, 0.17, 0.14))
    paint(3, "pcm_store", "store", 3, 1, (0.10, 0.09, 0.08), border=0.04, mull=0.03, seed=4, lit=1.0, room=(0.28, 0.22, 0.16), transom=0.24)
    paint(4, "tel_a", "sash", 5, 6, (0.16, 0.16, 0.17), seed=5)
    paint(5, "tel_b", "sash", 5, 6, (0.16, 0.16, 0.17), seed=6, curtains=True)
    paint(6, "tel_c", "sash", 5, 6, (0.16, 0.16, 0.17), seed=7, blinds=0.6)
    paint(7, "door", "door", 1, 1, (0.16, 0.25, 0.2), seed=8)
    paint(8, "studio_store", "store", 3, 1, dark, border=0.035, mull=0.025, seed=9, lit=0.8, room=(0.24, 0.2, 0.17), transom=0.2)
    paint(9, "studio_screen", "screen", 1, 1, dark, seed=10)
    paint(10, "studio_upper", "sash", 3, 3, dark, seed=11)
    paint(11, "garage", "garage", 1, 1, (0.2, 0.2, 0.21), seed=12)
    paint(12, "realm_store", "store", 2, 1, dark, border=0.03, mull=0.03, seed=13, lit=1.0, room=(0.25, 0.19, 0.13), tanks=True, transom=0.22)
    paint(13, "realm_upper", "sash", 2, 2, dark, border=0.04, mull=0.03, seed=14, lit=0.5, room=(0.2, 0.16, 0.12))
    paint(14, "louver", "louver", 1, 1, (0.3, 0.3, 0.3), seed=15)
    paint(15, "realm_upper_b", "sash", 2, 2, dark, border=0.04, mull=0.03, seed=16, blinds=0.4)
    nrm = normal_from_height(hgt, 2.5)
    # Painted at 1024, stored at 512 (color, normal) and 256 (roughness,
    # glow): a window is 2-4 m wide, so 128 px per cell is ~3 cm per pixel.
    return (new_image("lm_window_color", down2(col)),
            new_image("lm_window_normal", down2(nrm), srgb=False),
            new_image("lm_window_rough", np.repeat(down2(down2(rgh))[..., None], 3, -1), srgb=False),
            new_image("lm_window_emit", down2(down2(emi))))


def cell_uv(name):
    cx, cy = CELL[name]
    e = 3.0 / ATLAS_N  # 1.5 px at the stored 512 px
    u0, u1 = cx / CELLS + e, (cx + 1) / CELLS - e
    v0, v1 = 1 - (cy + 1) / CELLS + e, 1 - cy / CELLS - e
    return u0, v0, u1, v1


def far_facade(bay, fh, ww, wh, sill):
    """PCM LOD2: one bay x one floor of brick with its window, tiling."""
    n = 256
    brick = load_pixels(f"{TEXDIR}/brick/color.jpg")
    base = brick.reshape(-1, 3).mean(0)
    yy, xx = np.mgrid[0:n, 0:n].astype(float) / n
    img = np.ones((n, n, 3)) * base * (0.92 + 0.16 * noise(n, n, 6, 3)[..., None])
    x0, x1 = 0.5 - ww / bay / 2, 0.5 + ww / bay / 2
    y1 = 1 - sill / fh
    y0 = y1 - wh / fh
    win = (xx > x0) & (xx < x1) & (yy > y0) & (yy < y1)
    glass = np.array([0.16, 0.18, 0.2]) + 0.25 * (1 - (yy - y0) / (y1 - y0))[..., None] * np.array([0.5, 0.55, 0.6])
    img = np.where(win[..., None], glass, img)
    sillm = (xx > x0 - 0.02) & (xx < x1 + 0.02) & (yy >= y1) & (yy < y1 + 0.025)
    img[sillm] = (0.72, 0.68, 0.6)
    glow = np.where(win[..., None], np.array([1.0, 0.72, 0.42]) * 0.6, 0.0)
    return new_image("lm_far_pcm_color", img), new_image("lm_far_pcm_emit", down2(down2(glow)))


# ---------- materials --------------------------------------------------------
def material(name, color=None, normal=None, rough=None, tint=None, base=(0.5, 0.5, 0.5), metallic=0.0, roughness=0.6,
             alpha=False, double=False, emission=None, emit_map=None, vcol=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    if color is not None:
        tc = nt.nodes.new("ShaderNodeTexImage")
        tc.image = color
        out = tc.outputs["Color"]
        if tint:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(out, mix.inputs["A"])
            mix.inputs["B"].default_value = (*tint, 1)
            out = mix.outputs["Result"]
        if vcol:
            va = nt.nodes.new("ShaderNodeVertexColor")
            va.layer_name = "Col"
            mv = nt.nodes.new("ShaderNodeMix")
            mv.data_type = "RGBA"
            mv.blend_type = "MULTIPLY"
            mv.inputs["Factor"].default_value = 1.0
            nt.links.new(out, mv.inputs["A"])
            nt.links.new(va.outputs["Color"], mv.inputs["B"])
            out = mv.outputs["Result"]
        nt.links.new(out, bsdf.inputs["Base Color"])
        if alpha:
            rnd = nt.nodes.new("ShaderNodeMath")
            rnd.operation = "ROUND"
            nt.links.new(tc.outputs["Alpha"], rnd.inputs[0])
            nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    else:
        bsdf.inputs["Base Color"].default_value = (*base, 1)
    if normal is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = normal
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if rough is not None:
        tr = nt.nodes.new("ShaderNodeTexImage")
        tr.image = rough
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(tr.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    if emit_map is not None:
        te = nt.nodes.new("ShaderNodeTexImage")
        te.image = emit_map
        nt.links.new(te.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emission[1]
    m.use_backface_culling = not double
    return m


def setup_materials():
    bn = file_image("lm_brick_normal", f"{TEXDIR}/brick/normal.jpg", srgb=False)
    tc = file_image("lm_trim_color", f"{TEXDIR}/trim/color.jpg")
    tn = file_image("lm_trim_normal", f"{TEXDIR}/trim/normal.jpg", srgb=False)
    # Roughness at 256 px: it has no fine detail worth the 4x memory.
    br = new_image("lm_brick_rough", down2(load_pixels(f"{TEXDIR}/brick/rough.jpg")), srgb=False)
    tr = new_image("lm_trim_rough", down2(load_pixels(f"{TEXDIR}/trim/rough.jpg")), srgb=False)
    # Buff brick (the Telephone Factory) and concrete, recolored from the
    # CC0 scans so they keep the scan detail.
    red = load_pixels(f"{TEXDIR}/brick/color.jpg")
    lum = red.mean(-1, keepdims=True)
    buff = np.array([0.80, 0.67, 0.47]) * (lum / lum.mean()) ** 0.8
    buff = 0.88 * buff + 0.12 * red * (buff.mean() / red.mean())
    bfc = new_image("lm_brick_buff_color", buff)
    # A lighter red brick for the big brick masses, matching the game's
    # brick-warehouse wall tone.
    # Same rule as the game's facade shader (geo-view.js): the scan detail
    # (scan / scan mean, in linear) times the brick-warehouse wall color.
    lin = np.where(red <= 0.04045, red / 12.92, ((red + 0.055) / 1.055) ** 2.4)
    out = np.clip(lin / lin.reshape(-1, 3).mean(0) * np.array([0.62, 0.305, 0.235]), 0, 1)
    light = np.where(out <= 0.0031308, out * 12.92, 1.055 * out ** (1 / 2.4) - 0.055)
    blc = new_image("lm_brick_light_color", light)
    # The other red bricks reuse this image with a color factor (glTF
    # baseColorFactor, linear), so a building has one red brick color map:
    # the raw scan times t is the light brick times t * raw mean / light mean.
    raw_mean = lin.reshape(-1, 3).mean(0)
    as_light = lambda t: tuple(float(min(1.0, t[k] * raw_mean[k] / [0.62, 0.305, 0.235][k])) for k in range(3))
    trim = load_pixels(f"{TEXDIR}/trim/color.jpg")
    tl = trim.mean(-1, keepdims=True)
    cc = new_image("lm_concrete_color", np.array([0.60, 0.59, 0.56]) * (tl / tl.mean()) ** 1.3)
    wc, wn, wr, we = window_atlas()
    # A chain-link style mesh card for the trail bridge fences (PNG, alpha).
    n = 128
    yy, xx = np.mgrid[0:n, 0:n].astype(float) / n
    d1 = np.abs(((xx + yy) * 4) % 1 - 0.5)
    d2 = np.abs(((xx - yy) * 4) % 1 - 0.5)
    wire = (np.minimum(d1, d2) > 0.43).astype(float)
    frame = np.ones((n, n, 3)) * np.array([0.62, 0.64, 0.65])
    fence = new_image("lm_fence_color", frame, alpha=wire)
    M = {
        "brick_pcm": material("lm_brick_pcm", blc, bn, br, vcol=True),
        "brick_pcm_dark": material("lm_brick_pcm_dark", blc, bn, br, tint=(0.88, 0.84, 0.82)),
        "sill": material("lm_sill", tc, tn, tr, tint=(0.78, 0.76, 0.72)),
        "brick_studio": material("lm_brick_studio", blc, bn, br, tint=(1.0, 0.9, 0.8)),
        "brick_realm": material("lm_brick_realm", blc, bn, br, tint=as_light((0.62, 0.55, 0.52))),
        "brick_red": material("lm_brick_red", blc, bn, br, tint=as_light((0.95, 0.8, 0.76))),
        "brick_buff": material("lm_brick_buff", bfc, bn, br),
        "trim": material("lm_trim", tc, tn, tr, vcol=True),
        "trim_cream": material("lm_trim_cream", tc, tn, tr, tint=(1.08, 1.05, 0.98)),
        "concrete": material("lm_concrete", cc, tn, tr),
        "roof": material("lm_roof", cc, tn, tr, tint=(0.6, 0.6, 0.6)),
        "window": material("lm_window", wc, wn, wr, emit_map=we),
        "steel": material("lm_steel", base=(0.05, 0.055, 0.06), metallic=0.6, roughness=0.5),
        "steel_green": material("lm_steel_green", base=(0.11, 0.17, 0.15), metallic=0.5, roughness=0.55),
        "galv": material("lm_galvanized", base=(0.45, 0.47, 0.48), metallic=0.8, roughness=0.45),
        "mech": material("lm_mechanical", base=(0.55, 0.56, 0.55), metallic=0.3, roughness=0.55),
        "copper": material("lm_copper_patina", base=(0.30, 0.55, 0.50), metallic=0.25, roughness=0.55),
        "gold": material("lm_gold", base=(0.85, 0.62, 0.22), metallic=1.0, roughness=0.3),
        "letters": material("lm_sign_letters", base=(0.95, 0.62, 0.12), roughness=0.45, emission=((0.95, 0.62, 0.12), 0.35)),
        "letters_white": material("lm_sign_letters_white", base=(0.92, 0.92, 0.9), roughness=0.45, emission=((0.92, 0.92, 0.9), 0.2)),
        "wood": material("lm_wood", base=(0.42, 0.3, 0.2), roughness=0.75),
        "fence": material("lm_fence", fence, alpha=True, double=True, metallic=0.7, roughness=0.45),
    }
    TILE.update({"brick": 1.4, "trim": 3.0, "concrete": 3.0})
    return M


TILE = {}


def tile_of(mat):
    if mat.startswith("brick"):
        return TILE["brick"]
    if mat in ("trim", "trim_cream", "sill"):
        return TILE["trim"]
    if mat in ("concrete", "roof"):
        return TILE["concrete"]
    return 1.0


# ---------- mesh building (level axes: +x east, +y up, +z south) -------------
def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def newell(pts):
    n = [0.0, 0.0, 0.0]
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n[0] += (p[1] - q[1]) * (p[2] + q[2])
        n[1] += (p[2] - q[2]) * (p[0] + q[0])
        n[2] += (p[0] - q[0]) * (p[1] + q[1])
    return n


class MB:
    def __init__(self):
        self.v = []
        self.f = []  # (indices, uvs, mat, lit, anchor)
        self.anchor = None  # (x, z): the section of the faces added now

    def poly(self, pts, uvs, mat, n=None, lit=None):
        nn = newell(pts)
        if dot(nn, nn) < 1e-10:
            return
        if n is not None and dot(nn, n) < 0:
            pts, uvs = pts[::-1], uvs[::-1]
        i0 = len(self.v)
        self.v.extend(pts)
        self.f.append((list(range(i0, i0 + len(pts))), list(uvs), mat, lit, self.anchor))

    def quad_auto(self, pts, mat, n):
        """A planar quad with UVs in meters / the material tile, projected on
        the two axes of the face plane."""
        t = tile_of(mat)
        nn = n
        ax = abs(nn[0]), abs(nn[1]), abs(nn[2])
        if ax[1] >= ax[0] and ax[1] >= ax[2]:
            uvs = [(p[0] / t, p[2] / t) for p in pts]
        else:
            h = (nn[2], 0, -nn[0])
            hl = math.hypot(h[0], h[2]) or 1
            uvs = [((p[0] * h[0] + p[2] * h[2]) / hl / t, p[1] / t) for p in pts]
        self.poly(pts, uvs, mat, n)

    def beam(self, p0, p1, w, mat, caps=True, d=None):
        """A square-section beam from p0 to p1, w wide (d deep)."""
        d = d or w
        ax = sub(p1, p0)
        L = math.sqrt(dot(ax, ax))
        if L < 1e-6:
            return
        a = (ax[0] / L, ax[1] / L, ax[2] / L)
        ref = (0, 1, 0) if abs(a[1]) < 0.9 else (1, 0, 0)
        u = cross(a, ref)
        ul = math.sqrt(dot(u, u))
        u = (u[0] / ul, u[1] / ul, u[2] / ul)
        v = cross(u, a)
        corners = []
        for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            corners.append(tuple(u[k] * su * w / 2 + v[k] * sv * d / 2 for k in range(3)))
        t = tile_of(mat)
        for i in range(4):
            c0, c1 = corners[i], corners[(i + 1) % 4]
            pts = [tuple(p0[k] + c0[k] for k in range(3)), tuple(p0[k] + c1[k] for k in range(3)),
                   tuple(p1[k] + c1[k] for k in range(3)), tuple(p1[k] + c0[k] for k in range(3))]
            mid = tuple((c0[k] + c1[k]) / 2 for k in range(3))
            uvs = [(0, 0), (w / t, 0), (w / t, L / t), (0, L / t)]
            self.poly(pts, uvs, mat, mid)
        if caps:
            for p, s in ((p0, -1), (p1, 1)):
                pts = [tuple(p[k] + c[k] for k in range(3)) for c in corners]
                self.poly(pts, [(0, 0), (1, 0), (1, 1), (0, 1)], mat, tuple(a[k] * s for k in range(3)))

    def box(self, c, size, yaw, mat, skip=()):
        """An axis box turned by yaw about +y. c = (x, y0, z) bottom center."""
        sx, sy, sz = size[0] / 2, size[1], size[2] / 2
        cs, sn = math.cos(yaw), math.sin(yaw)
        P = lambda x, y, z: (c[0] + x * cs + z * sn, c[1] + y, c[2] - x * sn + z * cs)
        R = lambda x, z: (x * cs + z * sn, 0, -x * sn + z * cs)
        faces = {
            "+x": ([P(sx, 0, -sz), P(sx, 0, sz), P(sx, sy, sz), P(sx, sy, -sz)], R(1, 0)),
            "-x": ([P(-sx, 0, -sz), P(-sx, 0, sz), P(-sx, sy, sz), P(-sx, sy, -sz)], R(-1, 0)),
            "+z": ([P(-sx, 0, sz), P(sx, 0, sz), P(sx, sy, sz), P(-sx, sy, sz)], R(0, 1)),
            "-z": ([P(-sx, 0, -sz), P(sx, 0, -sz), P(sx, sy, -sz), P(-sx, sy, -sz)], R(0, -1)),
            "+y": ([P(-sx, sy, -sz), P(sx, sy, -sz), P(sx, sy, sz), P(-sx, sy, sz)], (0, 1, 0)),
            "-y": ([P(-sx, 0, -sz), P(sx, 0, -sz), P(sx, 0, sz), P(-sx, 0, sz)], (0, -1, 0)),
        }
        for k, (pts, n) in faces.items():
            if k not in skip:
                self.quad_auto(pts, mat, n)

    def ring_band(self, center, r0, r1, y0, y1, seg, mat, outward=True, smooth=True):
        """A cylinder or cone side from radius r0 at y0 to r1 at y1."""
        t = tile_of(mat)
        for i in range(seg):
            a0 = 2 * math.pi * i / seg
            a1 = 2 * math.pi * (i + 1) / seg
            p = [(center[0] + math.cos(a0) * r0, y0, center[2] + math.sin(a0) * r0),
                 (center[0] + math.cos(a1) * r0, y0, center[2] + math.sin(a1) * r0),
                 (center[0] + math.cos(a1) * r1, y1, center[2] + math.sin(a1) * r1),
                 (center[0] + math.cos(a0) * r1, y1, center[2] + math.sin(a0) * r1)]
            am = (a0 + a1) / 2
            n = (math.cos(am), 0.3 if r1 < r0 else 0, math.sin(am))
            if not outward:
                n = (-n[0], -n[1], -n[2])
            if r1 < 1e-6:
                p = p[:3]
            circ = 2 * math.pi * max(r0, r1)
            uvs = [(circ * i / seg / t, y0 / t), (circ * (i + 1) / seg / t, y0 / t), (circ * (i + 1) / seg / t, y1 / t), (circ * i / seg / t, y1 / t)][:len(p)]
            self.poly(p, uvs, mat, n)

    def disc(self, center, r, y, seg, mat, up=True):
        pts = [(center[0] + math.cos(2 * math.pi * i / seg) * r, y, center[2] + math.sin(2 * math.pi * i / seg) * r) for i in range(seg)]
        self.poly(pts, [((p[0] - center[0]) / 4, (p[2] - center[2]) / 4) for p in pts], mat, (0, 1 if up else -1, 0))

    def text(self, body, center, front, height, width, mat, extrude=0.25, res=2):
        """Letters: Blender text, fit into `width` x `height`, facing `front`."""
        cu = bpy.data.curves.new("txt", "FONT")
        cu.body = body
        cu.size = 1.0
        cu.extrude = extrude / 2
        cu.resolution_u = res
        cu.align_x = "CENTER"
        cu.align_y = "BOTTOM"
        cu.space_character = 1.08
        ob = bpy.data.objects.new("txt", cu)
        bpy.context.scene.collection.objects.link(ob)
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        xs = [v.co.x for v in me.vertices]
        ys = [v.co.y for v in me.vertices]
        s = min(width / (max(xs) - min(xs)), height / (max(ys) - min(ys)))
        x0 = (max(xs) + min(xs)) / 2
        y0 = min(ys)
        fx, fz = front
        right = (fz, 0, -fx)
        out = []
        for v in me.vertices:
            tx, ty, tz = (v.co.x - x0) * s, (v.co.y - y0) * s, v.co.z * (extrude / max(1e-6, extrude)) 
            out.append((center[0] + right[0] * tx + fx * tz, center[1] + ty, center[2] + right[2] * tx + fz * tz))
        i0 = len(self.v)
        self.v.extend(out)
        for p in me.polygons:
            ids = [i0 + k for k in p.vertices]
            if extrude <= 0 and dot(newell([self.v[k] for k in ids]), (fx, 0, fz)) < 0:
                ids = ids[::-1]
            self.f.append((ids, [(0, 0)] * len(ids), mat, None, self.anchor))
        bpy.data.objects.remove(ob)
        bpy.data.curves.remove(cu)
        bpy.data.meshes.remove(me)

    def tris(self):
        return sum(len(f[0]) - 2 for f in self.f)


# Materials that differ from another only by a color factor are drawn as that
# one with a vertex color (COLOR_0): fewer primitives, so fewer draw calls.
VC_MERGE = {"brick_pcm_dark": ("brick_pcm", (0.88, 0.84, 0.82)), "sill": ("trim", (0.78, 0.76, 0.72)),
            "trim_cream": ("trim", (1.0, 1.0, 0.98))}


def to_object(name, mb, M):
    mb.f = [(f[0], f[1], VC_MERGE[f[2]][0], f[3], f[4], VC_MERGE[f[2]][1]) if f[2] in VC_MERGE else (*f[:5], None) for f in mb.f]
    names = sorted({f[2] for f in mb.f})
    me = bpy.data.meshes.new(name)
    verts = [(x, -z, y) for (x, y, z) in mb.v]
    me.from_pydata(verts, [], [f[0] for f in mb.f])
    uv = me.uv_layers.new(name="UVMap")
    # TEXCOORD_1: u = the light key of the window (lit when u < windowLit *
    # 0.6 in landmark-models.js, the facade rule of geo-view.js).
    lit = me.uv_layers.new(name="LitKey")
    me.uv_layers.active = uv
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    me.color_attributes.active_color = col
    for p, f in zip(me.polygons, mb.f):
        key = (f[3], 0.5) if f[3] is not None else (1.0, 0.5)
        c = (*f[5], 1.0) if f[5] else (1.0, 1.0, 1.0, 1.0)
        for k in range(p.loop_total):
            uv.data[p.loop_start + k].uv = f[1][k]
            lit.data[p.loop_start + k].uv = key
            col.data[p.loop_start + k].color = c
    for n in names:
        me.materials.append(M[n])
    idx = {n: i for i, n in enumerate(names)}
    me.polygons.foreach_set("material_index", [idx[f[2]] for f in mb.f])
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.002)
    bm.to_mesh(me)
    bm.free()
    me.validate()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for o in bpy.context.scene.objects:
        o.select_set(o is ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    return ob


# ---------- site helpers ------------------------------------------------------
class Terrain:
    def __init__(self, g):
        self.g = g
        self.h = np.array(g["h"]).reshape(g["rows"], g["cols"])

    def __call__(self, x, z):
        g = self.g
        fx = min(max((x - g["x0"]) / g["step"], 0), g["cols"] - 1.001)
        fz = min(max((z - g["z0"]) / g["step"], 0), g["rows"] - 1.001)
        i, j = int(fz), int(fx)
        a, b = fz - i, fx - j
        h = self.h
        return (h[i, j] * (1 - b) + h[i, j + 1] * b) * (1 - a) + (h[i + 1, j] * (1 - b) + h[i + 1, j + 1] * b) * a


def area2(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2


def clean(ring):
    out = []
    for p in ring:
        if not out or math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) > 0.05:
            out.append(p)
    if math.hypot(out[0][0] - out[-1][0], out[0][1] - out[-1][1]) < 0.05:
        out.pop()
    return out


def edges(ring, hole):
    """Each wall of a ring: (a, b, L, t, n) with n the outward normal (out of
    the building: out of the outer ring, into a courtyard hole)."""
    s = 1 if area2(ring) > 0 else -1
    if hole:
        s = -s
    out = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        dx, dz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dz)
        if L < 0.3:
            continue
        t = (dx / L, dz / L)
        # For a ring with positive area in (x, z), (dz, -dx) points out.
        n = (t[1] * s, -t[0] * s)
        out.append((a, b, L, t, n))
    return out


def offset_ring(ring, d, hole):
    """Each point moved d meters into the building (miter, capped)."""
    E = edges(ring, hole)
    out = []
    m = len(E)
    for i in range(m):
        n0 = E[i - 1][4]
        n1 = E[i][4]
        mx, mz = n0[0] + n1[0], n0[1] + n1[1]
        ml = math.hypot(mx, mz) or 1
        mx, mz = mx / ml, mz / ml
        c = max(0.35, mx * n1[0] + mz * n1[1])
        a = E[i][0]
        out.append((a[0] - mx * d / c, a[1] - mz * d / c))
    return out


def inside(ring, x, z):
    c = False
    n = len(ring)
    for i in range(n):
        (x1, z1), (x2, z2) = ring[i], ring[(i + 1) % n]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


def dist_ring(ring, x, z, closed=True):
    best = 1e9
    for i in range(len(ring) if closed else len(ring) - 1):
        (ax, az), (bx, bz) = ring[i], ring[(i + 1) % len(ring)]
        dx, dz = bx - ax, bz - az
        l2 = dx * dx + dz * dz or 1
        t = max(0, min(1, ((x - ax) * dx + (z - az) * dz) / l2))
        best = min(best, math.hypot(ax + dx * t - x, az + dz * t - z))
    return best


def roof_poly(mb, rings, y, mat):
    loops = [[Vector((p[0], p[1], 0)) for p in r] for r in rings]
    tris = geometry.tessellate_polygon(loops)
    flat = [p for r in rings for p in r]
    t = tile_of(mat)
    for tri in tris:
        pts = [(flat[k][0], y, flat[k][1]) for k in tri]
        mb.poly(pts, [(p[0] / t, p[2] / t) for p in pts], mat, (0, 1, 0))


# ---------- facades -----------------------------------------------------------
def facade(mb, site, spec, terr, lod, rng, ring, hole, ucum):
    # Every face of a wall goes to the section of the wall (or of the set
    # anchor, e.g. the tower), at every LOD, so mixed LODs leave no gaps.
    keep = mb.anchor
    try:
        return _facade(mb, site, spec, terr, lod, rng, ring, hole, ucum, keep)
    finally:
        mb.anchor = keep


def _facade(mb, site, spec, terr, lod, rng, ring, hole, ucum, keep):
    """The walls of one ring: bays of windows between piers, floor by floor,
    cornice, parapet, coping. Windows stay above the local ground."""
    top, base = site["top"], site["base"]
    ycor = top - spec["parapet"]
    fh = spec["floor"]
    levels = []
    y1 = ycor
    while y1 > base + 0.5:
        levels.append((y1 - fh, y1))
        y1 -= fh
    levels.reverse()  # bottom first
    wall, pier = spec["wall"], spec.get("pier_mat", spec["wall"])
    rd = spec.get("reveal", 0.25)
    for a, b, L, t, n in edges(ring, hole):
        mb.anchor = keep or ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        P = lambda u, y, d: (a[0] + t[0] * u + n[0] * d, y, a[1] + t[1] * u + n[1] * d)
        N = (n[0], 0, n[1])
        T = (t[0], 0, t[1])

        def wq(u0, u1, y0, y1, d=0.0, mat=wall, nrm=N):
            if u1 - u0 < 1e-3 or y1 - y0 < 1e-3:
                return
            tt = tile_of(mat)
            pts = [P(u0, y0, d), P(u1, y0, d), P(u1, y1, d), P(u0, y1, d)]
            uvs = [((ucum + u0) / tt, y0 / tt), ((ucum + u1) / tt, y0 / tt), ((ucum + u1) / tt, y1 / tt), ((ucum + u0) / tt, y1 / tt)]
            mb.poly(pts, uvs, mat, nrm)

        def strip_box(u0, u1, y0, y1, d, mat, faces=("front", "top", "bottom")):
            # A band along the wall from depth 0 out to d.
            tt = tile_of(mat)
            if "front" in faces:
                wq(u0, u1, y0, y1, d, mat)
            for yy, nn in ((y1, (0, 1, 0)), (y0, (0, -1, 0))):
                if ("top" if nn[1] > 0 else "bottom") in faces:
                    pts = [P(u0, yy, 0), P(u1, yy, 0), P(u1, yy, d), P(u0, yy, d)]
                    uvs = [((ucum + u0) / tt, 0), ((ucum + u1) / tt, 0), ((ucum + u1) / tt, d / tt), ((ucum + u0) / tt, d / tt)]
                    mb.poly(pts, uvs, mat, nn)
            if "sides" in faces:
                for uu, nn in ((u0, (-T[0], 0, -T[2])), (u1, T)):
                    pts = [P(uu, y0, 0), P(uu, y0, d), P(uu, y1, d), P(uu, y1, 0)]
                    mb.poly(pts, [(0, y0 / tt), (d / tt, y0 / tt), (d / tt, y1 / tt), (0, y1 / tt)], mat, nn)

        nb = int(round(L / spec["bay"])) if L >= spec.get("min_wall", 3.0) else 0
        if lod == 2:
            # One quad per wall with the tiling far facade.
            if nb:
                fb = nb / L
                pts = [P(0, base, 0), P(L, base, 0), P(L, ycor, 0), P(0, ycor, 0)]
                uvs = [(0, (ycor - base) / fh), (nb, (ycor - base) / fh), (nb, 0), (0, 0)]
                uvs = [(u, 1 - v) for (u, v) in uvs]
                mb.poly(pts, uvs, "far", N, lit=0.3)
            else:
                wq(0, L, base, ycor)
            wq(0, L, ycor, top, 0, spec.get("parapet_mat", wall))
            ucum += L
            continue
        if nb == 0:
            wq(0, L, base, ycor)
        for i in range(nb):
            u0, u1 = i * L / nb, (i + 1) * L / nb
            uc = (u0 + u1) / 2
            bw = u1 - u0
            ground = terr(*[P(uc, 0, 1.0)[k] for k in (0, 2)])
            wins = []
            lowest = True
            for li, (y0, y1) in enumerate(levels):
                if y1 < ground + 0.5:
                    continue
                if y1 - max(y0, ground) < 2.0:
                    continue  # a sliver above the ground: no window, and it is not the lowest floor
                store = spec.get("store") and lowest and (y0 - ground) < 1.8
                lowest = False
                rule = spec.get("rule")
                if rule and not rule(li, i, nb, store):
                    continue
                if store:
                    ww = min(spec.get("store_w", spec["ww"]), bw - 2 * spec["min_pier"])
                    wy0 = max(y0, ground) + 0.2
                    wy1 = y1 - spec.get("store_head", 0.8)
                    cell = rng.choice(spec["store_cells"])
                else:
                    ww = min(spec["ww"], bw - 2 * spec["min_pier"])
                    wy0 = y0 + spec["sill"]
                    wy1 = wy0 + spec["wh"]
                    if wy0 < ground + 0.4 or wy1 > y1 - 0.1:
                        continue
                    cell = rng.choice(spec["cells"])
                if ww < 0.8 or wy1 - wy0 < 0.8:
                    continue
                key = rng.random() * (0.5 if store else 1.0)
                wins.append((wy0, wy1, uc - ww / 2, uc + ww / 2, cell, store, key))
            if lod == 1:
                for wy0, wy1, wu0, wu1, cell, store, key in wins:
                    q0, v0, q1, v1 = cell_uv(cell)
                    pts = [P(wu0, wy0, 0.12), P(wu1, wy0, 0.12), P(wu1, wy1, 0.12), P(wu0, wy1, 0.12)]
                    mb.poly(pts, [(q0, v0), (q1, v0), (q1, v1), (q0, v1)], "window", N, lit=key)
                continue
            # Wall around the windows: side strips, then the column between.
            if not wins:
                wq(u0, u1, base, ycor)
            else:
                wu0, wu1 = min(w[2] for w in wins), max(w[3] for w in wins)
                wq(u0, wu0, base, ycor)
                wq(wu1, u1, base, ycor)
                cur = base
                for wy0, wy1, a0, a1, cell, store, key in sorted(wins):
                    span = spec.get("spandrel") if (cur > base and not store) else None
                    wq(wu0, wu1, cur, wy0, 0, span or wall)
                    if a0 > wu0 + 1e-3:
                        wq(wu0, a0, wy0, wy1)
                    if a1 < wu1 - 1e-3:
                        wq(a1, wu1, wy0, wy1)
                    # Reveal and glass.
                    d = -rd
                    tt = tile_of(wall)
                    mb.poly([P(a0, wy0, 0), P(a0, wy0, d), P(a0, wy1, d), P(a0, wy1, 0)], [(0, wy0 / tt), (rd / tt, wy0 / tt), (rd / tt, wy1 / tt), (0, wy1 / tt)], wall, T)
                    mb.poly([P(a1, wy0, 0), P(a1, wy0, d), P(a1, wy1, d), P(a1, wy1, 0)], [(0, wy0 / tt), (rd / tt, wy0 / tt), (rd / tt, wy1 / tt), (0, wy1 / tt)], wall, (-T[0], 0, -T[2]))
                    mb.poly([P(a0, wy1, 0), P(a1, wy1, 0), P(a1, wy1, d), P(a0, wy1, d)], [(a0 / tt, 0), (a1 / tt, 0), (a1 / tt, rd / tt), (a0 / tt, rd / tt)], wall, (0, -1, 0))
                    sm = spec.get("sill_mat", "sill")
                    ts = tile_of(sm)
                    mb.poly([P(a0, wy0, 0), P(a1, wy0, 0), P(a1, wy0, d), P(a0, wy0, d)], [(a0 / ts, 0), (a1 / ts, 0), (a1 / ts, rd / ts), (a0 / ts, rd / ts)], sm, (0, 1, 0))
                    q0, v0, q1, v1 = cell_uv(cell)
                    mb.poly([P(a0, wy0, d), P(a1, wy0, d), P(a1, wy1, d), P(a0, wy1, d)], [(q0, v0), (q1, v0), (q1, v1), (q0, v1)], "window", N, lit=key)
                    cur = wy1
                wq(wu0, wu1, cur, ycor, 0, spec.get("spandrel") or wall)
        if lod < 2 and nb and spec.get("pilaster"):
            pw, pd = spec["pilaster"]
            for i in range(nb + 1):
                uc = min(max(i * L / nb, pw / 2), L - pw / 2)
                strip_box(uc - pw / 2, uc + pw / 2, base, ycor, pd, pier, ("front", "sides"))
        if lod == 1 and nb:
            wq(0, L, base, ycor)
        # Belts at floor lines, the cornice, the parapet, and the coping.
        if lod < 2:
            for (y0, y1, d, mat) in spec.get("belts", []):
                strip_box(0, L, y0, y1, d, mat, ("front", "top") if lod == 0 else ("front",))
            ch, cd = spec.get("cornice", (0.5, 0.3))
            strip_box(0, L, ycor - ch, ycor, cd, spec.get("cornice_mat", "trim"))
        wq(0, L, ycor, top, 0, spec.get("parapet_mat", wall))
        strip_box(0, L, top - 0.22, top + 0.05, 0.08 if lod == 0 else 0.0, "trim", ("front", "top") if lod == 0 else ("top",))
        ucum += L
    return ucum


def clip_ring(ring, zmax):
    """The part of a ring with z <= zmax (Sutherland-Hodgman, one plane)."""
    out = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        ia, ib = a[1] <= zmax, b[1] <= zmax
        if ia:
            out.append(a)
        if ia != ib:
            k = (zmax - a[1]) / (b[1] - a[1])
            out.append((a[0] + (b[0] - a[0]) * k, zmax))
    return out


def building_shell(mb, site, spec, lod, rng, drop=0.9, zmax=None):
    terr = Terrain(site["terrain"])
    outer = clean(site["outer"])
    holes = [clean(h) for h in site["holes"]]
    if zmax is not None:
        # Cut at the level edge: the cut is a wall like the others.
        outer = clean(clip_ring(outer, zmax))
        holes = [h for h in holes if max(p[1] for p in h) < zmax - 1.0]
    ucum = facade(mb, site, spec, terr, lod, rng, outer, False, 0.0)
    for h in holes:
        ucum = facade(mb, site, spec, terr, lod, rng, h, True, ucum)
    top = site["top"]
    if lod == 0:
        rings = [offset_ring(outer, 0.35, False)] + [offset_ring(h, 0.35, True) for h in holes]
        roof_poly(mb, rings, top - drop, "roof")
        # Inner parapet faces and the cap between the two rings.
        for ring, inner, hole in [(outer, rings[0], False)] + [(h, r, True) for h, r in zip(holes, rings[1:])]:
            E = edges(inner, hole)
            for a, b, L, t, n in E:
                pts = [(a[0], top - drop, a[1]), (b[0], top - drop, b[1]), (b[0], top, b[1]), (a[0], top, a[1])]
                mb.quad_auto(pts, spec.get("parapet_mat", spec["wall"]), (-n[0], 0, -n[1]))
            for i in range(len(ring)):
                j = (i + 1) % len(ring)
                pts = [(ring[i][0], top + 0.05, ring[i][1]), (ring[j][0], top + 0.05, ring[j][1]), (inner[j][0], top + 0.05, inner[j][1]), (inner[i][0], top + 0.05, inner[i][1])]
                mb.quad_auto(pts, "trim", (0, 1, 0))
    else:
        roof_poly(mb, [outer] + holes, top + 0.05 if lod == 1 else top, "roof")
    return outer, holes


def free_spot(ring, holes, want, margin, avoid, rng, tries=400):
    """A roof point near `want`, `margin` m inside the footprint, clear of
    the points in `avoid` ((x, z, r) each)."""
    best = None
    for k in range(tries):
        if k == 0:
            x, z = want
        else:
            x, z = want[0] + rng.uniform(-1, 1) * 12 * (1 + k / 40), want[1] + rng.uniform(-1, 1) * 12 * (1 + k / 40)
        if not inside(ring, x, z) or dist_ring(ring, x, z) < margin:
            continue
        if any(inside(h, x, z) or dist_ring(h, x, z) < margin for h in holes):
            continue
        if any(math.hypot(x - ax, z - az) < r for ax, az, r in avoid):
            continue
        d = math.hypot(x - want[0], z - want[1])
        if not best or d < best[0]:
            best = (d, x, z)
        if k > 40 and best:
            break
    return (best[1], best[2]) if best else None


# ---------- props --------------------------------------------------------------
def water_tower(mb, c, y, lod):
    seg = 18 if lod == 0 else 10
    r, leg_h, tank_h = 3.1, 7.5, 4.2
    y0 = y + leg_h
    legs = [(c[0] + math.cos(a) * r * 0.85, c[2] + math.sin(a) * r * 0.85) for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4)]
    for lx, lz in legs:
        mb.beam((lx, y, lz), (lx + (lx - c[0]) * 0.08, y0 + 0.3, lz + (lz - c[2]) * 0.08), 0.32 if lod == 0 else 0.4, "steel_green", caps=lod == 0)
    if lod == 0:
        for k in range(4):
            (ax, az), (bx, bz) = legs[k], legs[(k + 1) % 4]
            for ya, yb in ((y + 0.6, y + leg_h / 2), (y + leg_h / 2, y0 - 0.2)):
                mb.beam((ax, ya, az), (bx, yb, bz), 0.08, "steel_green", caps=False)
                mb.beam((bx, ya, bz), (ax, yb, az), 0.08, "steel_green", caps=False)
            mb.beam((ax, y + leg_h / 2, az), (bx, y + leg_h / 2, bz), 0.12, "steel_green", caps=False)
        mb.beam((c[0], y, c[2]), (c[0], y0 - 0.8, c[2]), 0.5, "steel_green", caps=False)
    mb.ring_band(c, r * 0.35, r, y0 - 0.9, y0, seg, "steel_green")
    mb.ring_band(c, r, r, y0, y0 + tank_h, seg, "steel_green")
    mb.ring_band(c, r + 0.08, 0.25, y0 + tank_h, y0 + tank_h + 1.6, seg, "steel_green")
    if lod == 0:
        mb.ring_band(c, r + 0.7, r + 0.7, y0 + 0.05, y0 + 0.15, seg, "steel_green")
        mb.disc(c, r + 0.7, y0 + 0.15, seg, "steel_green")
        mb.ring_band(c, r + 0.7, r + 0.7, y0 + 0.9, y0 + 1.0, seg, "steel_green")
        for i in range(12):
            a = 2 * math.pi * i / 12
            px, pz = c[0] + math.cos(a) * (r + 0.7), c[2] + math.sin(a) * (r + 0.7)
            mb.beam((px, y0 + 0.15, pz), (px, y0 + 0.95, pz), 0.05, "steel_green", caps=False)
        mb.beam((c[0], y0 + tank_h + 1.6, c[2]), (c[0], y0 + tank_h + 2.4, c[2]), 0.12, "steel_green")


def sign_frame(mb, at, front, width, y_roof, letters_h, lift, text, mat, lod, depth=2.2):
    fx, fz = front
    right = (fz, -fx)
    P = lambda u, y, d: (at[0] + right[0] * u - fx * d, y, at[2] + right[1] * u - fz * d)
    yb = y_roof + lift
    yt = yb + letters_h + 0.6
    nposts = max(2, int(width / 6) + 1)
    for i in range(nposts):
        u = -width / 2 + width * i / (nposts - 1)
        mb.beam(P(u, y_roof, 0), P(u, yt, 0), 0.3, "steel", caps=lod == 0)
        if lod == 0:
            mb.beam(P(u, y_roof, depth), P(u, yb + letters_h * 0.6, depth), 0.2, "steel", caps=False)
            mb.beam(P(u, y_roof + 0.3, depth), P(u, yt - 0.3, 0), 0.14, "steel", caps=False)
            mb.beam(P(u, yb, 0), P(u, yb, depth), 0.12, "steel", caps=False)
    for y in (yb - 0.15, yt - 0.15) if lod == 0 else (yb - 0.15,):
        mb.beam(P(-width / 2 - 0.3, y, 0), P(width / 2 + 0.3, y, 0), 0.3, "steel", caps=True)
    if lod == 0:
        for i in range(nposts - 1):
            u0 = -width / 2 + width * i / (nposts - 1)
            u1 = -width / 2 + width * (i + 1) / (nposts - 1)
            mb.beam(P(u0, y_roof + 0.2, depth), P(u1, yb + letters_h * 0.6, depth), 0.1, "steel", caps=False)
    c = P(0, yb + 0.05, -0.2)
    mb.text(text, c, front, letters_h, width * 0.97, mat, extrude=0.3 if lod == 0 else 0.0, res=2 if lod == 0 else 1)


def bulkhead(mb, x, z, w, d, h, y, yaw, lod, wall):
    mb.box((x, y, z), (w, h, d), yaw, wall, skip=("-y",))
    if lod == 0:
        mb.box((x, y + h, z), (w + 0.3, 0.35, d + 0.3), yaw, "trim", skip=())
        # A louver on one face.
        cs, sn = math.cos(yaw), math.sin(yaw)
        q0, v0, q1, v1 = cell_uv("louver")
        cx, cz = x + (d / 2 + 0.02) * sn, z + (d / 2 + 0.02) * cs
        lw = min(2.4, w * 0.4)
        pts = [(cx - lw / 2 * cs, y + 1.0, cz + lw / 2 * sn), (cx + lw / 2 * cs, y + 1.0, cz - lw / 2 * sn), (cx + lw / 2 * cs, y + 3.0, cz - lw / 2 * sn), (cx - lw / 2 * cs, y + 3.0, cz + lw / 2 * sn)]
        mb.poly(pts, [(q0, v0), (q1, v0), (q1, v1), (q0, v1)], "window", (sn, 0, cs))


# ---------- landmarks ---------------------------------------------------------
def prism(mb, ring, y0, y1, mat, top=True):
    """Walls of a ring from y0 to y1, and a flat top."""
    for a, b, L, t, n in edges(ring, False):
        mb.quad_auto([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], mat, (n[0], 0, n[1]))
    if top:
        roof_poly(mb, [ring], y1, mat)


def rect(c, t, w, d):
    """A w (along t) x d rectangle centered on c, as a ring."""
    n = (-t[1], t[0])
    return [(c[0] + t[0] * su * w / 2 + n[0] * sv * d / 2, c[1] + t[1] * su * w / 2 + n[1] * sv * d / 2)
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def flat_site(ring, base, top, terrain=None):
    return {"top": top, "base": base, "outer": ring, "holes": [],
            "terrain": terrain or {"x0": 0, "z0": 0, "step": 1, "cols": 2, "rows": 2, "h": [-99] * 4}}


def shaped_parapet(mb, a, t, n, u0, u1, y0, mat, h1=1.0, h2=3.2, d=0.45):
    """A raised parapet with a rounded center over an end block, on the wall
    line a + t * u (n out of the building)."""
    w = u1 - u0
    um = (u0 + u1) / 2
    prof = [(u0, 0), (u1, 0), (u1, h1), (um + w * 0.28, h1)]
    for k in range(1, 8):
        ang = math.pi * k / 8
        prof.append((um + math.cos(ang) * w * 0.28, h1 + (h2 - h1) * math.sin(ang)))
    prof += [(um - w * 0.28, h1), (u0, h1)]
    P = lambda u, y, dd: (a[0] + t[0] * u - n[0] * dd, y0 + y, a[1] + t[1] * u - n[1] * dd)
    tt = tile_of(mat)
    mb.poly([P(u, y, 0) for u, y in prof], [(u / tt, (y0 + y) / tt) for u, y in prof], mat, (n[0], 0, n[1]))
    mb.poly([P(u, y, d) for u, y in prof], [(u / tt, (y0 + y) / tt) for u, y in prof], mat, (-n[0], 0, -n[1]))
    for i in range(2, len(prof)):
        (ua, ya), (ub, yb) = prof[i], prof[(i + 1) % len(prof)]
        if (i + 1) % len(prof) == 0:
            break
        mb.quad_auto([P(ua, ya, 0), P(ub, yb, 0), P(ub, yb, d), P(ua, ya, d)], "trim_cream", (0, 1, 0))


PCM_FLOORS = 9  # NRHP 16000769: nine stories plus basement, all sections


def pcm(site, lod):
    rng = random.Random(1926)
    mb = MB()
    top = site["top"]
    fh = (top - 1.8) / PCM_FLOORS
    spec = dict(wall="brick_pcm", pier_mat="brick_pcm_dark", parapet=1.8, floor=fh, bay=4.0, ww=2.9, wh=fh * 0.66, sill=fh * 0.17, min_pier=0.5,
                cells=["pcm_a", "pcm_a", "pcm_b", "pcm_c"], store=True, store_cells=["pcm_store"], store_w=3.1, store_head=0.9,
                pilaster=(0.8, 0.28), sills=False, cornice=(0.7, 0.35), cornice_mat="trim_cream", parapet_mat="trim_cream", reveal=0.28)
    outer, holes = building_shell(mb, site, spec, lod, rng)
    roof = top - 0.9 if lod == 0 else top
    # The Ponce de Leon Avenue facade (NRHP section 7): five blocks; the
    # central block projects and carries the tower; the end blocks have
    # shaped parapets. The central block is the short north edge pair of the
    # OSM footprint at x 15.9..32.9.
    north = [E for E in edges(outer, False) if E[4][1] < -0.9]
    cb0, cb1 = (15.94, -85.1), (32.9, -83.89)
    L = math.hypot(cb1[0] - cb0[0], cb1[1] - cb0[1])
    t = ((cb1[0] - cb0[0]) / L, (cb1[1] - cb0[1]) / L)
    inn = (-t[1], t[0])
    s = 12.0
    front = ((cb0[0] + cb1[0]) / 2, (cb0[1] + cb1[1]) / 2)
    ax, az = front[0] + inn[0] * (s / 2 + 0.2), front[1] + inn[1] * (s / 2 + 0.2)
    if lod < 2 and north:
        west = min(north, key=lambda E: E[0][0])
        east = max(north, key=lambda E: E[1][0])
        mb.anchor = (west[0][0], west[0][1])
        shaped_parapet(mb, west[0], west[3], west[4], 0.4, 12.4, top, "trim_cream")
        mb.anchor = (east[1][0], east[1][1])
        shaped_parapet(mb, east[0], east[3], east[4], east[2] - 12.4, east[2] - 0.4, top, "trim_cream")
    mb.anchor = (ax, az)
    # The tower: two brick stages with windows (the 10th floor and the water
    # tank room), a stage with two tall arched windows per side, a cornice,
    # and a pyramidal roof with overhanging eaves (NRHP section 7).
    sq = rect((ax, az), t, s, s)
    tl = min(lod, 1) if lod < 2 else 2
    y_stage = top + 2 * fh
    tspec = dict(spec, parapet=0.01, floor=fh, bay=3.0, ww=1.7, wh=fh * 0.6, sill=fh * 0.2, store=False, pilaster=(0.6, 0.2), cornice=(0.5, 0.25), min_wall=3)
    facade(mb, flat_site(sq, roof, y_stage), tspec, Terrain(flat_site(sq, 0, 0)["terrain"]), tl, rng, sq, False, 0.0)
    prism(mb, rect((ax, az), t, s + 0.5, s + 0.5), y_stage - 0.3, y_stage + 0.3, "trim_cream")
    b = s - 0.6
    sq2 = rect((ax, az), t, b, b)
    y_eave = y_stage + 7.2
    bspec = dict(tspec, floor=7.2, bay=b / 2, ww=1.5, wh=4.6, sill=1.2, cells=["pcm_a"], pilaster=(0.5, 0.2), cornice=(0.6, 0.3))
    facade(mb, flat_site(sq2, y_stage + 0.3, y_eave), bspec, Terrain(flat_site(sq, 0, 0)["terrain"]), tl, rng, sq2, False, 0.0)
    e = b + 3.0
    ring0 = rect((ax, az), t, e, e)
    prism(mb, ring0, y_eave, y_eave + 0.5, "trim_cream", top=False)
    roof_poly(mb, [ring0], y_eave, "trim_cream")
    apex = (ax, y_eave + 0.5 + 5.2, az)
    for i in range(4):
        j = (i + 1) % 4
        pts = [(ring0[i][0], y_eave + 0.5, ring0[i][1]), (ring0[j][0], y_eave + 0.5, ring0[j][1]), apex]
        mid = ((ring0[i][0] + ring0[j][0]) / 2 - ax, 0.6, (ring0[i][1] + ring0[j][1]) / 2 - az)
        mb.poly(pts, [(0, 0), (2, 0), (1, 1)], "copper", mid)
    # The rooftop sign on its steel frame (generic text, no logo).
    sg = site["sign"]
    mb.anchor = (sg["at"][0], sg["at"][2])
    sfront = (math.sin(sg["yaw"]), math.cos(sg["yaw"]))
    sign_frame(mb, (sg["at"][0], 0, sg["at"][2]), sfront, sg["width"], roof, 4.2, 2.6, "CITY MARKET", "letters", 0 if lod == 0 else 1)
    avoid = [(ax, az, 20), (sg["at"][0], sg["at"][2], 26)]
    # Stair and elevator bulkheads near the walls, then rooftop units. (No
    # rooftop water tower: the tank is inside the tower.)
    if lod < 2:
        for i, want in enumerate([(-70, -60), (-60, 60), (10, 70), (60, -60), (-20, 10), (55, 60), (-75, 0)]):
            p = free_spot(outer, holes, want, 6, avoid, rng)
            if not p:
                continue
            w, d, h = rng.uniform(8, 13), rng.uniform(6, 9), rng.uniform(4.5, 8.5)
            mb.anchor = p
            bulkhead(mb, p[0], p[1], w, d, h, roof, 0.0, lod, "brick_pcm")
            avoid.append((p[0], p[1], 12))
        if lod == 0:
            for i in range(10):
                p = free_spot(outer, holes, (rng.uniform(-80, 80), rng.uniform(-70, 70)), 5, avoid, rng, tries=60)
                if p:
                    mb.anchor = p
                    mb.box((p[0], roof, p[1]), (rng.uniform(2.5, 4), rng.uniform(1.4, 2.2), rng.uniform(2, 3)), 0, "mech", skip=("-y",))
                    avoid.append((p[0], p[1], 5))
    mb.anchor = None
    return mb


TFL_FLOORS = 4  # Wikipedia, Telephone Factory Lofts: a four-story main building
TFL_TOWER = 23.0  # the 75 ft (23 m) Art Deco entrance tower, above the street


def telephone(site, lod):
    rng = random.Random(1938)
    mb = MB()
    top = site["top"]
    ycor = top - 0.9
    fh = ycor / TFL_FLOORS
    belts = [(ycor - fh * k - 0.25 + 0.05, ycor - fh * k + 0.05, 0.05, "trim") for k in range(1, TFL_FLOORS)]
    spec = dict(wall="brick_buff", pier_mat="brick_red", spandrel="brick_red", parapet=0.9, floor=fh, bay=4.3, ww=3.2, wh=fh * 0.66, sill=fh * 0.2, min_pier=0.45,
                cells=["tel_a", "tel_a", "tel_b", "tel_c"], store=False, pilaster=(0.55, 0.06), sills=False, belts=belts, cornice=(0.3, 0.12), cornice_mat="trim", reveal=0.2)
    outer, holes = building_shell(mb, site, spec, lod, rng)
    roof = top - 0.9 if lod == 0 else top
    terr = Terrain(site["terrain"])
    # The entrance tower on the Ralph McGill Boulevard (south) wall: a
    # brick shaft with a strip of windows between piers, two setbacks.
    E = max(edges(outer, False), key=lambda E: E[4][1] + E[2] / 400)
    a, b, L, t, n = E
    tw, td = 9.0, 7.0
    c = (a[0] + t[0] * L / 2 + n[0] * (1.5 - td / 2), a[1] + t[1] * L / 2 + n[1] * (1.5 - td / 2))
    g = terr(a[0] + t[0] * L / 2 + n[0] * 2, a[1] + t[1] * L / 2 + n[1] * 2)
    ytop = g + TFL_TOWER
    ring = rect(c, t, tw, td)
    tspec = dict(spec, parapet=0.5, floor=fh, bay=3.0, ww=1.6, belts=[], pilaster=(0.7, 0.25), pier_mat="brick_buff", cornice=(0.3, 0.15), min_wall=3)
    tl = min(lod, 1)
    facade(mb, flat_site(ring, site["base"], ytop - 3.0, site["terrain"]), tspec, terr, tl, rng, ring, False, 0.0)
    roof_poly(mb, [ring], ytop - 3.0, "trim")
    prism(mb, rect(c, t, tw - 2.0, td - 1.6), ytop - 3.0, ytop - 1.2, "brick_buff")
    prism(mb, rect(c, t, tw - 4.0, td - 3.2), ytop - 1.2, ytop, "trim")
    for want in ((10, -5), (25, 10), (-5, -20)):
        q = free_spot(outer, holes, want, 5, [(c[0], c[1], 10)], rng)
        if q:
            mb.box((q[0], roof, q[1]), (3, 1.8, 2.4), 0.72, "mech", skip=("-y",))
    if lod < 2:
        # A green metal canopy over the trail-side entry.
        tx, tz = site["trail"]["dir"]
        e = max(edges(outer, False), key=lambda E: E[4][0] * tx + E[4][1] * tz + E[2] / 400)
        a, b, L, t, n = e
        u = L / 2
        cx, cz = a[0] + t[0] * u + n[0] * 1.2, a[1] + t[1] * u + n[1] * 1.2
        y = terr(cx, cz) + 3.0
        mb.box((cx, y, cz), (4.0, 0.18, 2.4), math.atan2(n[0], n[1]), "steel_green", skip=())
    return mb


def studioplex(site, lod):
    rng = random.Random(1907)
    mb = MB()
    top = site["top"]
    gf = 3.6
    ycor = top - 0.6
    upper = lambda li, i, nb, store: store or (i % 3 == 1)
    spec = dict(wall="brick_studio", pier_mat="concrete", parapet=0.6, floor=ycor - gf, bay=5.2, ww=2.4, wh=1.5, sill=1.0, min_pier=0.45,
                cells=["studio_upper"], store=True, store_cells=["studio_store", "studio_store", "studio_screen", "garage"], store_w=4.3, store_head=0.45,
                pilaster=(0.6, 0.16), sills=False, belts=[(gf - 0.5, gf, 0.16, "concrete")], cornice=(0.4, 0.16), cornice_mat="concrete", parapet_mat="concrete",
                rule=upper, reveal=0.15)
    # Cut at the bound itself: the claimed footprint keeps its full collider,
    # so a cut inside the bound would leave an invisible wall.
    zmax = SITES["bounds"]["maxZ"] - site["origin"][2]
    outer, holes = building_shell(mb, site, spec, lod, rng, drop=0.5, zmax=zmax)
    roof = top - 0.5 if lod == 0 else top
    terr = Terrain(site["terrain"])
    # The entry canopy on the Auburn Avenue (north) wall, with fictional
    # letters on top.
    e = min(edges(outer, False), key=lambda E: E[4][1] - E[2] / 1000)
    a, b, L, t, n = e
    u = L / 2
    wx, wz = a[0] + t[0] * u, a[1] + t[1] * u
    cx, cz = wx + n[0] * 4.0, wz + n[1] * 4.0
    g = terr(cx, cz)
    yaw = math.atan2(n[0], n[1])
    cw, cd = 14.0, 8.0
    y_c = max(g + 7.2, top + 0.3)
    mb.box((cx, y_c, cz), (cw, 0.25, cd), yaw, "steel", skip=())
    if lod == 0:
        for k in range(-3, 4):
            off = k * cw / 7
            p0 = (cx + t[0] * off - n[0] * cd / 2, y_c - 0.35, cz + t[1] * off - n[1] * cd / 2)
            p1 = (cx + t[0] * off + n[0] * cd / 2, y_c - 0.35, cz + t[1] * off + n[1] * cd / 2)
            mb.beam(p0, p1, 0.18, "steel", caps=False, d=0.35)
    for s in (-1, 1):
        px, pz = cx + t[0] * s * cw * 0.38 + n[0] * cd * 0.3, cz + t[1] * s * cw * 0.38 + n[1] * cd * 0.3
        mb.beam((px, g - 0.3, pz), (px - n[0] * 1.2, y_c, pz - n[1] * 1.2), 0.3, "steel")
        mb.beam((px + t[0] * s * 0.6, g - 0.3, pz + t[1] * s * 0.6), (px - n[0] * 1.2 + t[0] * s * 0.6, y_c, pz - n[1] * 1.2 + t[1] * s * 0.6), 0.25, "steel")
        mb.box((px, g - 0.3, pz), (1.0, 0.8, 1.0), yaw, "concrete", skip=("-y",))
    mb.beam((cx + t[0] * -cw * 0.35, y_c + 0.25, cz + t[1] * -cw * 0.35), (cx + t[0] * cw * 0.35, y_c + 0.25, cz + t[1] * cw * 0.35), 0.12, "steel")
    mb.text("STUDIO YARDS", (cx, y_c + 0.3, cz), n, 1.8, cw * 0.72, "letters_white" if False else "steel", extrude=0.12 if lod == 0 else 0.0, res=2 if lod == 0 else 1)
    for want in ((10, 40), (-15, -30), (12, -50), (-10, 60)):
        q = free_spot(outer, holes, want, 4, [], rng)
        if q:
            mb.box((q[0], roof, q[1]), (3.2, 1.6, 2.2), 0, "mech", skip=("-y",))
    return mb


def new_realm(site, lod):
    rng = random.Random(2016)
    mb = MB()
    top = site["top"]
    spec = dict(wall="brick_realm", pier_mat="steel", parapet=1.0, floor=3.7, bay=4.4, ww=3.4, wh=2.4, sill=0.7, min_pier=0.4,
                cells=["realm_upper", "realm_upper_b"], store=True, store_cells=["realm_store"], store_w=3.9, store_head=0.4,
                pilaster=(0.35, 0.12), sills=False, belts=[(top - 1.0 - 3.7 * k - 0.35, top - 1.0 - 3.7 * k, 0.12, "steel") for k in (1, 2)],
                cornice=(0.45, 0.16), cornice_mat="steel", parapet_mat="brick_realm", reveal=0.2)
    outer, holes = building_shell(mb, site, spec, lod, rng)
    roof = top - 0.9 if lod == 0 else top
    tx, tz = site["trail"]["dir"]
    inner = offset_ring(outer, 0.35, False)
    # The roof deck toward the trail: a rail on the parapet, a pergola, and
    # fictional letters on a low frame at the trail-side edge.
    if lod == 0:
        for a, b, L, t, n in edges(inner, False):
            k = max(1, int(L / 2.0))
            for i in range(k + 1):
                u = L * i / k
                p = (a[0] + t[0] * u, a[1] + t[1] * u)
                mb.beam((p[0], top, p[1]), (p[0], top + 0.55, p[1]), 0.05, "steel", caps=False)
            mb.beam((a[0], top + 0.55, a[1]), (b[0], top + 0.55, b[1]), 0.06, "steel")
    pc = (tx * 2.5, tz * 2.5)
    yaw = math.atan2(tx, tz)
    cs, sn = math.cos(yaw), math.sin(yaw)
    R = lambda x, z: (pc[0] + x * cs + z * sn, pc[1] - x * sn + z * cs)
    for x in (-6, -2, 2, 6):
        for z in (-3, 3):
            p = R(x, z)
            mb.beam((p[0], roof, p[1]), (p[0], roof + 3.2, p[1]), 0.2, "wood", caps=lod == 0)
    for z in (-3, 3):
        mb.beam((*R(-6.5, z)[:1], roof + 3.3, R(-6.5, z)[1]), (R(6.5, z)[0], roof + 3.3, R(6.5, z)[1]), 0.22, "wood")
    if lod == 0:
        for x in [-6 + 0.8 * k for k in range(16)]:
            mb.beam((R(x, -3.6)[0], roof + 3.5, R(x, -3.6)[1]), (R(x, 3.6)[0], roof + 3.5, R(x, 3.6)[1]), 0.08, "wood", caps=False, d=0.2)
    sp = (tx * 11.5, tz * 11.5)
    if not inside(outer, *sp):
        sp = (tx * 9, tz * 9)
    sign_frame(mb, (sp[0], 0, sp[1]), (tx, tz), 12.0, roof, 1.8, 0.8, "BREW HALL", "letters", 0 if lod == 0 else 1, depth=1.2)
    q = free_spot(outer, holes, (-tx * 8, -tz * 8), 3, [], rng)
    if q:
        mb.box((q[0], roof, q[1]), (4, 2.0, 2.6), yaw, "mech", skip=("-y",))
        bulkhead(mb, q[0] + 5 * cs, q[1] - 5 * sn, 4.5, 4.0, 3.4, roof, yaw, lod, "brick_realm")
    return mb


# ---------- bridges -------------------------------------------------------------
def bridges(site, lod):
    mb = MB()
    terr = Terrain(site["terrain"])
    road = site["style"] == "road"

    def on_other(me, x, z):
        # True where (x, z) is on another deck of the group (the parallel
        # carriageways and the sidewalk bridges overlap at their inner edges).
        for o in site["decks"]:
            if o is me:
                continue
            if dist_ring([(p[0], p[2]) for p in o["points"]], x, z, closed=False) < o["width"] / 2 + 0.3:
                return True
        return False

    for dk in site["decks"]:
        # Structure points every 3 m (6 m on LOD1): the deck line is smooth.
        k = 3 if lod == 0 else 6
        pts = dk["points"][::k] + ([dk["points"][-1]] if (len(dk["points"]) - 1) % k else [])
        w = dk["width"]
        trail_rail = dk["highway"] in ("cycleway", "footway") or not road
        n = len(pts)
        frames = []
        for i in range(n):
            a = pts[max(0, i - 1)]
            b = pts[min(n - 1, i + 1)]
            dx, dz = b[0] - a[0], b[2] - a[2]
            l = math.hypot(dx, dz) or 1
            frames.append(((dx / l, dz / l), (-dz / l, dx / l)))
        s = [0.0]
        for i in range(1, n):
            s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]))
        O = lambda i, off, dy: (pts[i][0] + frames[i][1][0] * off, pts[i][1] + dy, pts[i][2] + frames[i][1][1] * off)
        depth = 1.9 if road else 1.7
        fmat = "concrete" if road else "steel_green"
        for k in (1, -1):
            o = k * (w / 2 + 0.05)
            free = [not on_other(dk, *[(O(i, o, 0)[0] + O(i + 1, o, 0)[0]) / 2, (O(i, o, 0)[2] + O(i + 1, o, 0)[2]) / 2]) for i in range(n - 1)]
            for i in range(n - 1):
                if not free[i]:
                    continue
                q = [O(i, o, -0.15), O(i + 1, o, -0.15), O(i + 1, o, -depth), O(i, o, -depth)]
                nn = (frames[i][1][0] * k, 0, frames[i][1][1] * k)
                tt = tile_of(fmat)
                mb.poly(q, [(s[i] / tt, 0), (s[i + 1] / tt, 0), (s[i + 1] / tt, -depth / tt), (s[i] / tt, -depth / tt)], fmat, nn)
                inner = o - k * (0.55 if not road else 0.4)
                q = [O(i, o, -depth), O(i + 1, o, -depth), O(i + 1, inner, -depth), O(i, inner, -depth)]
                mb.poly(q, [(s[i] / tt, 0), (s[i + 1] / tt, 0), (s[i + 1] / tt, 0.2), (s[i] / tt, 0.2)], fmat, (0, -1, 0))
                q = [O(i, inner, -depth), O(i + 1, inner, -depth), O(i + 1, inner, -0.9), O(i, inner, -0.9)]
                mb.poly(q, [(s[i] / tt, 0), (s[i + 1] / tt, 0), (s[i + 1] / tt, 0.3), (s[i] / tt, 0.3)], fmat, (-nn[0], 0, -nn[2]))
            if lod == 0 and not road:
                # Web stiffeners on the plate girders.
                acc = 0.0
                for i in range(1, n):
                    if s[i] - acc >= 2.4 and free[min(i, n - 2)]:
                        acc = s[i]
                        p0 = O(i, o + k * 0.06, -depth + 0.1)
                        p1 = O(i, o + k * 0.06, -0.25)
                        mb.beam(p0, p1, 0.14, "steel_green", caps=False, d=0.12)
            # Railing on the parapet line (the game draws a 1 m parapet).
            ro = k * (w / 2 - 0.125)
            post = 2.5 if trail_rail else 3.0
            acc = -1e9
            hgt = 1.95 if trail_rail else 1.42
            for i in range(n):
                if (s[i] - acc >= post or i == n - 1) and free[min(i, n - 2)]:
                    acc = s[i]
                    if lod == 0 or int(s[i] / post) % 2 == 0:
                        mb.beam(O(i, ro, 1.0), O(i, ro, hgt), 0.08, "galv", caps=lod == 0)
            for i in range(n - 1):
                if not free[i]:
                    continue
                mb.beam(O(i, ro, hgt - 0.03), O(i + 1, ro, hgt - 0.03), 0.07, "galv", caps=False)
                if trail_rail and lod == 0:
                    q = [O(i, ro, 1.02), O(i + 1, ro, 1.02), O(i + 1, ro, hgt - 0.06), O(i, ro, hgt - 0.06)]
                    mb.poly(q, [(s[i] / 0.5, 0), (s[i + 1] / 0.5, 0), (s[i + 1] / 0.5, (hgt - 1.08) / 0.5), (s[i] / 0.5, (hgt - 1.08) / 0.5)], "fence", (frames[i][1][0] * k, 0, frames[i][1][1] * k))
        if road:
            for off in np.linspace(-w / 2 + 1.6, w / 2 - 1.6, 4):
                for i in range(n - 1):
                    for side in (-0.3, 0.3):
                        q = [O(i, off + side, -0.9), O(i + 1, off + side, -0.9), O(i + 1, off + side, -2.0), O(i, off + side, -2.0)]
                        mb.quad_auto(q, "concrete", (frames[i][1][0] * side, 0, frames[i][1][1] * side))
                    q = [O(i, off - 0.3, -2.0), O(i + 1, off - 0.3, -2.0), O(i + 1, off + 0.3, -2.0), O(i, off + 0.3, -2.0)]
                    mb.quad_auto(q, "concrete", (0, -1, 0))
            for i in range(n - 1):
                q = [O(i, -w / 2, -0.9), O(i + 1, -w / 2, -0.9), O(i + 1, w / 2, -0.9), O(i, w / 2, -0.9)]
                mb.quad_auto(q, "concrete", (0, -1, 0))
        # Abutments at the span ends and bents where there is clearance.
        for i in (0, n - 1):
            (tx, tz), _ = frames[i]
            g = min(pts[i][3], terr(pts[i][0], pts[i][2]))
            top_y = pts[i][1] - (2.1 if road else 1.75)
            if top_y - g > 0.4:
                mb.box((pts[i][0], g - 1.0, pts[i][2]), (w + 1.6, top_y - g + 1.0, 1.4), math.atan2(tx, tz) + math.pi / 2, "concrete", skip=("-y",))
        step = 16.0 if road else 14.0
        acc = 0.0
        for i in range(1, n - 1):
            if s[i] - acc < step or s[-1] - s[i] < step * 0.6:
                continue
            g = pts[i][3]
            cap_top = pts[i][1] - (2.0 if road else 1.7)
            if cap_top - g < 3.0:
                continue
            acc = s[i]
            (tx, tz), (nx, nz) = frames[i]
            yaw = math.atan2(tx, tz) + math.pi / 2
            mb.box((pts[i][0], cap_top - 1.0, pts[i][2]), (w + 1.2, 1.0, 1.3), yaw, "concrete", skip=())
            cols = 3 if road and w > 8 else 2
            for c in np.linspace(-w / 2 + 1.0, w / 2 - 1.0, cols):
                cx, cz = pts[i][0] + nx * c, pts[i][2] + nz * c
                if road:
                    mb.ring_band((cx, 0, cz), 0.5, 0.5, g - 0.5, cap_top - 1.0, 12 if lod == 0 else 6, "concrete")
                else:
                    mb.box((cx, g - 0.5, cz), (0.8, cap_top - 1.0 - g + 0.5, 0.8), yaw, "concrete", skip=("-y", "+y"))
    return mb


BUILDERS = {
    "ponce-city-market": (pcm, "buildings", 3),
    "telephone-factory-lofts": (telephone, "buildings", 2),
    "studioplex": (studioplex, "buildings", 2),
    "new-realm-brewing": (new_realm, "buildings", 2),
    "bridge-north-ave": (bridges, "bridges", 2),
    "bridge-ralph-mcgill": (bridges, "bridges", 2),
    "bridge-ponce": (bridges, "bridges", 2),
    "bridge-freedom-parkway": (bridges, "bridges", 2),
}

# Sourced storeys and heights (docs/landmarks.md has the full list).
FACTS = {
    "ponce-city-market": {"stories": 9, "source": "https://npgallery.nps.gov/NRHP/GetAsset/NRHP/16000769_text",
                          "note": "NRHP registration form 16000769, section 7: nine stories plus basement in every section of the main building; central tower with windows on each floor holding the water tank, pyramidal roof; shaped parapets on the end blocks. Tower stage heights above the roof are estimated from the photo references. The one-story shipping room is a separate footprint (heights.json w619595557)."},
    "telephone-factory-lofts": {"stories": 4, "towerHeight_m": 23.0, "source": "https://en.wikipedia.org/wiki/Telephone_Factory_Lofts",
                                "note": "Four-story main building, single-story warehouse section, 75 ft (23 m) Art Deco entrance tower. Height override in levels/beltline-eastside/heights.json (w185605331): 17.8 m."},
}
LOD_DIST = {"ponce-city-market": [0, 110, 320]}
# Buildings split into an n x n grid of sections, each its own LOD (from its
# own center): a 180 m building otherwise shows LOD0 from anywhere near it.
SECTIONS = {"ponce-city-market": 2}


def split_sections(mb, site, n):
    xs = [p[0] for p in site["outer"]]
    zs = [p[1] for p in site["outer"]]
    x0, z0 = min(xs), min(zs)
    cw, cd = (max(xs) - x0) / n, (max(zs) - z0) / n
    cells = {}
    for f in mb.f:
        if f[4] is not None:
            kx, kz = f[4]
        else:
            kx = sum(mb.v[i][0] for i in f[0]) / len(f[0])
            kz = sum(mb.v[i][2] for i in f[0]) / len(f[0])
        i = min(n - 1, max(0, int((kx - x0) / cw)))
        j = min(n - 1, max(0, int((kz - z0) / cd)))
        cells.setdefault(j * n + i, []).append(f)
    out = {}
    for k in range(n * n):
        cx, cz = x0 + (k % n + 0.5) * cw, z0 + (k // n + 0.5) * cd
        sm = MB()
        for f in cells.get(k, []):
            i0 = len(sm.v)
            sm.v.extend((mb.v[i][0] - cx, mb.v[i][1], mb.v[i][2] - cz) for i in f[0])
            sm.f.append((list(range(i0, i0 + len(f[0]))), f[1], f[2], f[3], None))
        out[k] = ((cx, cz), sm)
    return out

C = "https://commons.wikimedia.org/wiki/File:"
REFS = {
    "ponce-city-market": [("Ponce City Market from Historic Fourth Ward Park", "Tyler Lahti", "CC BY-SA 2.0", C + "Ponce_City_Market_from_Historic_Fourth_Ward_Park.jpg"),
                          ("Ponce city market from afar", "James Willamor", "CC BY-SA 2.0", C + "Ponce_city_market_from_afar.jpg"),
                          ("Ponce City Market", "Tyler Lahti", "CC BY-SA 4.0", C + "Ponce_City_Market.jpg")],
    "telephone-factory-lofts": [("Western Electric Company Building atlanta", "Keizers", "CC BY-SA 3.0", C + "Western_Electric_Company_Building_atlanta.JPG")],
    "studioplex": [("Studioplex o4w atlanta", "Keizers", "CC BY-SA 3.0", C + "Studioplex_o4w_atlanta.JPG")],
    "new-realm-brewing": [],
    "bridge-freedom-parkway": [("Gathering space beneath Freedom Parkway along the Atlanta BeltLine Eastside Trail", "Marc Merlin", "CC BY-SA 4.0", C + "Gathering_space_beneath_Freedom_Parkway_along_the_Atlanta_BeltLine_Eastside_Trail.jpg")],
    "bridge-north-ave": [], "bridge-ralph-mcgill": [("Western Electric Company Building atlanta (the trail bridge fence in the foreground)", "Keizers", "CC BY-SA 3.0", C + "Western_Electric_Company_Building_atlanta.JPG")],
    "bridge-ponce": [],
}
SIGNS = {"ponce-city-market": "CITY MARKET (generic; the real rooftop letters are not copied)", "studioplex": "STUDIO YARDS (fictional)", "new-realm-brewing": "BREW HALL (generic)"}


def provenance(key, group, site, entry):
    src = {"level": SITES["level"], "attribution": SITES["attribution"], "sites": "assets/landmarks/sites.json (scripts/assets/landmark-sites.mjs)"}
    if group == "buildings":
        src.update({"footprint": f"OpenStreetMap {site['osm']} ({len(site['outer'])} points, {len(site['holes'])} holes)", "height_m": site["height"], "heightSource": site["heightSource"],
                    "ground_m": site["origin"][1], "wallBase_m": round(site["origin"][1] + site["base"], 2), "top_m": round(site["origin"][1] + site["top"], 2)})
    else:
        src.update({"decks": [f"OpenStreetMap {d['osm']} {d['highway']} {d['width']} m" for d in site["decks"]], "deckHeights": "terrain.js bridgeDeck() on the OSM span"})
    return {
        "asset": f"{key}.glb: procedural facsimile of {site.get('name') or site.get('title')} for the beltline-eastside level, one node per LOD ({', '.join(entry['triangles'])})" + (f" in each of {entry['sections']} sections (<key>_s<i>_lod<n>, each node at its section center)" if entry["sections"] > 1 else "") + ", shared materials and tiling textures.",
        "date": TODAY,
        "tool": f"Blender {bpy.app.version_string}, headless (blender -b -P), glTF 2.0 exporter with Draco",
        "command": f"blender -b -P scripts/blender/landmarks.py -- --only {key}",
        "source": "scripts/blender/landmarks.py: footprint walls with bays of recessed windows, piers, belts, cornice, parapet, roof, and props, all from code. No photo pixels, scans of the real building, mesh extraction, or logos.",
        "prompt": "None. The script and sites.json are the full recipe.",
        "credits": "No paid generation credits (Meshy not used).",
        "textures": "lm_brick_*, lm_trim_*: the CC0 Poly Haven scans in assets/landmarks/textures/ (see its provenance.json), recolored in code for the buff brick and concrete; lm_window_* (incl. lm_window_emit, the night glow), lm_fence_color, lm_far_pcm_*: painted in code by landmarks.py. TEXCOORD_1 u is the per-window light key.",
        "facts": FACTS.get(key),
        "references": [{"title": t, "author": a, "license": l, "url": u, "use": "Visual reference for shapes and colors only; no pixels of the photo are in the asset."} for t, a, l, u in REFS.get(key, [])],
        "sign": SIGNS.get(key),
        "data": src,
        "placement": {"position": site["origin"], "yaw": 0, "axes": "glTF axes = level axes (+x east, +y up, +z south)"},
        "lodDistance_m": entry["lodDistance"],
        "triangles": entry["triangles"],
        "bytes": entry["bytes"],
        "textureImages": entry["textures"],
        "gpuTextureBytes": entry["gpuTextureBytes"],
    }


def image_stats(objs):
    imgs = {}
    for o in objs:
        if o.data is None:
            continue
        for m in o.data.materials:
            for nd in m.node_tree.nodes:
                if nd.type == "TEX_IMAGE" and nd.image:
                    imgs[nd.image.name] = tuple(nd.image.size)
    gpu = sum(w * h * 4 * 4 / 3 for (w, h) in imgs.values())
    return imgs, gpu


def main():
    M = setup_materials()
    pfh = (SITES["buildings"]["ponce-city-market"]["top"] - 1.8) / PCM_FLOORS
    far, far_e = far_facade(4.0, pfh, 2.9, pfh * 0.66, pfh * 0.17)
    M["far"] = material("lm_far_pcm", far, roughness=0.8, emit_map=far_e)
    TILE["far"] = 1.0
    keys = ONLY.split(",") if ONLY else list(BUILDERS)
    summary = {}
    for key in keys:
        fn, group, nlod = BUILDERS[key]
        site = SITES[group][key]
        objs, tris = [], []
        dists = LOD_DIST.get(key) or [0, 120 if group == "bridges" else 140]
        for lod in range(nlod):
            mb = fn(site, lod)
            if key in SECTIONS:
                parts = [(f"{key}_s{k}_lod{lod}", c, sm) for k, (c, sm) in split_sections(mb, site, SECTIONS[key]).items()]
            else:
                parts = [(f"{key}_lod{lod}", None, mb)]
            nt = 0
            for name, c, sm in parts:
                if sm.f:
                    ob = to_object(name, sm, M)
                    nt += sum(len(p.vertices) - 2 for p in ob.data.polygons)
                else:
                    ob = bpy.data.objects.new(name, None)  # an empty level: nothing at this distance
                    bpy.context.scene.collection.objects.link(ob)
                if c:
                    ob.location = (c[0], -c[1], 0)
                ob["lod"] = lod
                ob["lodDistance"] = dists[lod]
                objs.append(ob)
            tris.append(nt)
        d = os.path.join(OUT, key)
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, f"{key}.glb")
        for o in bpy.context.scene.objects:
            o.select_set(o in objs)
        bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                                  export_extras=True, export_image_format="JPEG", export_image_quality=85,
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                                  export_draco_position_quantization=14, export_draco_normal_quantization=10,
                                  export_draco_texcoord_quantization=12, export_animations=False, export_cameras=False, export_lights=False)
        imgs, gpu = image_stats(objs)
        summary[key] = {"file": path, "bytes": os.path.getsize(path), "triangles": {f"lod{i}": t for i, t in enumerate(tris)},
                        "lodDistance": dists, "sections": SECTIONS.get(key, 1) ** 2, "textures": {k: f"{v[0]}x{v[1]}" for k, v in sorted(imgs.items())},
                        "gpuTextureBytes": int(gpu), "origin": site["origin"]}
        print("LANDMARK", key, json.dumps(summary[key]))
        json.dump(provenance(key, group, site, summary[key]), open(os.path.join(d, "provenance.json"), "w"), indent=2)
        for o in objs:
            o.hide_set(True)
            o.select_set(False)
    out = opt("--summary", os.path.join(OUT, "landmarks-build.json"))
    prev = json.load(open(out)) if os.path.exists(out) else {}
    prev.update(summary)
    json.dump(prev, open(out, "w"), indent=2)


main()
