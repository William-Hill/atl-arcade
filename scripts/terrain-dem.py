"""Fetch the ground elevation for a level box from USGS 3DEP.

  python3 scripts/terrain-dem.py levels/beltline-eastside/

It reads the box and the origin from <level>/raw/fetch.json and
<level>/level.json, asks the USGS 3DEP elevation service for a bare-earth
DEM of the box (about 2 m per pixel), and writes <level>/raw/terrain.json:
a grid of CELL meters in level coordinates (+x east, +z south), with the
heights in centimeters over the lowest cell, packed as little-endian int16
in base64. scripts/build-block.mjs copies the grid into level.json.

Each node is the mean of the DEM pixels within half a cell of it. There is
no blur: a blur flattens the embankments at the bridge ends.

Pure Python 3 (no numpy): the service returns an uncompressed float32 TIFF.

Data: U.S. Geological Survey, 3D Elevation Program (3DEP), public domain.
See docs/sources.md.
"""

import base64
import datetime
import json
import math
import pathlib
import struct
import sys
import urllib.parse
import urllib.request

SERVICE = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"
CELL = 8.0  # m. The bridge embankments are raised by build-block.mjs, so a
# coarse grid is enough; a 4 m grid gives 4 times the surface triangles.
PIXEL = 2.0  # m, the DEM pixel size to ask for
EARTH_RADIUS = 6371008.8  # m, the same sphere as src/level/geo/projection.js


def geo_extent(data):
    """Returns (west, north, degrees per pixel x, degrees per pixel y) from
    the GeoTIFF tags. The service can change the extent that it was asked
    for, so the script uses the extent in the file."""
    return read_tiff_f32(data, georef=True)


