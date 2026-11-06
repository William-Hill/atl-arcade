"""Build the pbr ground texture sets (#158) from Poly Haven CC0 scans.

  python3 -I scripts/ground-textures-pbr.py [--cache DIR] [--pick set=asset ...]

The pbr look grounds five sets: asphalt (street), concrete (sidewalk),
trail (the BeltLine), grass (lawn and park), and brick (the paving-stone
footways). Each set has an albedo, an OpenGL normal map, and a packed ORM
map (R ambient occlusion, G roughness, B metalness).

Method (the issue, after the article "How to make pro-level PBR textures
from a single reference"):

1. Each set has 2 to 4 CC0 candidates, top-down scans with even light.
2. Each candidate gets three scores (scores() below):
   - light: the low-frequency light left in the albedo. The luminance is
     blurred over 1/8 of the tile (wrapped, so the edges count), and the
     score is its spread over its mean. Baked sun, cloud shadow, or a
     vignette gives a high score.
   - shadow: the correlation of the albedo luminance with the AO map. A
     scan with shadows baked into the albedo follows its own AO.
   - seam: the color step across the tile edge over the mean step between
     two neighbor pixels inside. 1 is seamless.
3. A candidate with light > 0.06, or seam > 1.6, is rejected. The pick is
   the one with the lowest light + shadow among the rest (or --pick).
4. The pick is delit: the albedo is divided by its wrapped low-pass
   luminance (over its mean), so no large light patch is left and the tile
   repeat does not show from skating height. The normal and ORM maps come
   from the same scan, at the same size and the same orientation, so they
   stay aligned to the albedo.

Output, assets/ground/pbr/:
- albedo-1024.webp, normal-1024.webp, orm-512.webp: the high tier.
- albedo-512.webp, orm-512.webp: the phone and low tiers (no normal map).
- sets.json: the layer order, tile size, mean linear albedo, mean roughness
  and AO, the scores of every candidate, and the bytes and GPU memory.
Each strip holds one layer per set, top to bottom in the order of SETS,
and each layer is stored upside down, so a WebGL2 texture array with
flipY off reads it the same way as the 2D maps with flipY on.

assets/ground/<set>/provenance.json gets the tool, the source, the
authors, the license, and the date for each set.
assets/ground/pbr/provenance.json gets the source, the authors, and the
license of each layer of the strips.
"""

import argparse
import datetime
import io
import json
import pathlib
import time
import urllib.request

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ground" / "pbr"
SRC = 1024
# Layer size per map and tier. The ORM map holds slow detail (AO and
# roughness), so the high tier keeps it at 512 px to stay under 2 MB.
TIERS = {"high": {"albedo": 1024, "normal": 1024, "orm": 512}, "small": {"albedo": 512, "orm": 512}}
QUALITY = {"albedo": 65, "normal": 55, "orm": 80}

# Set id -> candidates (Poly Haven assets). Clean scans only: no cracks,
# moss, or damage (the game shows each neighborhood at its best). The
# order of SETS is the layer order; the first four match the toon GROUND
# order in src/render/geo-view.js.
SETS = {
    "asphalt": ["asphalt_track", "clean_asphalt", "asphalt_05", "asphalt_floor"],
    "concrete": ["brushed_concrete_03", "concrete_pavement", "concrete_pavement_03"],
    "trail": ["concrete_floor_03", "smooth_concrete_floor", "granular_concrete"],
    "grass": ["leafy_grass"],
    "brick": ["red_brick_pavers", "herringbone_brick", "brick_pavement_02", "herringbone_pavement"],
}
LIMITS = {"light": 0.06, "seam": 1.6}
# Rejected after a look at the contact sheet: faults the scores miss.
REVIEW = {
    "clean_asphalt": "a crack line across the tile",
    "concrete_pavement": "small pavers, not a poured sidewalk",
    "concrete_pavement_03": "a two-tone paver pattern, not a sidewalk",
    "smooth_concrete_floor": "dark cracks and stains",
}


def fetch(url, cache):
    name = cache / url.rsplit("/", 1)[-1]
    if url.startswith("https://api."):
        name = cache / (url.split("/")[-2] + "-" + url.split("/")[-1] + ".json")
    if name.exists():
        return name.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": "atl-arcade-ground-textures"})
    with urllib.request.urlopen(req) as r:
        data = r.read()
    name.write_bytes(data)
    return data


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def load(data, mode, size):
    return np.asarray(Image.open(io.BytesIO(data)).convert(mode).resize((size, size), Image.LANCZOS), dtype=np.float64) / 255


