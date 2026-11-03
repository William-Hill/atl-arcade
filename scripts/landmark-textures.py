"""Build the landmark texture sets from Poly Haven CC0 scans.

  python3 scripts/landmark-textures.py

For each set it downloads the 1k JPG maps (color, OpenGL normal, roughness,
ambient occlusion) from the Poly Haven API, then writes 512 px maps to
assets/landmarks/textures/<id>/:

- color.jpg: the color map times the AO map, so the mortar and the rib
  grooves stay dark with no extra texture.
- normal.jpg and rough.jpg: resized only.
- set.json: the real tile size in meters (from Poly Haven), the mean color,
  and the tint that moves the mean color to the spec base color.

The tint is baked into color.jpg, so a part keeps the color of its
img2threejs spec (the color gate) and gets the detail of the scan.
"""

import io
import json
import pathlib
import urllib.request

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "landmarks" / "textures"
SIZE = 512

# Material id in src/render/landmark-materials.js -> Poly Haven asset and the
# spec base color (landmarks/*/object-sculpt-spec.json).
SETS = {
    "brick": ("red_brick", "#7E3B33"),
    "trim": ("beige_wall_001", "#DCD6CA"),
    "metal": ("corrugated_iron", "#B9BEC3"),
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "atl-arcade-landmark-textures"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def srgb_to_linear(c):
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i : i + 2], 16) / 255 for i in (0, 2, 4)])


def main():
    for mat_id, (asset, base) in SETS.items():
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}"))
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
        maps = {}
        for key, name in (("Diffuse", "diff"), ("nor_gl", "nor"), ("Rough", "rough"), ("AO", "ao")):
            url = files[key]["1k"]["jpg"]["url"]
            maps[name] = (Image.open(io.BytesIO(fetch(url))), url)
        out = OUT / mat_id
        out.mkdir(parents=True, exist_ok=True)
        diff = maps["diff"][0].convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        ao = maps["ao"][0].convert("L").resize((SIZE, SIZE), Image.LANCZOS)
        d = np.asarray(diff, dtype=np.float64) / 255
        a = np.asarray(ao, dtype=np.float64)[..., None] / 255
        color = np.clip(d * a, 0, 1)
        # Move the mean color to the spec base color (in linear space, as the
        # renderer mixes light), and bake that tint into color.jpg.
        lin = srgb_to_linear(color)
        mean = lin.reshape(-1, 3).mean(axis=0)
        target = srgb_to_linear(hex_rgb(base))
        tint = target / mean
        lin = np.clip(lin * tint, 0, 1)
        srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
        Image.fromarray((srgb * 255 + 0.5).astype(np.uint8)).save(out / "color.jpg", quality=86)
        clipped = float((lin >= 1).any(axis=-1).mean())
        maps["nor"][0].convert("RGB").resize((SIZE, SIZE), Image.LANCZOS).save(out / "normal.jpg", quality=90)
        maps["rough"][0].convert("L").resize((SIZE, SIZE), Image.LANCZOS).save(out / "rough.jpg", quality=88)
        dims = info.get("dimensions") or [1000, 1000]
        meta = {
            "materialId": mat_id,
            "source": f"https://polyhaven.com/a/{asset}",
            "asset": asset,
            "authors": info.get("authors"),
            "license": "CC0 1.0",
            "tileMeters": round(dims[0] / 1000, 3),
            "meanLinear": [round(float(x), 4) for x in mean],
            "targetHex": base,
            "tintLinear": [round(float(x), 4) for x in tint],
            "clippedPixels": round(clipped, 4),
            "files": {k: v[1] for k, v in maps.items()},
        }
        (out / "set.json").write_text(json.dumps(meta, indent=2) + "\n")
        print(f"{mat_id}: {asset}, tile {meta['tileMeters']} m, tint {meta['tintLinear']}, clipped {clipped:.2%}")


if __name__ == "__main__":
    main()
