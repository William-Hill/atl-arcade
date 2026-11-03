"""Paints the face decals for Nia: eye states and mouth states.

The face is painted on the base-color texture, and the mesh has no eyelids
or lips to move. This script bakes a front view of the face from the mesh
UVs and the texture, then paints new eye and mouth states on copies of it.
src/render/skater-face.js projects the decals onto the bind-pose mesh.

    python3 scripts/art/nia_face_decals.py <nodraco.glb> <basecolor.jpg> <out-dir>

Inputs (not in git): assets/skaters/nia/raw/nia-nodraco.glb, and the base
color image of assets/skaters/nia/skater.glb. Needs numpy, Pillow, opencv.
The rectangles must match FACE_DECALS in src/render/skater-face.js.
"""

import json
import struct
import sys

import cv2
import numpy as np
from PIL import Image

PPM = 4000  # bake pixels per meter
OUT_SCALE = 0.5  # the decals ship at 2000 px/m, near the texel density of the 2048 base color

# Bake window in glTF bind-pose space (meters): x right, y up, the face looks to +z.
X0, X1, Y0, Y1 = -0.1, 0.1, 1.33, 1.51
EYES = (-0.075, 0.075, 1.432, 1.486)  # x0, x1, y0, y1
MOUTH = (-0.05, 0.046, 1.362, 1.405)
EDGE = 14  # px at 4000 px/m: the decal alpha fades to 0 at the rectangle edge

LASH = (22, 14, 14)
MOUTH_IN = (58, 18, 22)
TEETH = (236, 228, 214)
TONGUE = (150, 60, 62)


def read_glb(path):
    d = open(path, "rb").read()
    n = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20 : 20 + n])
    b0 = 20 + n + 8

    def acc(i):
        a = j["accessors"][i]
        bv = j["bufferViews"][a["bufferView"]]
        k = {"VEC3": 3, "VEC2": 2, "SCALAR": 1, "VEC4": 4}[a["type"]]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a["componentType"]]
        off = b0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        arr = np.frombuffer(d, dt, a["count"] * k, off)
        return arr.reshape(-1, k) if k > 1 else arr

    pr = j["meshes"][0]["primitives"][0]
    return acc(pr["attributes"]["POSITION"]), acc(pr["attributes"]["TEXCOORD_0"]), acc(pr["indices"]).reshape(-1, 3)


def bake(glb, tex):
    """Front orthographic bake of the head: the nearest surface wins."""
    P, UV, I = read_glb(glb)
    T = np.asarray(Image.open(tex).convert("RGB"))
    th, tw = T.shape[:2]
    W, H = round((X1 - X0) * PPM), round((Y1 - Y0) * PPM)
    img = np.zeros((H, W, 3), np.uint8)
    zb = np.full((H, W), -9.0)
    for t in I:
        a, b, c = P[t]
        if max(a[1], b[1], c[1]) < Y0 or min(a[1], b[1], c[1]) > Y1 or min(a[2], b[2], c[2]) < 0:
            continue
        pts = [((v[0] - X0) * PPM, (Y1 - v[1]) * PPM) for v in (a, b, c)]
        (ax, ay), (bx, by), (cx, cy) = pts
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        xs0, xs1 = max(0, int(min(ax, bx, cx))), min(W - 1, int(max(ax, bx, cx)) + 1)
        ys0, ys1 = max(0, int(min(ay, by, cy))), min(H - 1, int(max(ay, by, cy)) + 1)
        if xs0 > xs1 or ys0 > ys1:
            continue
        gx, gy = np.meshgrid(np.arange(xs0, xs1 + 1) + 0.5, np.arange(ys0, ys1 + 1) + 0.5)
        l1 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l2 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        l3 = 1 - l1 - l2
        inside = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
        z = l1 * a[2] + l2 * b[2] + l3 * c[2]
        sub = zb[ys0 : ys1 + 1, xs0 : xs1 + 1]
        win = inside & (z > sub)
        if not win.any():
            continue
        u = l1 * UV[t[0], 0] + l2 * UV[t[1], 0] + l3 * UV[t[2], 0]
        v = l1 * UV[t[0], 1] + l2 * UV[t[1], 1] + l3 * UV[t[2], 1]
        ti = np.clip((v * th).astype(int), 0, th - 1)
        tj = np.clip((u * tw).astype(int), 0, tw - 1)
        sub[win] = z[win]
        img[ys0 : ys1 + 1, xs0 : xs1 + 1][win] = T[ti[win], tj[win]]
    return img