def luminance(lin):
    return lin @ np.array([0.2126, 0.7152, 0.0722])


def lowpass(lum, size):
    return gaussian_filter(lum, sigma=size / 8, mode="wrap")


def scores(lin, ao):
    lum = luminance(lin)
    low = lowpass(lum, lum.shape[0])
    light = float(low.std() / low.mean())
    shadow = float(np.corrcoef(lum.ravel(), ao.ravel())[0, 1]) if ao is not None and ao.std() > 0 else 0.0
    inner = np.mean([np.abs(np.diff(lin, axis=a)).mean() for a in (0, 1)])
    edge = (np.abs(lin[0] - lin[-1]).mean() + np.abs(lin[:, 0] - lin[:, -1]).mean()) / 2
    return {"light": round(light, 4), "shadow": round(max(shadow, 0.0), 4), "seam": round(float(edge / inner), 3)}


def candidate(asset, cache):
    info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}", cache))
    files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}", cache))
    urls = {
        "diffuse": files["Diffuse"]["1k"]["jpg"]["url"],
        "ao": files["AO"]["1k"]["jpg"]["url"] if "AO" in files else None,
        "nor": files["nor_gl"]["1k"]["jpg"]["url"],
        "rough": files["Rough"]["1k"]["jpg"]["url"],
    }
    lin = srgb_to_linear(load(fetch(urls["diffuse"], cache), "RGB", SRC))
    ao = load(fetch(urls["ao"], cache), "L", SRC) if urls["ao"] else None
    return {"asset": asset, "info": info, "urls": urls, "lin": lin, "ao": ao, "scores": scores(lin, ao)}


def pick(cands, forced):
    for c in cands:
        s = c["scores"]
        c["rejected"] = [k for k, lim in LIMITS.items() if s[k] > lim]
        if c["asset"] in REVIEW:
            c["rejected"].append("review: " + REVIEW[c["asset"]])
    if forced:
        return next(c for c in cands if c["asset"] == forced)
    ok = [c for c in cands if not c["rejected"]] or cands
    return min(ok, key=lambda c: c["scores"]["light"] + c["scores"]["shadow"])


def delight(lin):
    lum = luminance(lin)
    low = lowpass(lum, lum.shape[0])
    return np.clip(lin / (low / low.mean())[..., None], 0, 1)


def to8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def resize(arr8, size):
    mode = "L" if arr8.ndim == 2 else "RGB"
    return np.asarray(Image.fromarray(arr8, mode).resize((size, size), Image.LANCZOS))


