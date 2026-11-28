"""Fetch the USGS 3DEP LiDAR points for a level box (spike).

  python3 -I scripts/lidar-fetch.py levels/beltline-eastside/ [--count]

It reads the box from <level>/raw/fetch.json, walks the EPT octree of each
data set in SETS, and keeps each LAZ node that meets the box. The nodes go
to <level>/raw/lidar/<set>/<key>.laz (git-ignored). With --count it only
counts the points and the nodes, and downloads no point data.

Data: USGS 3D Elevation Program, Georgia statewide 2018 LiDAR, public
domain. EPT on AWS: https://s3-us-west-2.amazonaws.com/usgs-lidar-public/.
The EPT coordinates are EPSG:3857 (x, y) and meters (z).

Needs: pyproj (pip install pyproj). The point reads need laspy with lazrs.
"""

import json
import math
import pathlib
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from pyproj import Transformer

ROOT = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public"
SETS = ["GA_Statewide_B2_2018", "GA_Statewide_B3_2018"]


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def node_bounds(cube, key):
    d, x, y, z = key
    size = (cube[3] - cube[0]) / (2**d)
    return (cube[0] + x * size, cube[1] + y * size, cube[0] + (x + 1) * size, cube[1] + (y + 1) * size)


def meets(a, b):
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]


def walk(base, cube, box):
    """The nodes that meet the box: [(key, count)]."""
    out = []
    pages = [(0, 0, 0, 0)]
    seen = set()
    while pages:
        page = pages.pop()
        if page in seen:
            continue
        seen.add(page)
        h = get_json(f"{base}/ept-hierarchy/{'-'.join(map(str, page))}.json")
        for k, count in h.items():
            key = tuple(int(v) for v in k.split("-"))
            if not meets(node_bounds(cube, key), box):
                continue
            if count == -1:
                if key != page:
                    pages.append(key)
            elif count > 0:
                out.append((key, count))
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python3 -I scripts/lidar-fetch.py levels/<name>/ [--count]")
    level = pathlib.Path(sys.argv[1])
    count_only = "--count" in sys.argv
    b = json.loads((level / "raw" / "fetch.json").read_text())["bbox"]
    to3857 = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    x0, y0 = to3857.transform(b["west"], b["south"])
    x1, y1 = to3857.transform(b["east"], b["north"])
    box = (x0, y0, x1, y1)
    report = {"bbox": b, "box3857": [round(v, 2) for v in box], "sets": {}}
    for s in SETS:
        base = f"{ROOT}/{s}"
        ept = get_json(f"{base}/ept.json")
        nodes = walk(base, ept["bounds"], box)
        depths = sorted({k[0] for k, _ in nodes})
        total = sum(c for _, c in nodes)
        report["sets"][s] = {"nodes": len(nodes), "points": total, "depths": depths}
        print(s, len(nodes), "nodes", total, "points, depths", depths, flush=True)
        if count_only or not nodes:
            continue
        out = level / "raw" / "lidar" / s
        out.mkdir(parents=True, exist_ok=True)

        def fetch(item):
            key, _ = item
            name = "-".join(map(str, key))
            f = out / f"{name}.laz"
            if not f.exists():
                urllib.request.urlretrieve(f"{base}/ept-data/{name}.laz", f)
            return f.stat().st_size

        with ThreadPoolExecutor(8) as pool:
            size = sum(pool.map(fetch, nodes))
        report["sets"][s]["bytes"] = size
        print(s, "downloaded", round(size / 1e6, 1), "MB", flush=True)
    (level / "raw" / "lidar-fetch.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
