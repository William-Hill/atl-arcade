"""Make the zoom levels of an isometric map (scripts/bake-iso-map.mjs).

  python3 scripts/iso-pyramid.py [level] [--preview path.jpg]

Level 0 is the bake: assets/map/<level>/0/<col>_<row>.jpg. Each next level
has half the pixels on each side: 2 x 2 tiles of the level before become one
tile. A missing tile (past the edge of the grid) is the background color.
--preview also writes the whole level 0 image, for a check of the seams.
"""

import json
import pathlib
import sys

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
# The sky color of the bake, past the edge of the grid (src/ui/fullmap.js
# ISO_BACKGROUND).
BACKGROUND = (182, 219, 242)


def main():
    args = sys.argv[1:]
    preview = None
    if "--preview" in args:
        i = args.index("--preview")
        preview = args[i + 1]
        del args[i : i + 2]
    level = args[0] if args else "beltline-eastside"
    out = ROOT / "assets" / "map" / level
    info = json.loads((out / "iso.json").read_text())
    tile = info["tile"]
    cols, rows = info["cols"], info["rows"]
    for z in range(1, info["levels"]):
        ncols, nrows = (cols + 1) // 2, (rows + 1) // 2
        (out / str(z)).mkdir(exist_ok=True)
        for r in range(nrows):
            for c in range(ncols):
                canvas = Image.new("RGB", (tile * 2, tile * 2), BACKGROUND)
                for dr in range(2):
                    for dc in range(2):
                        src = out / str(z - 1) / f"{c * 2 + dc}_{r * 2 + dr}.jpg"
                        if src.exists():
                            canvas.paste(Image.open(src).convert("RGB"), (dc * tile, dr * tile))
                canvas.resize((tile, tile), Image.LANCZOS).save(out / str(z) / f"{c}_{r}.jpg", quality=88)
        print(f"level {z}: {ncols} x {nrows} tiles")
        cols, rows = ncols, nrows
    if preview:
        whole = Image.new("RGB", (info["width"], info["height"]), BACKGROUND)
        for r in range(info["rows"]):
            for c in range(info["cols"]):
                whole.paste(Image.open(out / "0" / f"{c}_{r}.jpg"), (c * tile, r * tile))
        whole.save(preview, quality=85)
        print(f"preview: {preview}")


if __name__ == "__main__":
    main()