def read_tiff_f32(data, georef=False):
    """Returns (width, height, values) for an uncompressed float32 TIFF."""
    order = "<" if data[:2] == b"II" else ">"
    (ifd,) = struct.unpack(order + "I", data[4:8])
    (n,) = struct.unpack(order + "H", data[ifd : ifd + 2])
    tags = {}
    for i in range(n):
        e = ifd + 2 + i * 12
        tag, typ, count = struct.unpack(order + "HHI", data[e : e + 8])
        size = {3: 2, 4: 4, 12: 8}.get(typ, 0)
        fmt = {3: "H", 4: "I", 12: "d"}.get(typ, "")
        if size and count * size <= 4:
            vals = struct.unpack(order + fmt * count, data[e + 8 : e + 8 + count * size])
        elif size:
            (off,) = struct.unpack(order + "I", data[e + 8 : e + 12])
            vals = struct.unpack(order + fmt * count, data[off : off + count * size])
        else:
            vals = ()
        tags[tag] = vals
    width, height = tags[256][0], tags[257][0]
    if georef:
        sx, sy = tags[33550][0], tags[33550][1]
        tie = tags[33922]
        return tie[3] - tie[0] * sx, tie[4] + tie[1] * sy, sx, sy
    if tags.get(259, (1,))[0] != 1 or tags[258][0] != 32 or tags.get(339, (3,))[0] != 3:
        sys.exit("terrain-dem: expected an uncompressed float32 TIFF")
    if 273 in tags:
        raw = b"".join(data[o : o + c] for o, c in zip(tags[273], tags[279]))
        values = struct.unpack(order + "f" * (width * height), raw[: width * height * 4])
        return width, height, values
    # A tiled TIFF: copy each tile into its place.
    tw, th = tags[322][0], tags[323][0]
    across = (width + tw - 1) // tw
    values = [0.0] * (width * height)
    for k, (o, c) in enumerate(zip(tags[324], tags[325])):
        tile = struct.unpack(order + "f" * (tw * th), data[o : o + tw * th * 4])
        ty, tx = divmod(k, across)
        for y in range(th):
            gy = ty * th + y
            if gy >= height:
                break
            for x in range(tw):
                gx = tx * tw + x
                if gx < width:
                    values[gy * width + gx] = tile[y * tw + x]
    return width, height, values


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: python3 scripts/terrain-dem.py levels/<name>/")
    level_dir = pathlib.Path(sys.argv[1])
    box = json.loads((level_dir / "raw" / "fetch.json").read_text())["bbox"]
    level = json.loads((level_dir / "level.json").read_text())
    lat0, lon0 = level["origin"]["lat"], level["origin"]["lon"]
    m_lat = EARTH_RADIUS * math.pi / 180
    m_lon = m_lat * math.cos(lat0 * math.pi / 180)
    w = round((box["east"] - box["west"]) * m_lon / PIXEL)
    h = round((box["north"] - box["south"]) * m_lat / PIXEL)
    q = {
        "bbox": f'{box["west"]},{box["south"]},{box["east"]},{box["north"]}',
        "bboxSR": 4326,
        "imageSR": 4326,
        "size": f"{w},{h}",
        "format": "tiff",
        "pixelType": "F32",
        "noDataInterpretation": "esriNoDataMatchAny",
        "interpolation": "RSP_BilinearInterpolation",
        "f": "image",
    }
    url = SERVICE + "?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=120) as r:
        tiff = r.read()
    width, height, values = read_tiff_f32(tiff)
    west, north, sx, sy = geo_extent(tiff)

    b = level["bounds"]
    x0, z0 = b["minX"], b["minZ"]
    cols = math.ceil((b["maxX"] - x0) / CELL) + 1
    rows = math.ceil((b["maxZ"] - z0) / CELL) + 1
    total = [0.0] * (cols * rows)
    count = [0] * (cols * rows)
    for j in range(height):
        lat = north - (j + 0.5) * sy
        z = -(lat - lat0) * m_lat
        for i in range(width):
            v = values[j * width + i]
            if not (-500 < v < 9000):
                continue
            lon = west + (i + 0.5) * sx
            x = (lon - lon0) * m_lon
            # The nearest grid node: each node is the mean of the pixels
            # within half a cell.
            c = round((x - x0) / CELL)
            rr = round((z - z0) / CELL)
            if 0 <= c < cols and 0 <= rr < rows:
                total[rr * cols + c] += v
                count[rr * cols + c] += 1
    grid = [total[k] / count[k] if count[k] else None for k in range(cols * rows)]
    # Fill a node with no pixel from its neighbors (the box edge).
    for _ in range(4):
        for rr in range(rows):
            for c in range(cols):
                if grid[rr * cols + c] is None:
                    near = [grid[r2 * cols + c2] for r2 in (rr - 1, rr, rr + 1) for c2 in (c - 1, c, c + 1) if 0 <= r2 < rows and 0 <= c2 < cols and grid[r2 * cols + c2] is not None]
                    if near:
                        grid[rr * cols + c] = sum(near) / len(near)
    if any(v is None for v in grid):
        sys.exit("terrain-dem: the DEM does not cover the level box")
    blurred = grid
    base = min(blurred)
    cm = [round((v - base) * 100) for v in blurred]
    packed = base64.b64encode(struct.pack("<" + "h" * len(cm), *cm)).decode()
    out = {
        "source": "U.S. Geological Survey, 3D Elevation Program (3DEP), bare-earth DEM",
        "license": "Public domain",
        "service": SERVICE,
        "fetchedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "pixel": PIXEL,
        "terrain": {
            "cell": CELL,
            "x0": x0,
            "z0": z0,
            "cols": cols,
            "rows": rows,
            "baseElevation": round(base, 2),
            "units": "cm over baseElevation, int16 little-endian, row-major from (x0, z0)",
            "data": packed,
        },
    }
    (level_dir / "raw" / "terrain.json").write_text(json.dumps(out, indent=1) + "\n")
    print(f"terrain: {cols} x {rows} nodes, {CELL} m, relief {max(cm) / 100:.1f} m over {base:.1f} m")


if __name__ == "__main__":
    main()