def rect_px(r):
    x0, x1, y0, y1 = r
    return round((x0 - X0) * PPM), round((x1 - X0) * PPM), round((Y1 - y1) * PPM), round((Y1 - y0) * PPM)


def ring_skin(crop, mask, width=10):
    """The median color in a ring around the mask: the local skin tone."""
    k = np.ones((width * 2 + 1, width * 2 + 1), np.uint8)
    ring = (cv2.dilate(mask, k) > 0) & (mask == 0)
    return np.median(crop[ring].reshape(-1, 3), 0)


def feature_mask(crop, region, thresh=34):
    """Pixels in the region that are not skin: eye whites, irises, lashes, lips."""
    skin = ring_skin(crop, region)
    lab = cv2.cvtColor(crop, cv2.COLOR_RGB2LAB).astype(np.float32)
    ref = cv2.cvtColor(np.uint8([[skin]]), cv2.COLOR_RGB2LAB)[0, 0].astype(np.float32)
    dist = np.linalg.norm((lab - ref) * np.array([0.5, 1.0, 1.0]), axis=2)
    m = ((dist > thresh) & (region > 0)).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    n, lab_img, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 300:
            hull = cv2.convexHull(np.argwhere(lab_img == i)[:, ::-1].astype(np.int32))
            cv2.fillConvexPoly(keep, hull, 1)
    return keep


def skin_fill(crop, mask, grow=5, shade=1.0):
    """Paints skin over the mask. The fill comes from the ring around it."""
    m = cv2.dilate(mask, np.ones((grow * 2 + 1, grow * 2 + 1), np.uint8))
    out = cv2.inpaint(crop, m * 255, 25, cv2.INPAINT_TELEA).astype(np.float32)
    out = cv2.GaussianBlur(out, (0, 0), 7) * shade
    # Feather the edge of the fill into the original skin.
    a = cv2.GaussianBlur(m.astype(np.float32), (0, 0), grow * 0.6)[..., None]
    a = np.clip(a * 1.6, 0, 1)
    out = np.clip(out * a + crop * (1 - a), 0, 255).astype(np.uint8)
    return out, m


def arc(x0, x1, y_mid, bend, n=40):
    """Points of a parabola from x0 to x1. bend > 0 bends down at the middle."""
    xs = np.linspace(x0, x1, n)
    u = (xs - (x0 + x1) / 2) / ((x1 - x0) / 2)
    ys = y_mid + bend * (1 - u * u)
    return np.stack([xs, ys], 1)


def poly(img, pts, color, thick):
    cv2.polylines(img, [np.round(pts * 8).astype(np.int32)], False, color, thick, cv2.LINE_AA, shift=3)


# Eye regions in the eye crop (pixels at 4000 px/m): center x, center y, half width, half height.
EYE_REGIONS = [(110, 112, 104, 70), (478, 114, 118, 72)]


