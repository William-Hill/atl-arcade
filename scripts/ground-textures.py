"""Build the ground detail maps from Poly Haven CC0 scans.

  python3 scripts/ground-textures.py

For each set it downloads the 1k JPG color and AO maps from the Poly Haven
API and writes assets/ground/<id>/:

- color.jpg: the color map times the AO map, 1024 px.
- normal.jpg: the OpenGL normal map, 1024 px (the pbr look only).
- rough.jpg: the roughness map, 512 px (the pbr look only).
- set.json: the real tile size in meters, the mean linear color, the mean
  roughness, and the source and authors.

The game does not show these colors directly. The surface shader divides
the map by its mean color and multiplies the result into the art color of
each surface (src/render/geo-view.js), so the palette stays and the ground
gets the real asphalt, slab, and grass detail.
"""

import io
import json
import pathlib
import urllib.request

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "ground"
SIZE = 1024

# Set id -> Poly Haven asset. src/render/geo-view.js maps each surface kind
# to a set.
# Clean scans only: no cracks or patches (the game shows each neighborhood
# at its best).
SETS = {
    "asphalt": "asphalt_track",
    "concrete": "brushed_concrete_03",
    "trail": "concrete_floor_03",
    "grass": "leafy_grass",
}


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "atl-arcade-ground-textures"})
    with urllib.request.urlopen(req) as r:
        return r.read()


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def main():
    credits = []
    for set_id, asset in SETS.items():
        info = json.loads(fetch(f"https://api.polyhaven.com/info/{asset}"))
        files = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
        diff_url = files["Diffuse"]["1k"]["jpg"]["url"]
        ao_url = files["AO"]["1k"]["jpg"]["url"] if "AO" in files else None
        diff = Image.open(io.BytesIO(fetch(diff_url))).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        d = np.asarray(diff, dtype=np.float64) / 255
        if ao_url:
            ao = Image.open(io.BytesIO(fetch(ao_url))).convert("L").resize((SIZE, SIZE), Image.LANCZOS)
            d = d * (np.asarray(ao, dtype=np.float64)[..., None] / 255)
        out = OUT / set_id
        out.mkdir(parents=True, exist_ok=True)
        Image.fromarray((np.clip(d, 0, 1) * 255 + 0.5).astype(np.uint8)).save(out / "color.jpg", quality=85)
        nor_url = files["nor_gl"]["1k"]["jpg"]["url"]
        rough_url = files["Rough"]["1k"]["jpg"]["url"]
        nor = Image.open(io.BytesIO(fetch(nor_url))).convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        nor.save(out / "normal.jpg", quality=90)
        rough = Image.open(io.BytesIO(fetch(rough_url))).convert("L").resize((SIZE // 2, SIZE // 2), Image.LANCZOS)
        rough.save(out / "rough.jpg", quality=85)
        rough_mean = float(np.asarray(rough, dtype=np.float64).mean() / 255)
        mean = srgb_to_linear(d).reshape(-1, 3).mean(axis=0)
        dims = info.get("dimensions") or [2000, 2000]
        meta = {
            "setId": set_id,
            "asset": asset,
            "source": f"https://polyhaven.com/a/{asset}",
            "authors": info.get("authors"),
            "license": "CC0 1.0",
            "tileMeters": round(dims[0] / 1000, 3),
            "meanLinear": [round(float(x), 4) for x in mean],
            "roughMean": round(rough_mean, 4),
            "files": {"diffuse": diff_url, "ao": ao_url, "nor": nor_url, "rough": rough_url},
        }
        (out / "set.json").write_text(json.dumps(meta, indent=2) + "\n")
        credits.append({"set": set_id, "asset": asset, "authors": info.get("authors"), "url": meta["source"]})
        print(f"{set_id}: {asset}, tile {meta['tileMeters']} m, mean {meta['meanLinear']}")
    prov = {
        "tool": "scripts/ground-textures.py (Poly Haven API download, AO multiply, resize; color, normal, and roughness maps)",
        "prompt": None,
        "license": "CC0 1.0",
        "credits": credits,
        "note": "Scanned photo textures, not generated art.",
    }
    (OUT / "provenance.json").write_text(json.dumps(prov, indent=2) + "\n")


if __name__ == "__main__":
    main()
