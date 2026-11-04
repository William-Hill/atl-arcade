"""Fetch the City of Atlanta tree canopy for a level box (issue #137).

  python3 scripts/city-canopy.py levels/beltline-eastside/ [--refresh]

It reads the box from <level>/raw/fetch.json and the origin and bounds from
<level>/level.json. It gets the tiles of the City of Atlanta "Urban Tree
Canopy 2018 Raster Image" (zoom 16, about 2 m per pixel on the ground) that
cover the box, and keeps them in <level>/raw/canopy-tiles/. A later run reads
the kept tiles, so the script runs offline. Use --refresh to get them again.

The output is <level>/canopy.json: a grid of CELL meters in level
coordinates (+x east, +z south). Each cell is 1 when the raster shows tree
canopy at the cell center. The cells are packed as a bit mask in base64,
row-major from (x0, z0), bit i in byte i // 8 at bit i % 8.
src/level/geo/tree-placement.js reads the grid and puts trees on it.

The raster is a JPEG tile cache: canopy is green (about 0, 100, 0), and the
rest is black. JPEG noise gives small values, so a pixel is canopy only
when green is over GREEN_MIN and over red and blue by GREEN_LEAD.

Needs Pillow (the same as scripts/ground-textures.py).

Data: City of Atlanta, Department of City Planning GIS, Urban Tree Canopy
2018 (produced by Georgia Tech with the Department of City Planning).
No license is stated. See docs/sources.md.
"""

import base64
import datetime
import io
import json
import math
import pathlib
import sys
import urllib.request

from PIL import Image

SERVICE = "https://tiles.arcgis.com/tiles/5RxyIIJ9boPdptdo/arcgis/rest/services/Urban_Tree_Canopy_2018_WTL1/MapServer"
CATALOG_ID = "dpcd-9215c7539c5d4d13bdaf4d4627b020e5-4"
LANDING = "https://dpcd-coaplangis.opendata.arcgis.com/maps/coaplangis::urban-tree-canopy-2018-raster-image"
ZOOM = 16  # the deepest level of the tile cache (2.39 m per mercator pixel)
CELL = 2.0  # m
GREEN_MIN = 60
GREEN_LEAD = 30
EARTH_RADIUS = 6371008.8  # m, the same sphere as src/level/geo/projection.js
USER_AGENT = "atl-arcade/0.1 (Skate ATL level build; https://github.com/William-Hill/atl-arcade)"


def tile_xy(lat, lon, zoom):
    """Returns the global pixel position (x, y) at a zoom (web mercator)."""
    n = 256 * 2**zoom
    x = (lon + 180.0) / 360.0 * n
    r = math.radians(lat)
    y = (1.0 - math.log(math.tan(r) + 1.0 / math.cos(r)) / math.pi) / 2.0 * n
    return x, y


def get_tile(tiles_dir, row, col, refresh):
    path = tiles_dir / f"{ZOOM}-{row}-{col}.jpg"
    if path.exists() and not refresh:
        return Image.open(path).convert("RGB")
    url = f"{SERVICE}/tile/{ZOOM}/{row}/{col}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        data = res.read()
    path.write_bytes(data)
    return Image.open(io.BytesIO(data)).convert("RGB")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    refresh = "--refresh" in sys.argv
    if len(args) != 1:
        print("usage: python3 scripts/city-canopy.py levels/<name>/ [--refresh]", file=sys.stderr)
        sys.exit(2)
    level_dir = pathlib.Path(args[0])
    fetch = json.loads((level_dir / "raw" / "fetch.json").read_text())
    level = json.loads((level_dir / "level.json").read_text())
    box = fetch["bbox"]
    lat0 = level["origin"]["lat"]
    lon0 = level["origin"]["lon"]
    bounds = level["bounds"]
    m_lat = EARTH_RADIUS * math.pi / 180
    m_lon = m_lat * math.cos(math.radians(lat0))

    tiles_dir = level_dir / "raw" / "canopy-tiles"
    tiles_dir.mkdir(parents=True, exist_ok=True)
    x_min, y_min = tile_xy(box["north"], box["west"], ZOOM)
    x_max, y_max = tile_xy(box["south"], box["east"], ZOOM)
    cols_t = range(int(x_min // 256), int(x_max // 256) + 1)
    rows_t = range(int(y_min // 256), int(y_max // 256) + 1)
    tiles = {}
    for row in rows_t:
        for col in cols_t:
            tiles[(row, col)] = get_tile(tiles_dir, row, col, refresh)

    x0 = bounds["minX"]
    z0 = bounds["minZ"]
    cols = int(math.ceil((bounds["maxX"] - x0) / CELL))
    rows = int(math.ceil((bounds["maxZ"] - z0) / CELL))
    bits = bytearray((cols * rows + 7) // 8)
    count = 0
    for r in range(rows):
        z = z0 + (r + 0.5) * CELL
        lat = lat0 - z / m_lat
        for c in range(cols):
            x = x0 + (c + 0.5) * CELL
            lon = lon0 + x / m_lon
            px, py = tile_xy(lat, lon, ZOOM)
            tile = tiles.get((int(py // 256), int(px // 256)))
            if tile is None:
                continue
            red, green, blue = tile.getpixel((int(px) % 256, int(py) % 256))
            if green > GREEN_MIN and green > red + GREEN_LEAD and green > blue + GREEN_LEAD:
                i = r * cols + c
                bits[i >> 3] |= 1 << (i & 7)
                count += 1

    out = {
        "source": "City of Atlanta, Department of City Planning GIS, Urban Tree Canopy 2018 Raster Image",
        "catalog": CATALOG_ID,
        "service": SERVICE,
        "landingPage": LANDING,
        "license": "No license is stated. Cite City of Atlanta - Department of City Planning GIS.",
        "attribution": "Tree canopy: City of Atlanta Department of City Planning (Urban Tree Canopy 2018)",
        "zoom": ZOOM,
        "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "cell": CELL,
        "x0": x0,
        "z0": z0,
        "cols": cols,
        "rows": rows,
        "canopyCells": count,
        "units": "bit mask, 1 = tree canopy at the cell center, row-major from (x0, z0), bit i in byte i>>3 at bit i&7",
        "data": base64.b64encode(bytes(bits)).decode("ascii"),
    }
    (level_dir / "canopy.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"{len(tiles)} tiles, {cols} x {rows} cells, {count} canopy cells ({100 * count / (cols * rows):.1f} %)")


if __name__ == "__main__":
    main()