def eye_states(crop):
    h, w = crop.shape[:2]
    states = {"open": (crop.copy(), np.zeros((h, w), np.uint8))}
    closed, happy, half = crop.copy(), crop.copy(), crop.copy()
    lid_alpha = np.zeros((h, w), np.uint8)
    half_alpha = np.zeros((h, w), np.uint8)
    for i, (cx, cy, rx, ry) in enumerate(EYE_REGIONS):
        region = np.zeros((h, w), np.uint8)
        cv2.ellipse(region, (cx, cy), (rx, ry), 0, 0, 360, 1, -1)
        mask = feature_mask(crop, region)
        ys, xs = np.nonzero(mask)
        x, y, bw, bh = xs.min(), ys.min(), xs.max() - xs.min(), ys.max() - ys.min()
        # The lid is a little darker than the cheek.
        filled, grown = skin_fill(crop, mask, grow=10, shade=0.97)
        outer_left = cx < w / 2  # the outer corner of the left eye is on the left
        x0, x1 = x + 0.05 * bw, x + 0.95 * bw
        # Closed: a relaxed lid line that bends down, with a lash flick at the outer corner.
        sel = grown > 0
        closed[sel] = filled[sel]
        line = arc(x0, x1, y + 0.50 * bh, 0.18 * bh)
        poly(closed, line, LASH, 10)
        tip = line[0] if outer_left else line[-1]
        poly(closed, np.array([tip, tip + [(-1 if outer_left else 1) * 0.09 * bw, -0.12 * bh]]), LASH, 7)
        # Happy: the lid line bends up.
        happy[sel] = filled[sel]
        poly(happy, arc(x0, x1, y + 0.62 * bh, -0.32 * bh), LASH, 11)
        lid_alpha |= cv2.dilate(grown, np.ones((9, 9), np.uint8))
        # Half: lid over the upper half of the eye, with the lash line on the cut.
        cut = y + 0.50 * bh
        sel_half = sel & (np.arange(h)[:, None] < cut + 2)
        half[sel_half] = filled[sel_half]
        cut_line = arc(x0, x1, cut, 0.06 * bh)
        poly(half, cut_line, LASH, 11)
        half_alpha |= sel_half.astype(np.uint8)
        cv2.polylines(half_alpha, [np.round(cut_line * 8).astype(np.int32)], False, 1, 16, shift=3)
    states["half"] = (half, cv2.dilate(half_alpha, np.ones((5, 5), np.uint8)))
    states["closed"] = (closed, lid_alpha)
    states["happy"] = (happy, lid_alpha)
    return states


