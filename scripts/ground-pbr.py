"""Build the full PBR ground sets (#158) from Poly Haven CC0 scans.

  python3 scripts/ground-pbr.py [--ktx2 PATH/TO/toktx] [surface ...]

Needs numpy and Pillow (pip install numpy pillow). The KTX2 step needs
toktx and ktx from KTX-Software 4.3 (https://github.com/KhronosGroup/KTX-Software);
without them the script writes the JPG sets only.

For each surface the skater rides on (sidewalk concrete, brick, asphalt,
the BeltLine trail) it downloads 2 to 4 candidate scans (2k JPG: diffuse,
AO, OpenGL normal, roughness), scores each one for light baked into the
albedo, edge seams, and large blotches that read as a repeat, and keeps the
best one. Then it writes assets/textures/ground-pbr/<surface>/:

- albedo_<tier>.jpg: sRGB base color with the light taken out (below),
  scaled so its mean is the pbr palette color of the surface.
- normal_<tier>.jpg: the OpenGL (+Y) normal map, 4:4:4 JPG.
- orm_<tier>.jpg: R ambient occlusion, G roughness, B metalness (0), 4:4:4.
- *.ktx2: the same maps in KTX2 (Basis UASTC + zstd, sRGB albedo, linear
  normal and ORM), with mipmaps.
- set.json: tile size in meters, mean linear color, mean roughness, the
  candidate scores and the choice, file sizes and quality numbers.
- provenance.json: tool, sources, authors, license, settings, date.

Tiers: high 1024 px, phone 512 px.

De-lighting. A scan photographed outdoors keeps some of its light: a
gradient across the tile, the AO shadow in the joints, and a side light
that brightens the faces toward the sun. The pbr look lights the ground
itself (sun + sky), so the albedo must not carry any of that:
1. Divide out the large-scale luminance (a wrap-around Gaussian blur of 1/6
   tile), which removes gradients and vignettes but keeps the pattern of the
   stones.
2. Fit the high-pass log luminance to the log AO (L ~ AO^k) and divide AO^k
   out; the AO comes back as the R channel of ORM, where the renderer applies
   it to the sky light only.
3. Fit the high-pass luminance to the normal slope (nx, ny) and remove that
   part: a surface lit from one side is brighter where it tilts toward the
   light.
"""

import io
import json
import pathlib
import shutil
import subprocess
import sys
import urllib.request
from datetime import date

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "textures" / "ground-pbr"
CACHE = pathlib.Path.home() / ".cache" / "atl-arcade-ground-pbr"
TIERS = {"high": 1024, "phone": 512}
WORK = 1024

# The pbr palette, linear RGB: the art color of the surface kind
# (src/level/geo/geo-mesh.js SURFACE_COLORS) times the pbr albedo factor of
# its ground set (src/render/look.js GROUND_ALBEDO on main). Brick has no
# surface kind yet; it takes the brick-warehouse wall color of the facade
# shader (src/level/geo/styles.js), so a brick plaza matches the brick walls.
SURFACES = {
    "sidewalk": {
        "flatten": (0.5, 2.5),
        "kind": "sidewalk",
        "palette": [0.74 * 1.0, 0.74 * 1.0, 0.77 * 0.98],
        "candidates": ["brushed_concrete_03", "concrete_pavement", "concrete_pavement_03", "concrete_floor_worn_02"],
    },
    "brick": {
        "flatten": (0.85, 2.5),
        "kind": None,
        "palette": [0.62, 0.305, 0.235],
        "candidates": ["red_brick_pavers", "herringbone_brick", "brick_pavement_02", "square_brick_paving"],
    },
    "asphalt": {
        "flatten": (0.4, 3.0),
        # clean_asphalt has the least baked light but almost no aggregate (detail 0.16 vs 0.45 for asphalt_track); the de-light takes out the shadow asphalt_track has baked in.
        "minDetail": 0.3,
        "kind": "street",
        "palette": [0.34 * 0.62, 0.35 * 0.62, 0.44 * 0.54],
        # Not asphalt_track (its light wear stripes repeat every tile in a 3 x 3
        # view) nor asphalt_02 (long cracks: no decline on the streets).
        "candidates": ["clean_asphalt", "asphalt_pit_lane"],
    },
    "trail": {
        "flatten": (0.4, 2.5),
        "kind": "trail",
        "palette": [0.97 * 0.85, 0.8 * 0.85, 0.48 * 0.85],
        "candidates": ["concrete_floor_03", "concrete_floor", "anti_slip_concrete"],
    },
}