def renormal(n8):
    # A resized normal map has short vectors: make them unit length again.
    n = n8.astype(np.float64) / 255 * 2 - 1
    n /= np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9
    return to8(n * 0.5 + 0.5)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=str(ROOT / ".cache" / "ground-pbr"), help="download cache (gitignored)")
    ap.add_argument("--pick", nargs="*", default=[])
    args = ap.parse_args()
    cache = pathlib.Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    forced = dict(p.split("=", 1) for p in args.pick)
    today = datetime.date.today().isoformat()
    started = time.time()

    layers = {m: {t: [] for t in TIERS} for m in ("albedo", "normal", "orm")}
    meta = []
    for set_id, assets in SETS.items():
        cands = [candidate(a, cache) for a in assets]
        best = pick(cands, forced.get(set_id))
        for c in cands:
            print(f"{set_id:9s} {c['asset']:24s} {c['scores']} {'REJECT ' + ','.join(c['rejected']) if c['rejected'] else ''}{' <- pick' if c is best else ''}")
        files = best["urls"]
        albedo = to8(linear_to_srgb(delight(best["lin"])))
        nor = to8(load(fetch(files["nor"], cache), "RGB", SRC))
        rough = load(fetch(files["rough"], cache), "L", SRC)
        ao = best["ao"] if best["ao"] is not None else np.ones_like(rough)
        orm = to8(np.stack([ao, rough, np.zeros_like(rough)], axis=-1))
        for tier, spec in TIERS.items():
            # Upside down: see the docstring.
            layers["albedo"][tier].append(np.flipud(resize(albedo, spec["albedo"])))
            layers["orm"][tier].append(np.flipud(resize(orm, spec["orm"])))
            if "normal" in spec:
                layers["normal"][tier].append(np.flipud(renormal(resize(nor, spec["normal"]))))
        lin = srgb_to_linear(albedo / 255)
        info = best["info"]
        dims = info.get("dimensions") or [2000, 2000]
        entry = {
            "id": set_id,
            "asset": best["asset"],
            "source": f"https://polyhaven.com/a/{best['asset']}",
            "authors": info.get("authors"),
            "license": "CC0 1.0",
            "tileMeters": round(dims[0] / 1000, 3),
            "meanLinear": [round(float(x), 4) for x in lin.reshape(-1, 3).mean(axis=0)],
            "roughMean": round(float(rough.mean()), 4),
            "aoMean": round(float(ao.mean()), 4),
            "scoresAfter": scores(lin, ao),
            "candidates": [{"asset": c["asset"], **c["scores"], "rejected": c["rejected"], "picked": c is best} for c in cands],
        }
        meta.append(entry)
        prov = {
            "tool": "scripts/ground-textures-pbr.py (Poly Haven API download, candidate scores, low-pass delight, resize, ORM pack, WebP)",
            "prompt": None,
            "source": entry["source"],
            "files": files,
            "credits": info.get("authors"),
            "license": "CC0 1.0",
            "date": today,
            "maps": "albedo, normal (OpenGL), ORM (R ambient occlusion, G roughness, B metalness 0)",
            "output": sorted({f"assets/ground/pbr/{m}-{n}.webp layer {list(SETS).index(set_id)}" for s in TIERS.values() for m, n in s.items()}),
            "candidates": entry["candidates"],
            "note": "Scanned photo textures, not generated art.",
        }
        d = ROOT / "assets" / "ground" / set_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "provenance.json").write_text(json.dumps(prov, indent=2) + "\n")

    sizes = {}
    for tier, spec in TIERS.items():
        OUT.mkdir(parents=True, exist_ok=True)
        sizes[tier] = {"files": {}, "layers": len(SETS), "bytes": {}, "gpuBytes": {}}
        for m, n in spec.items():
            # Named by size, so two tiers with the same map share one file.
            path = OUT / f"{m}-{n}.webp"
            sizes[tier]["files"][m] = path.name
            if not path.exists() or path.stat().st_mtime < started:
                strip = np.concatenate(layers[m][tier], axis=0)
                Image.fromarray(strip).save(path, quality=QUALITY[m], method=6)
            sizes[tier]["bytes"][m] = path.stat().st_size
            # RGBA8 with a full mip chain (4/3).
            sizes[tier]["gpuBytes"][m] = round(n * n * 4 * len(SETS) * 4 / 3)
        sizes[tier]["totalBytes"] = sum(sizes[tier]["bytes"].values())
        sizes[tier]["totalGpuBytes"] = sum(sizes[tier]["gpuBytes"].values())
        print(f"{tier}: {sizes[tier]['bytes']} total {sizes[tier]['totalBytes']} B, GPU {sizes[tier]['totalGpuBytes'] / 2**20:.1f} MiB")
    out = {"layers": list(SETS), "tiers": sizes, "sets": meta}
    (OUT / "sets.json").write_text(json.dumps(out, indent=2) + "\n")
    # The provenance of the strips, next to the strips: one entry per layer.
    prov = {
        "tool": "scripts/ground-textures-pbr.py (Poly Haven API download, candidate scores, low-pass delight, resize, ORM pack, WebP)",
        "prompt": None,
        "license": "CC0 1.0",
        "date": today,
        "files": sorted({f"{m}-{n}.webp" for s in TIERS.values() for m, n in s.items()}),
        "layers": [{"layer": i, "set": e["id"], "asset": e["asset"], "source": e["source"], "credits": e["authors"], "license": e["license"]} for i, e in enumerate(meta)],
        "details": "assets/ground/<set>/provenance.json (download URLs and candidate scores)",
        "note": "Scanned photo textures, not generated art.",
    }
    (OUT / "provenance.json").write_text(json.dumps(prov, indent=2) + "\n")


if __name__ == "__main__":
    main()