def warp(img, dy):
    """Moves pixels up by dy (an array, pixels): out[y, x] = img[y + dy, x]."""
    h, w = img.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img, gx, gy + dy.astype(np.float32), cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def mouth_states(crop):
    h, w = crop.shape[:2]
    region = np.zeros((h, w), np.uint8)
    cv2.ellipse(region, (w // 2, h // 2), (143, 50), 0, 0, 360, 1, -1)
    mask = feature_mask(crop, region, thresh=22)
    ys, xs = np.nonzero(mask)
    x0, x1 = xs.min(), xs.max()
    cx, half_w = (x0 + x1) / 2, (x1 - x0) / 2
    # The lip line: the darkest row of each column in the middle of the lips.
    lum = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY).astype(np.float32)
    cols = np.arange(int(cx - 0.6 * half_w), int(cx + 0.6 * half_w))
    y_lo, y_hi = int(ys.min() + 0.25 * (ys.max() - ys.min())), int(ys.max() - 0.2 * (ys.max() - ys.min()))
    line_y = float(np.median([y_lo + np.argmin(lum[y_lo:y_hi, c]) for c in cols]))
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    u = np.clip((gx - cx) / half_w, -1.3, 1.3)
    fall = np.exp(-(((gy - line_y) / (0.55 * half_w)) ** 2))
    states = {"neutral": (crop.copy(), np.zeros((h, w), np.uint8))}

    # Smile: lift the corners and keep the middle.
    lift = 0.16 * half_w * u * u * fall
    smile = warp(crop, lift)
    lips_zone = cv2.dilate(mask, np.ones((25, 25), np.uint8))
    states["smile"] = (smile, lips_zone)

    # Open: the smile, then the lower lip and the chin move down. The gap is
    # the mouth, with the top teeth and the tongue.
    lift2 = 0.15 * half_w * u * u * fall
    curve = line_y - 0.15 * half_w * u * u  # the lip line after the lift
    gap = 0.5 * half_w * np.clip(1 - (u / 0.92) ** 2, 0, 1) ** 0.8
    below = np.clip((gy - curve + 2) / 4, 0, 1)
    jaw = gap * below * np.exp(-np.clip(gy - curve - gap, 0, None) / (0.7 * half_w))
    opened = warp(crop, lift2 - jaw)
    inside = (gy > curve) & (gy < curve + gap) & (gap > 1)
    mouth = np.zeros((h, w, 3), np.float32) + MOUTH_IN
    teeth_h = 0.32 * gap
    mouth[(gy - curve) < teeth_h] = TEETH
    tongue = (gy - curve) > gap * (0.62 + 0.18 * u * u)
    mouth[tongue] = TONGUE
    # Soft edge between the lips and the mouth.
    edge = np.clip(np.minimum(gy - curve, curve + gap - gy) / 2.5, 0, 1)[..., None] * inside[..., None]
    opened = (opened * (1 - edge) + mouth * edge).astype(np.uint8)
    states["open"] = (opened, (cv2.dilate(mask, np.ones((25, 25), np.uint8)) | (np.abs(lift2 - jaw) > 0.6) | inside).astype(np.uint8))
    return states


def edge_fade(h, w):
    """1 inside, 0 at the rectangle edge, so that no seam shows."""
    y = np.minimum(np.arange(h), np.arange(h)[::-1])[:, None]
    x = np.minimum(np.arange(w), np.arange(w)[::-1])[None, :]
    return np.clip(np.minimum(x, y) / EDGE, 0, 1)


def atlas(states, order):
    cells = []
    for name in order:
        rgb, alpha = states[name]
        a = cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), 3.0)
        a *= edge_fade(*a.shape)
        rgba = np.dstack([rgb, np.clip(a * 255, 0, 255).astype(np.uint8)])
        h, w = rgba.shape[:2]
        cells.append(cv2.resize(rgba, (round(w * OUT_SCALE), round(h * OUT_SCALE)), interpolation=cv2.INTER_AREA))
    return np.hstack(cells)


def main():
    glb, tex, out = sys.argv[1:4]
    face = bake(glb, tex)
    Image.fromarray(face).save(f"{out}/face-bake.png")
    ex0, ex1, ey0, ey1 = rect_px(EYES)
    mx0, mx1, my0, my1 = rect_px(MOUTH)
    eyes = eye_states(face[ey0:ey1, ex0:ex1].copy())
    mouth = mouth_states(face[my0:my1, mx0:mx1].copy())
    Image.fromarray(atlas(eyes, ["open", "half", "closed", "happy"])).save(f"{out}/eyes.png", optimize=True)
    Image.fromarray(atlas(mouth, ["neutral", "smile", "open"])).save(f"{out}/mouth.png", optimize=True)
    # A preview of every eye and mouth state on the bake, for review.
    rows = []
    for e in ["open", "half", "closed", "happy"]:
        for m in ["neutral", "smile", "open"]:
            f = face.copy()
            for (rgb, alpha), (x0, x1, y0, y1) in (((eyes[e]), (ex0, ex1, ey0, ey1)), ((mouth[m]), (mx0, mx1, my0, my1))):
                a = (cv2.GaussianBlur(alpha.astype(np.float32), (0, 0), 3.0) * edge_fade(*alpha.shape))[..., None]
                f[y0:y1, x0:x1] = (rgb * a + f[y0:y1, x0:x1] * (1 - a)).astype(np.uint8)
            rows.append(cv2.resize(f, (f.shape[1] // 2, f.shape[0] // 2), interpolation=cv2.INTER_AREA))
    grid = np.vstack([np.hstack(rows[i * 3 : i * 3 + 3]) for i in range(4)])
    Image.fromarray(grid).save(f"{out}/preview.png")
    print("eyes", eyes["open"][0].shape, "mouth", mouth["neutral"][0].shape)


if __name__ == "__main__":
    main()