def fetch(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / url.replace("https://", "").replace("/", "_")
    if not f.exists():
        req = urllib.request.Request(url, headers={"User-Agent": "atl-arcade-ground-pbr"})
        with urllib.request.urlopen(req) as r:
            f.write_bytes(r.read())
    return f.read_bytes()


def load(url, size, mode="RGB"):
    img = Image.open(io.BytesIO(fetch(url))).convert(mode).resize((size, size), Image.LANCZOS)
    return np.asarray(img, dtype=np.float64) / 255


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def blur(a, sigma):
    """Wrap-around Gaussian blur (FFT), so a tile blurs into its neighbors."""
    n = a.shape[0]
    f = np.fft.fftfreq(n)
    g = np.exp(-2 * (np.pi * sigma) ** 2 * (f[:, None] ** 2 + f[None, :] ** 2))
    if a.ndim == 2:
        return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([blur(a[..., c], sigma) for c in range(a.shape[2])], axis=-1)


def luma(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722])


def corr(a, b):
    a = a - a.mean()
    b = b - b.mean()
    d = np.sqrt((a * a).sum() * (b * b).sum())
    return float((a * b).sum() / d) if d > 0 else 0.0


def seam_ratio(a):
    """Mean step across the wrap edges over the mean step inside the tile (1 = seamless)."""
    inner = (np.abs(np.diff(a, axis=0)).mean() + np.abs(np.diff(a, axis=1)).mean()) / 2
    edge = (np.abs(a[0] - a[-1]).mean() + np.abs(a[:, 0] - a[:, -1]).mean()) / 2
    return float(edge / inner)


def measure(lin, ao, nor):
    """Baked-light and repeat scores of a linear albedo (lower is better)."""
    L = np.log(np.maximum(luma(lin), 1e-4))
    low = blur(L, WORK / 6)
    hp = L - blur(L, WORK / 32)
    nx, ny = nor[..., 0] - 0.5, nor[..., 1] - 0.5
    return {
        # Gradient or vignette across the tile: std of the log luminance at 1/6 tile.
        "gradient": float(low.std()),
        # Blotches a few per tile that read as a repeat at skating height: std at 1/32 tile, minus the gradient.
        "blotch": float(np.sqrt(max(blur(L, WORK / 32).var() - low.var(), 0))),
        # Shadow baked in the joints: correlation of high-pass luminance with high-pass log AO.
        "aoCorr": corr(hp, np.log(np.maximum(ao, 1e-3)) - blur(np.log(np.maximum(ao, 1e-3)), WORK / 32)) if ao is not None else 0.0,
        # Side light: how much of the high-pass luminance the normal slope explains.
        "sideLight": float(np.hypot(corr(hp, nx), corr(hp, ny))),
        "seam": seam_ratio(lin),
        # Fine detail (grain, joints): std of the high-pass log luminance. A scan
        # with too little reads as flat paint at skating height.
        "detail": float(hp.std()),
    }


def score(m, min_detail=0.0):
    return max(min_detail - m["detail"], 0) * 8 + m["gradient"] * 4 + m["blotch"] * 2 + max(m["aoCorr"], 0) * 0.5 + m["sideLight"] + max(m["seam"] - 1.2, 0)


def flatten(albedo, k, clamp_sigma):
    """Anti-repeat: a tile repeats where it has features that the eye picks
    out (a patch of light bricks, a bright scratch, a dark stain). Scale the
    mid band of the log luminance (1/48 to 1/6 tile) by 1 - k, and squash
    high-pass outliers past clamp_sigma (tanh), so the detail stays but no
    single spot stands out. The color ratio stays."""
    L = np.log(np.maximum(luma(albedo), 1e-4))
    mid = blur(L, WORK / 48)
    band = mid - blur(L, WORK / 6)
    hp = L - mid
    c = hp.std() * clamp_sigma
    L2 = L - k * band - (hp - c * np.tanh(hp / c))
    return np.clip(albedo * np.exp(L2 - L)[..., None], 0, 1)


def fit_remove(hp, x):
    """Least-squares fit of hp to the columns of x; returns the fitted part and the coefficients."""
    X = np.stack([c.ravel() - c.mean() for c in x], axis=1)
    k, *_ = np.linalg.lstsq(X, hp.ravel() - hp.mean(), rcond=None)
    return (X @ k).reshape(hp.shape), k


def delight(lin, ao, nor):
    L = np.log(np.maximum(luma(lin), 1e-4))
    steps = {}
    # 1. Large-scale luminance out.
    low = blur(L, WORK / 6)
    L1 = L - (low - low.mean())
    # 2 and 3. High-pass luminance against log AO and the normal slope.
    hp = L1 - blur(L1, WORK / 32)
    cols = [nor[..., 0] - 0.5, nor[..., 1] - 0.5]
    if ao is not None:
        cols.append(np.log(np.maximum(ao, 1e-3)))
    fit, k = fit_remove(hp, cols)
    # Only the AO term with a positive sign is baked shadow.
    if ao is not None and k[2] < 0:
        fit, k2 = fit_remove(hp, cols[:2])
        k = np.array([*k2, 0.0])
    L2 = L1 - fit
    steps = {"gradientRemoved": float(low.std()), "slopeK": [round(float(v), 4) for v in k[:2]], "aoK": round(float(k[2]), 4) if ao is not None else None}
    gain = np.exp(L2 - L)[..., None]
    return np.clip(lin * gain, 0, 1), steps


def make_seamless(a, ratio):
    """Cross-fade the half-offset copy over the edges if the scan has a seam."""
    if ratio < 1.3:
        return a, False
    n = a.shape[0]
    sh = np.roll(np.roll(a, n // 2, 0), n // 2, 1)
    t = np.abs(np.linspace(-1, 1, n))
    w = np.clip((np.maximum(t[:, None], t[None, :]) - 0.8) / 0.2, 0, 1)
    if a.ndim == 3:
        w = w[..., None]
    return a * (1 - w) + sh * w, True


def save_jpg(path, arr, q=90):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path, quality=q, subsampling=0)


def resize(arr, size):
    img = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    return np.asarray(img.resize((size, size), Image.LANCZOS), dtype=np.float64) / 255


def psnr(a, b):
    mse = ((a - b) ** 2).mean()
    return round(float(10 * np.log10(1 / mse)), 2) if mse > 0 else 99.0


def ktx2(toktx, src, dst, kind, size):
    # `ktx create` (not legacy toktx: its ETC1S output fails `ktx validate`).
    ktx = pathlib.Path(toktx).with_name("ktx")
    png = dst.with_suffix(".in.png")
    Image.open(src).convert("RGB").save(png)
    if kind == "albedo":
        # UASTC, not ETC1S: ETC1S lost the brick joints (25.7 dB at 1024 px).
        args = ["--format", "R8G8B8_SRGB", "--assign-oetf", "srgb", "--encode", "uastc", "--uastc-quality", "2",
                "--uastc-rdo", "--uastc-rdo-l", "1.0", "--zstd", "19"]
    else:
        args = ["--format", "R8G8B8_UNORM", "--assign-oetf", "linear", "--encode", "uastc", "--uastc-quality", "2",
                "--uastc-rdo", "--uastc-rdo-l", "0.5", "--zstd", "19"]
    subprocess.run([str(ktx), "create", "--generate-mipmap", *args, str(png), str(dst)], check=True, capture_output=True)
    subprocess.run([str(ktx), "validate", str(dst)], check=True, capture_output=True)
    png.unlink()
    # Decode level 0 back to RGBA8 for the quality check.
    chk = dst.with_suffix(".check.png")
    subprocess.run([str(ktx), "extract", "--transcode", "rgba8", str(dst), str(chk)], check=True, capture_output=True)
    out = np.asarray(Image.open(chk).convert("RGB"), dtype=np.float64) / 255
    chk.unlink()
    return out


def build(surface, cfg, toktx):
    cands = []
    for asset in cfg["candidates"]:
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}"))
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
        res = "2k" if "2k" in files["Diffuse"] else "1k"
        urls = {
            "diffuse": files["Diffuse"][res]["jpg"]["url"],
            "ao": files["AO"][res]["jpg"]["url"] if "AO" in files else None,
            "nor": files["nor_gl"][res]["jpg"]["url"],
            "rough": files["Rough"][res]["jpg"]["url"],
        }
        lin = srgb_to_linear(load(urls["diffuse"], WORK))
        ao = load(urls["ao"], WORK, "L") if urls["ao"] else None
        nor = load(urls["nor"], WORK)
        m = measure(lin, ao, nor)
        m = {k: round(v, 4) for k, v in m.items()}
        cands.append({"asset": asset, "info": info, "urls": urls, "res": res, "lin": lin, "ao": ao, "nor": nor, "metrics": m, "score": round(score(m, cfg.get("minDetail", 0.0)), 4)})
        print(f"  {surface} candidate {asset}: score {score(m, cfg.get('minDetail', 0.0)):.3f} {m}")
    best = min(cands, key=lambda c: c["score"])
    lin, ao, nor = best["lin"], best["ao"], best["nor"]
    rough = load(best["urls"]["rough"], WORK, "L")
    albedo, steps = delight(lin, ao, nor)
    albedo = flatten(albedo, *cfg["flatten"])
    steps["flatten"] = {"midBandScale": round(1 - cfg["flatten"][0], 3), "clampSigma": cfg["flatten"][1]}
    # The same seam fix on every map, so they stay aligned.
    seam = seam_ratio(albedo)
    albedo, fixed = make_seamless(albedo, seam)
    if fixed:
        nor = make_seamless(nor, 2)[0]
        rough = make_seamless(rough, 2)[0]
        ao = make_seamless(ao, 2)[0] if ao is not None else None
    # Palette: scale each channel so the mean linear color is the pbr palette color.
    albedo = np.clip(albedo * (np.array(cfg["palette"]) / albedo.reshape(-1, 3).mean(axis=0)), 0, 1)
    after = {k: round(v, 4) for k, v in measure(albedo, ao, nor).items()}
    orm = np.stack([ao if ao is not None else np.ones_like(rough), rough, np.zeros_like(rough)], axis=-1)
    nor_n = nor * 2 - 1
    nor_n /= np.linalg.norm(nor_n, axis=-1, keepdims=True)
    nor = nor_n * 0.5 + 0.5

    out = OUT / surface
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    maps = {"albedo": linear_to_srgb(albedo), "normal": nor, "orm": orm}
    files, quality = {}, {}
    for tier, size in TIERS.items():
        for name, arr in maps.items():
            a = arr if size == WORK else resize(arr, size)
            p = out / f"{name}_{tier}.jpg"
            save_jpg(p, a, 90)
            files[p.name] = p.stat().st_size
            if toktx:
                k = out / f"{name}_{tier}.ktx2"
                dec = ktx2(toktx, p, k, name, size)
                ref = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64) / 255
                files[k.name] = k.stat().st_size
                q = {"psnr": psnr(ref, dec)}
                if name == "normal":
                    v0 = ref * 2 - 1
                    v1 = dec * 2 - 1
                    v0 /= np.linalg.norm(v0, axis=-1, keepdims=True)
                    v1 /= np.linalg.norm(v1, axis=-1, keepdims=True)
                    q["meanAngleDeg"] = round(float(np.degrees(np.arccos(np.clip((v0 * v1).sum(-1), -1, 1))).mean()), 3)
                quality[k.name] = q

    dims = best["info"].get("dimensions") or [2000, 2000]
    mean = albedo.reshape(-1, 3).mean(axis=0)
    meta = {
        "setId": surface,
        "surfaceKind": cfg["kind"],
        "asset": best["asset"],
        "source": f"https://polyhaven.com/a/{best['asset']}",
        "authors": best["info"].get("authors"),
        "license": "CC0 1.0",
        "tileMeters": round(dims[0] / 1000, 3),
        "meanLinear": [round(float(x), 4) for x in mean],
        "palette": [round(x, 4) for x in cfg["palette"]],
        "roughMean": round(float(rough.mean()), 4),
        "aoMean": round(float(ao.mean()), 4) if ao is not None else 1.0,
        "tiers": TIERS,
        "maps": {"albedo": "sRGB base color, light removed", "normal": "OpenGL (+Y) tangent normal, u along world x, v along world z", "orm": "R ambient occlusion, G roughness, B metalness (0)"},
        "delight": steps,
        "seamFix": fixed,
        "metricsAfter": after,
        "candidates": [{"asset": c["asset"], "score": c["score"], "metrics": c["metrics"], "chosen": c is best} for c in cands],
        "files": files,
        "ktx2Quality": quality,
    }
    (out / "set.json").write_text(json.dumps(meta, indent=2) + "\n")
    prov = {
        "tool": "scripts/ground-pbr.py (Poly Haven API download; candidate scoring; de-light; palette scale; ORM pack; Pillow resize; ktx create 4.3 KTX2)",
        "prompt": None,
        "date": date.today().isoformat(),
        "license": "CC0 1.0",
        "credits": [{"asset": best["asset"], "authors": best["info"].get("authors"), "url": meta["source"], "files": best["urls"], "resolution": best["res"]}],
        "candidates": [c["asset"] for c in cands],
        "settings": {"work": WORK, "tiers": TIERS, "jpgQuality": 90, "jpgSubsampling": "4:4:4", "ktx2": {"albedo": "UASTC q2 rdo 1.0 zstd 19 sRGB", "normal/orm": "UASTC q2 rdo 0.5 zstd 19 linear"}, "palette": cfg["palette"], "flatten": cfg["flatten"]},
        "paidCredits": 0,
        "note": "Scanned photo textures (CC0), processed; not generated art.",
    }
    (out / "provenance.json").write_text(json.dumps(prov, indent=2) + "\n")
    print(f"{surface}: {best['asset']} tile {meta['tileMeters']} m mean {meta['meanLinear']} seamFix {fixed} after {after}")


def main():
    args = sys.argv[1:]
    toktx = None
    if "--ktx2" in args:
        i = args.index("--ktx2")
        toktx = args[i + 1]
        del args[i : i + 2]
    else:
        toktx = shutil.which("toktx")
    for surface, cfg in SURFACES.items():
        if args and surface not in args:
            continue
        build(surface, cfg, toktx)


if __name__ == "__main__":
    main()
